import { Schema, model, type InferSchemaType } from "mongoose";

export const PROMO_TYPES = ["percent", "fixed", "free_delivery"] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

const promoSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: PROMO_TYPES, required: true },
    // percent: value is the percentage off subtotal (0-100)
    // fixed: value is the flat peso discount
    // free_delivery: value is ignored, delivery fee is waived
    value: { type: Number, default: 0 },
    minSubtotal: { type: Number, default: 0 },
    maxDiscount: { type: Number, default: 0 }, // 0 = no cap
    usageLimit: { type: Number, default: 0 }, // 0 = unlimited total redemptions
    usedCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 }, // 0 = unlimited per user
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    stallId: { type: String, default: "" }, // "" = any stall
    active: { type: Boolean, default: true },
    description: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

promoSchema.index({ active: 1, startsAt: 1, expiresAt: 1 });

export type Promo = InferSchemaType<typeof promoSchema>;
export const PromoModel = model("Promo", promoSchema);
