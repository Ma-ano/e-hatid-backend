import { Schema, model, type InferSchemaType } from "mongoose";

const riderReviewSchema = new Schema(
  {
    userId: { type: String, required: true },
    riderId: { type: String, required: true, index: true },
    orderId: { type: String, default: null },
    userName: { type: String, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    date: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

riderReviewSchema.index({ riderId: 1, createdAt: -1 });
riderReviewSchema.index(
  { orderId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $type: "string" } } },
);

export type RiderReview = InferSchemaType<typeof riderReviewSchema>;
export const RiderReviewModel = model("RiderReview", riderReviewSchema);
