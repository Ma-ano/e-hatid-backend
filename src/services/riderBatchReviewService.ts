import { HttpError } from "../middlewares/errorHandler.js";
import { OrderModel } from "../models/order.js";
import { RiderBatchReviewModel } from "../models/riderBatchReview.js";

export async function createBatchReview(input: {
  riderId: string;
  riderName: string;
  orderId: string;
  rating: number;
  comment: string;
}) {
  const order = await OrderModel.findById(input.orderId).lean();
  if (!order) {
    throw new HttpError(404, "Order not found");
  }
  if (order.riderId !== input.riderId) {
    throw new HttpError(403, "You can only review a delivery you completed");
  }
  if (!["delivered", "completed"].includes(order.status)) {
    throw new HttpError(400, "You can only review a delivered batch");
  }
  const existing = await RiderBatchReviewModel.findOne({ orderId: input.orderId }).lean();
  if (existing) {
    throw new HttpError(409, "You have already reviewed this batch");
  }

  const review = await RiderBatchReviewModel.create({
    riderId: input.riderId,
    riderName: input.riderName,
    orderId: input.orderId,
    stallName: order.stallName ?? "",
    customerName: order.customerName ?? "",
    rating: input.rating,
    comment: input.comment,
    date: new Date().toISOString(),
  });
  return review;
}

export async function listMyBatchReviews(riderId: string) {
  return RiderBatchReviewModel.find({ riderId }).sort({ createdAt: -1 }).lean();
}

export async function listAllBatchReviews() {
  return RiderBatchReviewModel.find().sort({ createdAt: -1 }).lean();
}

/** Rider may delete their own review; admins may delete any review. */
export async function deleteBatchReview(input: { id: string; riderId: string; isAdmin: boolean }) {
  const review = await RiderBatchReviewModel.findById(input.id).lean();
  if (!review) {
    throw new HttpError(404, "Review not found");
  }
  if (!input.isAdmin && review.riderId !== input.riderId) {
    throw new HttpError(403, "You can only delete your own review");
  }
  await RiderBatchReviewModel.findByIdAndDelete(input.id);
}