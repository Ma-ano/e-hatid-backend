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
  return req.ip || req.socket.remoteAddress || "";
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
    insecure: env.allowInsecureDemoOtp && purpose === "demo",
  });

  // In non-production, demo requests also get the code echoed back on-screen so
  // local testing doesn't depend on inbox delivery. In production insecure mode
  // is disabled inside the issuer, so this can never leak a real code.
  const echoDemo = result.expiredInsecure === true;

  res.status(200).json({
    data: {
      email: normalized,
      expiresIn: env.otpTtlSeconds,
      demoOtp: echoDemo ? result.otp : undefined,
    },
    message: `Verification code sent${echoDemo ? " (demo mode: code shown below)" : ""}`,
  });
}

/** Verify a submitted OTP and mark the signed-in account's email as verified. */
export async function verifyOtp(req: Request, res: Response): Promise<void> {
  // The code can only ever verify the logged-in account's own email — never an
  // arbitrary address supplied by the client.
  const authReq = req as Request & { user?: { sub: string; email?: string } };
  if (!authReq.user?.sub) {
    throw new HttpError(401, "Authentication required");
  }

  const { otp } = req.body as { email?: unknown; otp?: unknown };
  if (typeof otp !== "string" || otp.trim() === "") {
    throw new HttpError(400, "otp is required");
  }

  // The JWT doesn't carry the address, so resolve the signed-in account's
  // email from the database — the code must match it, never a client-supplied one.
  const account = await UserModel.findById(authReq.user.sub).lean();
  const accountEmail = account?.email;
  if (!accountEmail) {
    throw new HttpError(401, "Account not found. Please sign in again.");
  }

  const result = await issuer.verify(accountEmail, otp);

  await UserModel.findByIdAndUpdate(authReq.user.sub, { emailVerified: true });

  res.status(200).json({
    data: { email: result.email, verified: true, suspicious: result.suspicious },
    message: result.suspicious ? "Email verified. Suspicious activity flagged for review." : "Email verified.",
  });
}
