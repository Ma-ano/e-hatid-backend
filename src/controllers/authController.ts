import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../middlewares/errorHandler.js";
import { UserModel } from "../models/user.js";
import { toSafeUser, type SafeUser } from "../services/userService.js";
import { sendMail } from "../services/mailer.js";
import { env } from "../config/env.js";
import {
  clearAuthCookie,
  setAuthCookie,
  signToken,
  getServerCsrf,
  AUTH_COOKIE,
  verifyToken,
} from "../services/authService.js";

const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const smtpConfigured = Boolean(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "email is invalid");
  }
  return email;
}

function validatePassword(value: unknown, field = "password"): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(400, `${field} must be at least 8 characters`);
  }
  if (Buffer.byteLength(value, "utf8") > 72) {
    throw new HttpError(400, `${field} must be at most 72 UTF-8 bytes`);
  }
  return value;
}

function issueToken(res: Response, user: SafeUser, sessionVersion: number): void {
  const token = signToken({ sub: user.id, role: user.role, activeRole: user.activeRole, ver: sessionVersion });
  setAuthCookie(res, token);
}

export async function register(req: Request, res: Response): Promise<void> {
  const { name, email, phone, password, address } = req.body as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    password?: unknown;
    address?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "" || name.trim().length > 100) {
    throw new HttpError(400, "name is required");
  }
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  const validPassword = validatePassword(password);
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
  const normalizedAddress = typeof address === "string" ? address.trim() : "";
  if (normalizedPhone.length > 30) throw new HttpError(400, "phone is too long");
  if (normalizedAddress.length > 500) throw new HttpError(400, "address is too long");

  const normalizedEmail = normalizeEmail(email);
  const exists = await UserModel.findOne({ email: normalizedEmail });
  if (exists) {
    throw new HttpError(409, "An account with that email already exists");
  }

  const passwordHash = await bcrypt.hash(validPassword, BCRYPT_ROUNDS);
  const user = await UserModel.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordHash,
    emailVerified: false,
    role: "customer",
    roles: ["customer"],
    activeRole: "customer",
    roleStatus: { customer: "approved", rider: "none", vendor: "none", admin: "none" },
    address: normalizedAddress,
  });

  const safe = toSafeUser(user.toObject());
  issueToken(res, safe, user.sessionVersion);
  res.status(201).json({ data: safe, csrfToken: getServerCsrf(req, res) });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  if (typeof password !== "string" || password === "" || Buffer.byteLength(password, "utf8") > 72) {
    throw new HttpError(400, "password is required");
  }

  const user = await UserModel.findOne({ email: normalizeEmail(email) }).select("+passwordHash").lean();
  if (!user || !user.passwordHash) {
    throw new HttpError(401, "Invalid email or password");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, "Invalid email or password");
  }

  const safe = toSafeUser(user);
  issueToken(res, safe, user.sessionVersion ?? 0);
  res.status(200).json({ data: safe, csrfToken: getServerCsrf(req, res) });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  if (authReq.user?.sub) {
    await UserModel.updateOne({ _id: authReq.user.sub }, { $inc: { sessionVersion: 1 } });
  }
  clearAuthCookie(res);
  res.status(200).json({ data: { success: true } });
}

/**
 * Request a password reset. Always answers the same way whether or not the
 * email exists, so the endpoint cannot be used to enumerate accounts.
 * With explicitly enabled local demo mode, the reset token is echoed so the
 * flow can be tested without SMTP. It is never echoed in production.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: unknown };
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  const normalized = normalizeEmail(email);

  const user = await UserModel.findOne({ email: normalized });
  let demoResetToken: string | undefined;
  if (user) {
    const token = randomBytes(32).toString("hex");
    await UserModel.findByIdAndUpdate(user._id, {
      passwordResetToken: hashToken(token),
      passwordResetExpires: new Date(Date.now() + RESET_TTL_MS),
    });
    const link = `${env.clientOrigin}/reset-password?token=${token}`;
    try {
      await sendMail({
        to: normalized,
        subject: "Reset your E-Hatid password",
        text: `You requested a password reset for E-Hatid.\n\nOpen this link within 1 hour to set a new password:\n${link}\n\nIf you did not request this, you can safely ignore this email.`,
      });
    } catch (err) {
      // Preserve the endpoint's non-enumerating response contract even when
      // the mail provider is unavailable. Operational details stay server-side.
      console.error("[auth] password reset email delivery failed", err);
    }
    if (!smtpConfigured && !env.isProduction && env.allowInsecureDemoOtp) {
      demoResetToken = token;
    }
  }

  res.status(200).json({
    data: {
      sent: true,
      // Explicit local-only fallback so reset can be tested without mail.
      demoResetToken,
    },
    message: "If an account exists for that email, a reset link has been sent.",
  });
}

/** Reset the password using a single-use, expiring token. */
export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as { token?: unknown; password?: unknown };
  if (typeof token !== "string" || token === "") {
    throw new HttpError(400, "token is required");
  }
  const validPassword = validatePassword(password);

  const passwordHash = await bcrypt.hash(validPassword, BCRYPT_ROUNDS);
  const user = await UserModel.findOneAndUpdate(
    {
      passwordResetToken: hashToken(token),
      passwordResetExpires: { $gt: new Date() },
    },
    {
      $set: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
      $inc: { sessionVersion: 1 },
    },
    { new: true },
  );
  if (!user) {
    throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.");
  }

  res.status(200).json({ data: { success: true }, message: "Password reset. You can now sign in." });
}

/** Signed-in password change. Requires the current password. */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== "string" || currentPassword === "") {
    throw new HttpError(400, "currentPassword is required");
  }
  const validNewPassword = validatePassword(newPassword, "new password");

  const user = await UserModel.findById(authReq.user?.sub).select("+passwordHash");
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  if (!user.passwordHash) {
    throw new HttpError(400, "This account has no password set.");
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    throw new HttpError(400, "Current password is incorrect");
  }

  user.passwordHash = await bcrypt.hash(validNewPassword, BCRYPT_ROUNDS);
  user.sessionVersion += 1;
  await user.save();

  issueToken(res, toSafeUser(user.toObject()), user.sessionVersion);

  res.status(200).json({ data: { success: true }, message: "Password updated." });
}

export async function me(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (!token) {
    res.status(200).json({ data: null });
    return;
  }
  let payload: { sub: string; ver?: number };
  try {
    payload = verifyToken(token);
  } catch {
    clearAuthCookie(res);
    res.status(200).json({ data: null });
    return;
  }
  const user = await UserModel.findById(payload.sub).lean();
  if (!user || (payload.ver ?? 0) !== (user.sessionVersion ?? 0)) {
    clearAuthCookie(res);
    res.status(200).json({ data: null });
    return;
  }
  res.status(200).json({ data: toSafeUser(user), csrfToken: getServerCsrf(req, res) });
}
