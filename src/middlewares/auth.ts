import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errorHandler.js";
import {
  AUTH_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  attachUser,
  verifyToken,
} from "../services/authService.js";
import { ROLES, UserModel, type Role } from "../models/user.js";

interface AuthRequest extends Request {
  user?: { sub: string; role: string; activeRole: string };
  dbUser?: unknown;
}

/**
 * Attach the authenticated user (from the auth cookie) to req.user.
 * Does not reject; intended to run before routers that may allow guests.
 */
export function loadUser(req: Request, res: Response, next: NextFunction): void {
  attachUser(req, res);
  next();
}

/** Requires a valid auth cookie. Rejects unauthenticated requests. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (!token) {
    throw new HttpError(401, "Authentication required");
  }
  try {
    (req as AuthRequest).user = verifyToken(token);
    next();
  } catch {
    throw new HttpError(401, "Session expired or invalid");
  }
}

/**
 * Requires the authenticated user to hold at least one of the given roles,
 * resolved from the authoritative `roles` array in the DB (JWT alone can be
 * stale). Loads the fresh user doc onto req.dbUser.
 */
export function requireRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      throw new HttpError(401, "Authentication required");
    }
    const user = await UserModel.findById(authReq.user.sub).lean();
    if (!user) {
      throw new HttpError(401, "User account no longer exists");
    }
    authReq.dbUser = user;
    const memberRoles = (user.roles ?? []) as Role[];
    const hasRole = roles.some((r) => memberRoles.includes(r));
    if (!hasRole) {
      throw new HttpError(403, "You do not have permission to perform this action");
    }
    next();
  };
}

/** In-memory holders of DB objects for reuse by controllers. */
export function getDbUser(req: Request): unknown {
  return (req as AuthRequest).dbUser;
}

/** CSRF double-submit check for state-changing methods. */
export function csrfProtect(req: Request, _res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const cookie = (req.cookies?.[CSRF_COOKIE] as string | undefined) ?? "";
  const header = (req.headers[CSRF_HEADER] as string | undefined) ?? "";
  if (cookie === "" || cookie !== header) {
    throw new HttpError(403, "CSRF token mismatch");
  }
  next();
}

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
