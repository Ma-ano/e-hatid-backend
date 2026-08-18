import crypto from "node:crypto";
import { HttpError } from "../middlewares/errorHandler.js";
import { OtpRequestModel } from "../models/otpRequest.js";
import { env } from "../config/env.js";

/** Generates a 6-digit numeric OTP. `insecure` only controls client-side echo, not format. */
export function generateOtp(email: string, insecure: boolean): string {
  if (insecure) {
    console.warn(`[otp] Insecure/demo mode for ${email}: code will be echoed to the client.`);
  }
  return String(crypto.randomInt(1_000_000)).padStart(6, "0");
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

/** How this request is delivered — console/smtp switch handled by caller. */

export class OtpIssuer {
  constructor(private readonly deliver: (email: string, otp: string) => Promise<void>) {}

  /**
   * Issue an OTP for an email in the given window. Enforces a per-email send
   * budget within OTP_RATE_WINDOW_MS and flags many sends as suspicious.
   */
  async issue(
    email: string,
    opts: { userId?: string; ip?: string; userAgent?: string; insecure?: boolean } = {},
  ): Promise<{ otp: string; expiredInsecure?: boolean }> {
    const normalized = email.trim().toLowerCase();
    const now = new Date();
    const windowStart = new Date(now.getTime() - env.otpRateWindowMs);

    const recentCount = await OtpRequestModel.countDocuments({
      email: normalized,
      createdAt: { $gte: windowStart },
    });

    const insecure = opts.insecure === true && !env.isProduction;

    if (recentCount >= env.otpMaxPerEmailPerWindow) {
      // Too many sends in the window — flag suspicious activity on later sessions.
      console.warn(`[otp] Rate limit hit for ${normalized} (${recentCount} in window)`);
      throw new HttpError(429, "Too many OTP requests. Please try again later.");
    }

    const otp = generateOtp(normalized, insecure);
    await OtpRequestModel.create({
      userId: opts.userId || "",
      email: normalized,
      otpHash: hashOtp(otp),
      expiresAt: new Date(now.getTime() + env.otpTtlSeconds * 1000),
      ipAddress: opts.ip || "",
      userAgent: opts.userAgent || "",
    });

    await this.deliver(normalized, otp);
    return { otp, expiredInsecure: insecure };
  }

  /** Verify a submitted OTP against the most recent matching un-used request. */
  async verify(email: string, providedOtp: string): Promise<{ email: string; suspicious: boolean }> {
    const normalized = email.trim().toLowerCase();
    const latest = await OtpRequestModel.findOne({ email: normalized, isUsed: false })
      .sort({ createdAt: -1 })
      .exec();
    if (!latest) {
      throw new HttpError(400, "No active OTP request. Please request a new code.");
    }

    const expired = latest.expiresAt.getTime() < Date.now();
    if (expired) {
      throw new HttpError(400, "OTP has expired. Please request a new code.");
    }

    const providedHash = hashOtp(String(providedOtp).trim());
    const matches = providedHash === latest.otpHash;

    if (!matches) {
      latest.attemptCount += 1;
      const remaining = latest.maxAttempts - latest.attemptCount;
      await latest.save();
      if (remaining <= 0) {
        await latest.updateOne({ isUsed: true });
        console.warn(`[otp] Verifications exhausted for ${normalized}`);
        throw new HttpError(429, "Too many incorrect attempts. Please request a new code.");
      }
      throw new HttpError(400, `Incorrect OTP. ${remaining} attempt(s) remaining.`);
    }

    await latest.updateOne({ isUsed: true });
    // Count total failed attempts across the user's recent requests to flag abuse.
    const recentFailed = await OtpRequestModel.countDocuments({
      email: normalized,
      attemptCount: { $gt: 0 },
      createdAt: { $gte: new Date(Date.now() - env.otpRateWindowMs) },
    });
    return { email: normalized, suspicious: recentFailed >= 3 };
  }
}
