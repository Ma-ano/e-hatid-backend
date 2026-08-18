import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { OtpIssuer } from "../services/otpService.js";
import { sendMail } from "../services/mailer.js";
import { UserModel } from "../models/user.js";
import { env } from "../config/env.js";

const smtpConfigured = Boolean(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass);

const issuer = new OtpIssuer(async (email, otp) => {
  const delivered = await sendMail({
    to: email,
    subject: "Your E-Hatid verification code",
    text: `Your E-Hatid verification code is: ${otp}\n\nThis code expires in 5 minutes. If you did not request this, you can ignore this email.`,
  });
  if (smtpConfigured && !delivered.delivered) {
    throw new HttpError(
      502,
      "Could not send the verification code by email. Check the Gmail SMTP settings and app password, then try again.",
    );
  }
});

function ipOf(req: Request): string {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || "";
}

/**
 * Send an OTP to the caller's email. Used for email verification / login-by-OTP.
 * When not production and user is a demo account, echoes the code back (insecure mode).
 */
export async function requestOtp(req: Request, res: Response): Promise<void> {
  const { email, purpose } = req.body as { email?: unknown; purpose?: unknown };
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  const normalized = email.trim().toLowerCase();

  // In dev/demo, allow OTP issue to any email (no account requirement) for testing.
  const authReq = req as Request & { user?: { sub: string } };
  const userId = authReq.user?.sub ?? "";

  const result = await issuer.issue(normalized, {
    userId,
    ip: ipOf(req),
    userAgent: (req.headers["user-agent"] as string) || "",
    insecure: purpose === "demo" || normalized === "rider@ehatid.com",
  });

  res.status(200).json({
    data: {
      email: normalized,
      expiresIn: 300,
      // Only echo the code when there is no email provider to deliver it (dev/demo fallback).
      demoOtp: !smtpConfigured && result.expiredInsecure ? result.otp : undefined,
    },
    message: `Verification code sent${!smtpConfigured && result.expiredInsecure ? " (demo mode: echoed below)" : ""}`,
  });
}

/** Verify a submitted OTP and mark the email as verified for the current user. */
export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const { email, otp } = req.body as { email?: unknown; otp?: unknown };
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  if (typeof otp !== "string" || otp.trim() === "") {
    throw new HttpError(400, "otp is required");
  }

  const result = await issuer.verify(email, otp);

  const authReq = req as Request & { user?: { sub: string } };
  if (authReq.user?.sub) {
    await UserModel.findByIdAndUpdate(authReq.user.sub, { emailVerified: true });
  }

  res.status(200).json({
    data: { email: result.email, verified: true, suspicious: result.suspicious },
    message: result.suspicious ? "Email verified. Suspicious activity flagged for review." : "Email verified.",
  });
}
