import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import {
  createBatchReview,
  deleteBatchReview,
  listAllBatchReviews,
  listMyBatchReviews,
} from "../services/riderBatchReviewService.js";

interface RiderContext {
  id: string;
  name: string;
}

function getRider(req: Request): RiderContext {
  const authReq = req as Request & { user?: { sub: string }; dbUser?: { name?: string } };
  if (!authReq.user?.sub) throw new HttpError(401, "Authentication required");
  return {
    id: authReq.user.sub,
    name: typeof authReq.dbUser?.name === "string" ? authReq.dbUser.name : "",
  };
}

export async function createMyBatchReview(req: Request, res: Response): Promise<void> {
  const rider = getRider(req);
  const body = req.body as { orderId?: unknown; rating?: unknown; comment?: unknown };
  if (typeof body.orderId !== "string" || body.orderId === "") {
    throw new HttpError(400, "orderId is required");
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, "rating must be an integer 1-5");
  }

  const review = await createBatchReview({
    riderId: rider.id,
    riderName: rider.name,
    orderId: body.orderId,
    rating,
    comment: typeof body.comment === "string" ? body.comment : "",
  });
  res.status(201).json({ data: review });
}

export async function myBatchReviews(req: Request, res: Response): Promise<void> {
  const rider = getRider(req);
  const reviews = await listMyBatchReviews(rider.id);
  res.status(200).json({ data: reviews });
}

export async function adminListBatchReviews(_req: Request, res: Response): Promise<void> {
  const reviews = await listAllBatchReviews();
  res.status(200).json({ data: reviews });
}

export async function deleteMyBatchReview(req: Request, res: Response): Promise<void> {
  const rider = getRider(req);
  const { id } = req.params as { id: string };
  await deleteBatchReview({ id, riderId: rider.id, isAdmin: false });
  res.status(204).send();
}

export async function adminDeleteBatchReview(req: Request, res: Response): Promise<void> {
  await deleteBatchReview({ id: (req.params as { id: string }).id, riderId: "", isAdmin: true });
  res.status(204).send();
}