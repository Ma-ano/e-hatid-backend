import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { ReviewModel } from "../models/review.js";
import { RiderReviewModel } from "../models/riderReview.js";
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

interface RatingBucket {
  _id: number;
  count: number;
}

function statsFromBuckets(buckets: RatingBucket[]) {
  if (buckets.length === 0) {
    return { average: 0, total: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
  }
  const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;
  let total = 0;
  for (const bucket of buckets) {
    distribution[bucket._id] = bucket.count;
    sum += bucket._id * bucket.count;
    total += bucket.count;
  }
  return { average: Math.round((sum / total) * 10) / 10, total, distribution };
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
  if (typeof body.orderId !== "string" || !isValidObjectId(body.orderId)) {
    throw new HttpError(400, "A valid orderId is required");
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, "rating must be an integer 1-5");
  }

  const order = await OrderModel.findById(body.orderId).lean();
  if (!order || order.userId !== user.sub) {
    throw new HttpError(403, "Order not found or not yours");
  }
  if (!['delivered', 'completed'].includes(order.status)) {
    throw new HttpError(400, "You can only review a delivered order");
  }
  if (order.stallId !== body.stallId) {
    throw new HttpError(400, "The stall does not match this order");
  }

  let review;
  try {
    review = await ReviewModel.create({
      userId: user.sub,
      stallId: order.stallId,
      orderId: body.orderId,
      userName: order.customerName,
      rating,
      comment: typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "",
      date: isoDate(),
      likes: 0,
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
      throw new HttpError(409, "You have already reviewed this order");
    }
    throw err;
  }
  res.status(201).json({ data: review });
}

export async function listReviewsByStall(req: Request, res: Response): Promise<void> {
  const { stallId } = req.params;
  const filter: Record<string, unknown> = { stallId };
  const reviews = await ReviewModel.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.status(200).json({ data: reviews });
}

export async function getReviewStats(req: Request, res: Response): Promise<void> {
  const { stallId } = req.params;
  const buckets = await ReviewModel.aggregate<RatingBucket>([
    { $match: { stallId } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);
  res.status(200).json({ data: statsFromBuckets(buckets) });
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
  if (typeof body.orderId !== "string" || !isValidObjectId(body.orderId)) {
    throw new HttpError(400, "A valid orderId is required");
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, "rating must be an integer 1-5");
  }

  const orderForRider = await OrderModel.findById(body.orderId).lean();
  if (!orderForRider || orderForRider.userId !== user.sub) {
    throw new HttpError(403, "Order not found or not yours");
  }
  if (!['delivered', 'completed'].includes(orderForRider.status)) {
    throw new HttpError(400, "You can only review a delivered order");
  }
  if (!orderForRider.riderId || orderForRider.riderId !== body.riderId) {
    throw new HttpError(400, "The rider does not match this order");
  }

  let review;
  try {
    review = await RiderReviewModel.create({
      userId: user.sub,
      riderId: orderForRider.riderId,
      orderId: body.orderId,
      userName: orderForRider.customerName,
      rating,
      comment: typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "",
      date: isoDate(),
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
      throw new HttpError(409, "You have already reviewed this rider");
    }
    throw err;
  }
  res.status(201).json({ data: review });
}

export async function listRiderReviews(req: Request, res: Response): Promise<void> {
  const { riderId } = req.params;
  const filter: Record<string, unknown> = { riderId };
  const reviews = await RiderReviewModel.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.status(200).json({ data: reviews });
}

export async function getRiderReviewStats(req: Request, res: Response): Promise<void> {
  const { riderId } = req.params;
  const buckets = await RiderReviewModel.aggregate<RatingBucket>([
    { $match: { riderId } },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);
  res.status(200).json({ data: statsFromBuckets(buckets) });
}
