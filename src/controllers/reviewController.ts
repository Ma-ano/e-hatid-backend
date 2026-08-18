import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { ReviewModel, type Review } from "../models/review.js";
import { RiderReviewModel, type RiderReview } from "../models/riderReview.js";
import { OrderModel } from "../models/order.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

function isoDate(): string {
  return new Date().toISOString();
}

function statsFrom(reviews: Pick<Review, "rating">[]) {
  if (reviews.length === 0) {
    return { average: 0, total: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
  }
  const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;
  for (const r of reviews) {
    distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    sum += r.rating;
  }
  return { average: Math.round((sum / reviews.length) * 10) / 10, total: reviews.length, distribution };
}

export async function createReview(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const body = req.body as {
    stallId?: unknown;
    orderId?: unknown;
    rating?: unknown;
    comment?: unknown;
  };
  if (typeof body.stallId !== "string" || body.stallId === "") {
    throw new HttpError(400, "stallId is required");
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, "rating must be an integer 1-5");
  }

  // Optional customer-verification: if an orderId is given, ensure it's delivered
  // and belongs to this user (mirrors old "hasReviewedOrder" gating loosely).
  if (typeof body.orderId === "string" && body.orderId !== "") {
    const order = await OrderModel.findById(body.orderId).lean();
    if (!order || order.userId !== user.sub) {
      throw new HttpError(403, "Order not found or not yours");
    }
    if (order.status !== "delivered") {
      throw new HttpError(400, "You can only review a delivered order");
    }
    const existing = await ReviewModel.findOne({ orderId: body.orderId, userId: user.sub } as never).lean();
    if (existing) {
      throw new HttpError(409, "You have already reviewed this order");
    }
  }

  const review = await ReviewModel.create({
    userId: user.sub,
    stallId: body.stallId,
    orderId: typeof body.orderId === "string" ? body.orderId : null,
    userName: "",
    rating,
    comment: typeof body.comment === "string" ? body.comment : "",
    date: isoDate(),
    likes: 0,
  });
  res.status(201).json({ data: review });
}

export async function listReviewsByStall(req: Request, res: Response): Promise<void> {
  const { stallId } = req.params;
  const filter: Record<string, unknown> = { stallId };
  const reviews = await ReviewModel.find(filter).sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: reviews });
}

export async function getReviewStats(req: Request, res: Response): Promise<void> {
  const { stallId } = req.params;
  const filter: Record<string, unknown> = { stallId };
  const reviews = await ReviewModel.find(filter).select("rating").lean();
  res.status(200).json({ data: statsFrom(reviews) });
}

export async function hasReviewedOrder(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const { orderId } = req.params;
  if (!isValidObjectId(orderId)) throw new HttpError(400, "Invalid order id");
  const existing = await ReviewModel.findOne({ orderId, userId: user.sub } as never).lean();
  res.status(200).json({ data: { reviewed: existing !== null } });
}

// ---- Rider reviews ----

export async function createRiderReview(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const body = req.body as { riderId?: unknown; orderId?: unknown; rating?: unknown; comment?: unknown };
  if (typeof body.riderId !== "string" || body.riderId === "") {
    throw new HttpError(400, "riderId is required");
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, "rating must be an integer 1-5");
  }

  if (typeof body.orderId === "string" && body.orderId !== "") {
    const order = await OrderModel.findById(body.orderId).lean();
    if (!order || order.userId !== user.sub) {
      throw new HttpError(403, "Order not found or not yours");
    }
    if (order.status !== "delivered") {
      throw new HttpError(400, "You can only review a delivered order");
    }
    const existing = await RiderReviewModel.findOne({ orderId: body.orderId, userId: user.sub } as never).lean();
    if (existing) {
      throw new HttpError(409, "You have already reviewed this rider");
    }
  }

  const review = await RiderReviewModel.create({
    userId: user.sub,
    riderId: body.riderId,
    orderId: typeof body.orderId === "string" ? body.orderId : null,
    userName: "",
    rating,
    comment: typeof body.comment === "string" ? body.comment : "",
    date: isoDate(),
  });
  res.status(201).json({ data: review });
}

export async function listRiderReviews(req: Request, res: Response): Promise<void> {
  const { riderId } = req.params;
  const filter: Record<string, unknown> = { riderId };
  const reviews = await RiderReviewModel.find(filter).sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: reviews });
}

export async function getRiderReviewStats(req: Request, res: Response): Promise<void> {
  const { riderId } = req.params;
  const filter: Record<string, unknown> = { riderId };
  const reviews = await RiderReviewModel.find(filter)
    .select("rating")
    .lean() as unknown as Pick<RiderReview, "rating">[];
  res.status(200).json({ data: statsFrom(reviews as unknown as Pick<Review, "rating">[]) });
}
