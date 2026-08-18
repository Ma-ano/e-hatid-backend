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

function issueToken(res: Response, user: SafeUser): void {
  const token = signToken({ sub: user.id, role: user.role, activeRole: user.activeRole });
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

  if (typeof name !== "string" || name.trim() === "") {
    throw new HttpError(400, "name is required");
  }
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "password must be at least 8 characters");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const exists = await UserModel.findOne({ email: normalizedEmail });
  if (exists) {
    throw new HttpError(409, "An account with that email already exists");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await UserModel.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: typeof phone === "string" ? phone.trim() : "",
    passwordHash,
    emailVerified: false,
    role: "customer",
    roles: ["customer"],
    activeRole: "customer",
    roleStatus: { customer: "approved", rider: "none", vendor: "none", admin: "none" },
    address: typeof address === "string" ? address.trim() : "",
  });

  const safe = toSafeUser(user.toObject());
  issueToken(res, safe);
  res.status(201).json({ data: safe, csrfToken: getServerCsrf() });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  if (typeof password !== "string" || password === "") {
    throw new HttpError(400, "password is required");
  }

  const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).lean();
  if (!user || !user.passwordHash) {
    throw new HttpError(401, "Invalid email or password");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, "Invalid email or password");
  }

  const safe = toSafeUser(user);
  issueToken(res, safe);
  res.status(200).json({ data: safe, csrfToken: getServerCsrf() });
}

export async function logout(_req: Request, res: Response): Promise<void> {
  clearAuthCookie(res);
  res.status(200).json({ data: { success: true } });
}

/**
 * Request a password reset. Always answers the same way whether or not the
 * email exists, so the endpoint cannot be used to enumerate accounts.
 * In dev/demo (no SMTP) the reset token is echoed so the flow can be tested.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: unknown };
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required");
  }
  const normalized = email.trim().toLowerCase();

  const user = await UserModel.findOne({ email: normalized });
  let demoResetToken: string | undefined;
  if (user) {
    const token = randomBytes(32).toString("hex");
    await UserModel.findByIdAndUpdate(user._id, {
      passwordResetToken: hashToken(token),
      passwordResetExpires: new Date(Date.now() + RESET_TTL_MS),
    });
    const link = `${env.clientOrigin}/reset-password?token=${token}`;
    await sendMail({
      to: normalized,
      subject: "Reset your E-Hatid password",
      text: `You requested a password reset for E-Hatid.\n\nOpen this link within 1 hour to set a new password:\n${link}\n\nIf you did not request this, you can safely ignore this email.`,
    });
    if (!smtpConfigured) {
      demoResetToken = token;
    }
  }

  res.status(200).json({
    data: {
      sent: true,
      // Dev/demo fallback so password reset works without a mail server.
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
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "password must be at least 8 characters");
  }

  const user = await UserModel.findOne({
    passwordResetToken: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  });
  if (!user) {
    throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await UserModel.findByIdAndUpdate(user._id, {
    passwordHash,
    passwordResetToken: null,
    passwordResetExpires: null,
  });

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
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new HttpError(400, "new password must be at least 8 characters");
  }

  const user = await UserModel.findById(authReq.user?.sub);
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

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await user.save();

  res.status(200).json({ data: { success: true }, message: "Password updated." });
}

export async function me(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (!token) {
    res.status(200).json({ data: null });
    return;
  }
  let payload: { sub: string };
  try {
    payload = verifyToken(token);
  } catch {
    clearAuthCookie(res);
    res.status(200).json({ data: null });
    return;
  }
  const user = await UserModel.findById(payload.sub).lean();
  if (!user) {
    clearAuthCookie(res);
    res.status(200).json({ data: null });
    return;
  }
  res.status(200).json({ data: toSafeUser(user), csrfToken: getServerCsrf() });
}
