import type { Request, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export interface JwtPayload {
  sub: string;
  role: string;
  activeRole: string;
  ver?: number;
}

export const AUTH_COOKIE = "ehatid_token";
export const CSRF_COOKIE = "ehatid_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** Cross-site cookies are required for deployed frontend/backend origins. */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

const isCrossOrigin = env.isProduction || !isLoopbackOrigin(env.clientOrigin);

function cookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: boolean | "lax" | "strict" | "none"; path: string; maxAge: number } {
  return {
    httpOnly: true,
    secure: isCrossOrigin,
    sameSite: isCrossOrigin ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function signToken(payload: { sub: string; role: string; activeRole: string; ver: number }): string {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as NonNullable<SignOptions["expiresIn"]>,
    algorithm: "HS256",
  };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as JwtPayload;
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

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isCrossOrigin,
    sameSite: isCrossOrigin ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

/** Return this client's CSRF token, creating a fresh one when absent. */
export function getServerCsrf(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const cached = res.locals.csrfToken as string | undefined;
  const token = existing && /^[a-f0-9]{48}$/.test(existing) ? existing : (cached ?? csrfToken());
  res.locals.csrfToken = token;
  if (!existing || existing !== token) {
    setCsrfCookie(res, token);
  }
  return token;
}

/** Attach current user subject/role to the request from the auth cookie. */
export function attachUser(req: Request, res: Response): void {
  if (!res.headersSent) {
    getServerCsrf(req, res);
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
