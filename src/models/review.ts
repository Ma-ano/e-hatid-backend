import { Schema, model, type InferSchemaType } from "mongoose";

const reviewSchema = new Schema(
  {
    userId: { type: String, required: true },
    stallId: { type: String, required: true, index: true },
    orderId: { type: String, default: null },
    userName: { type: String, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    date: { type: String, default: "" },
    likes: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

reviewSchema.index({ stallId: 1, createdAt: -1 });

export type Review = InferSchemaType<typeof reviewSchema>;
export const ReviewModel = model("Review", reviewSchema);
