import { OrderModel } from "../models/order.js";
import { RiderReviewModel } from "../models/riderReview.js";

/**
 * Aggregate an actor's earnings from delivered orders. Supports:
 *  - rider: sum of driverShare across delivered orders they carried
 *  - vendor: gross revenue (subtotal) across delivered orders they own
 */
export async function getEarnings(opts: {
  userId: string;
  as: "rider" | "vendor";
}): Promise<{ currency: string; total: number; count: number; period: "all" }> {
  const match: Record<string, unknown> = { status: "delivered" };
  if (opts.as === "rider") {
    match.riderId = opts.userId;
  } else {
    match.vendorId = opts.userId;
  }

  const amount = opts.as === "rider"
    ? { $multiply: [{ $ifNull: ["$deliveryFee", 0] }, 0.7] }
    : { $ifNull: ["$subtotal", 0] };
  const [summary] = await OrderModel.aggregate<{ total: number; count: number }>([
    { $match: match },
    { $group: { _id: null, total: { $sum: amount }, count: { $sum: 1 } } },
  ]);
  return {
    currency: "PHP",
    total: Math.round((summary?.total ?? 0) * 100) / 100,
    count: summary?.count ?? 0,
    period: "all",
  };
}

export async function getRiderRating(riderId: string): Promise<{ average: number; count: number }> {
  const [summary] = await RiderReviewModel.aggregate<{ average: number; count: number }>([
    { $match: { riderId } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return {
    average: Math.round((summary?.average ?? 0) * 10) / 10,
    count: summary?.count ?? 0,
  };
}
