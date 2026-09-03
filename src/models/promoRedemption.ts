import { Schema, model, type InferSchemaType } from "mongoose";

const promoRedemptionSchema = new Schema(
  {
    promoId: { type: String, required: true },
    userId: { type: String, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

promoRedemptionSchema.index({ promoId: 1, userId: 1 }, { unique: true });

export type PromoRedemption = InferSchemaType<typeof promoRedemptionSchema>;
export const PromoRedemptionModel = model("PromoRedemption", promoRedemptionSchema);
