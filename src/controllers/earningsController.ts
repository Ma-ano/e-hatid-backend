import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { getEarnings, getRiderRating } from "../services/earningsService.js";

interface AuthUser {
  sub: string;
  role: string;
  activeRole: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

export async function myEarnings(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { as } = req.query as { as?: string };
  const mode = as === "vendor" ? "vendor" : "rider";
  const earnings = await getEarnings({ userId: user.sub, as: mode });
  res.status(200).json({ data: earnings });
}

export async function myRiderRating(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const rating = await getRiderRating(user.sub);
  res.status(200).json({ data: rating });
}
