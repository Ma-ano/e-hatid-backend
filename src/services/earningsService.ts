import { OrderModel } from "../models/order.js";
import { RiderReviewModel, type RiderReview } from "../models/riderReview.js";

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

  const orders = await OrderModel.find(match).lean();
  let total = 0;
  if (opts.as === "rider") {
    // driver share is the deliveryFee from the order's stored data (approx).
    for (const o of orders) {
      const gas = (o.distance ?? 0) > 0 ? 0 : 0;
      total += Math.round(((o.deliveryFee ?? 0) - gas) * 0.7 * 100) / 100;
    }
  } else {
    for (const o of orders) {
      total += o.subtotal ?? 0;
    }
  }
  return {
    currency: "PHP",
    total: Math.round(total * 100) / 100,
    count: orders.length,
    period: "all",
  };
}

export async function getRiderRating(riderId: string): Promise<{ average: number; count: number }> {
  const reviews = (await RiderReviewModel.find({ riderId }).select("rating").lean()) as unknown as Pick<
    RiderReview,
    "rating"
  >[];
  if (reviews.length === 0) return { average: 0, count: 0 };
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return { average: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
}
