import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * A rider's review of a completed delivery batch. One review per order/delivery
 * run. Distinct from RiderReview (a customer reviewing their rider).
 */
const riderBatchReviewSchema = new Schema(
  {
    riderId: { type: String, required: true, index: true },
    riderName: { type: String, default: "" },
    orderId: { type: String, required: true, unique: true },
    stallName: { type: String, default: "" },
    customerName: { type: String, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    date: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

riderBatchReviewSchema.index({ riderId: 1, createdAt: -1 });

export type RiderBatchReview = InferSchemaType<typeof riderBatchReviewSchema>;
export const RiderBatchReviewModel = model("RiderBatchReview", riderBatchReviewSchema);