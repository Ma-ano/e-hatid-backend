import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errorHandler.js";

interface Bucket {
  timestamps: number[];
}

/**
 * Simple in-memory sliding-window rate limiter keyed by IP + route path.
 * Good for a single-instance deployment; swap for Redis in multi-instance setups.
 */
export function rateLimit(options: { windowMs?: number; max?: number; message?: string }) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 30;
  const message = options.message ?? "Too many requests, please slow down.";

  // Map<"ip|route", timestamps>
  const buckets = new Map<string, Bucket>();

  // Periodically sweep stale buckets to prevent unbounded memory growth.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
      if (bucket.timestamps.length === 0) buckets.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Express only consults forwarding headers when `trust proxy` is explicitly
    // configured. Reading X-Forwarded-For directly lets clients evade limits.
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const routePattern = typeof req.route?.path === "string" ? req.route.path : req.path;
    const key = `${ip}|${req.method} ${req.baseUrl}${routePattern}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
    bucket.timestamps.push(now);

    if (bucket.timestamps.length > max) {
      // Do not keep counting beyond the limit; drop the oldest to stay bounded.
      bucket.timestamps.sort((a, b) => b - a);
      bucket.timestamps.pop();
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      throw new HttpError(429, message);
    }

    next();
  };
}
