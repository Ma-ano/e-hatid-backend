import type { Request, Response, NextFunction } from "express";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  let statusCode = err instanceof HttpError ? err.statusCode : 500;
  const isHttpError = err instanceof HttpError;

  // Map common Mongoose errors to 4xx so validation failures don't read as 500s.
  let message = err instanceof Error ? err.message : "Internal Server Error";
  if (typeof err === "object" && err !== null) {
    const e = err as { name?: string; code?: number };
    if (e.name === "ValidationError" || e.name === "CastError" || e.name === "MongoServerError") {
      statusCode = statusCode === 500 ? 400 : statusCode;
      message = e.name === "MongoServerError" && e.code === 11000 ? "A record with that value already exists" : message;
    }
  }

  if (process.env.NODE_ENV !== "test" && (statusCode >= 500 || !isHttpError)) {
    console.error(err);
  }
  res.status(statusCode).json({ error: { message } });
}