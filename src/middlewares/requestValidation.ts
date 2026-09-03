import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errorHandler.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function hasUnsafeKey(value: unknown, depth = 0): boolean {
  if (depth > 30 || value === null || typeof value !== "object") return depth > 30;
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeKey(entry, depth + 1));

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key) || key.startsWith("$") || key.includes(".")) return true;
    if (hasUnsafeKey(child, depth + 1)) return true;
  }
  return false;
}

/** Reject Mongo operator/path injection and prototype-pollution keys in JSON bodies. */
export function rejectUnsafeBody(req: Request, _res: Response, next: NextFunction): void {
  if (hasUnsafeKey(req.body)) {
    throw new HttpError(400, "Request body contains unsupported field names");
  }
  next();
}
