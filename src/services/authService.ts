import type { Request, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export interface JwtPayload {
  sub: string;
  role: string;
  activeRole: string;
}

export const AUTH_COOKIE = "ehatid_token";
export const CSRF_COOKIE = "ehatid_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** true when frontend and backend are on different origins (e.g. Vercel + Render). */
const isCrossOrigin = !env.clientOrigin.includes("localhost");

function cookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: boolean | "lax" | "strict" | "none"; path: string; maxAge: number } {
  return {
    httpOnly: true,
    secure: isCrossOrigin,
    sameSite: isCrossOrigin ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function signToken(payload: { sub: string; role: string; activeRole: string }): string {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as NonNullable<SignOptions["expiresIn"]>,
  };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, cookieOptions());
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { path: "/", httpOnly: true, sameSite: isCrossOrigin ? "none" : "lax", secure: isCrossOrigin });
}

export function csrfToken(): string {
  return randomBytes(24).toString("hex");
}

let _csrf: string | null = null;
export function getServerCsrf(): string {
  if (!_csrf) {
    _csrf = csrfToken();
  }
  return _csrf;
}

export function setCsrfCookie(res: Response): void {
  res.cookie(CSRF_COOKIE, getServerCsrf(), {
    httpOnly: false,
    secure: isCrossOrigin,
    sameSite: isCrossOrigin ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

/** Attach current user subject/role to the request from the auth cookie. */
export function attachUser(req: Request, res: Response): void {
  if (!res.headersSent) {
    setCsrfCookie(res);
  }
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (!token) return;
  try {
    const payload = verifyToken(token);
    (req as Request & { user?: JwtPayload }).user = payload;
  } catch {
    // Invalid/expired token: leave user unset.
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
