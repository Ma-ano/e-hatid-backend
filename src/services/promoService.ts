import { HttpError } from "../middlewares/errorHandler.js";
import { OrderModel } from "../models/order.js";
import { PromoModel, type Promo, type PromoType } from "../models/promo.js";

export interface PromoContext {
  code: string;
  subtotal: number;
  stallId: string;
  userId: string;
}

export interface PromoSummary {
  code: string;
  type: PromoType;
  value: number;
  minSubtotal: number;
  maxDiscount: number;
  description: string;
  expiresAt: Date | null | undefined;
  discountLabel: string;
}

export interface PromoResult {
  promo: Promo;
  type: PromoType;
  discount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute the peso discount a promo grants for a given order. */
export function discountFor(promo: Promo, subtotal: number, deliveryFee: number): number {
  if (promo.type === "percent") {
    const pct = Math.min(Math.max(Number(promo.value) || 0, 0), 100);
    let discount = round2((subtotal * pct) / 100);
    if ((promo.maxDiscount ?? 0) > 0) discount = Math.min(discount, Number(promo.maxDiscount));
    return Math.min(discount, subtotal);
  }
  if (promo.type === "fixed") {
    return Math.min(Number(promo.value) || 0, subtotal);
  }
  if (promo.type === "free_delivery") {
    return deliveryFee;
  }
  return 0;
}

function isInWindow(promo: Promo): boolean {
  const now = new Date();
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now.getTime()) return false;
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < now.getTime()) return false;
  return true;
}

export async function findQualifiedPromo(ctx: PromoContext): Promise<Promo | null> {
  const code = ctx.code.trim().toUpperCase();
  if (!code) return null;
  const promo = await PromoModel.findOne({ code }).lean();
  return promo ?? null;
}

export async function validatePromo(ctx: PromoContext, deliveryFee = 0): Promise<PromoResult> {
  const promo = await findQualifiedPromo(ctx);
  if (!promo) throw new HttpError(400, "Invalid promo code");

  if (promo.active !== true) throw new HttpError(400, "This promo code is inactive");
  if (!isInWindow(promo)) throw new HttpError(400, "This promo code has expired");
  if (ctx.subtotal < (promo.minSubtotal ?? 0)) {
    throw new HttpError(400, `Minimum order of ₱${promo.minSubtotal} required for this promo`);
  }
  if (promo.stallId && promo.stallId !== ctx.stallId) {
    throw new HttpError(400, "This promo code does not apply to this stall");
  }
  if ((promo.usageLimit ?? 0) > 0 && (promo.usedCount ?? 0) >= promo.usageLimit) {
    throw new HttpError(400, "This promo code has reached its usage limit");
  }
  const perUserLimit = promo.perUserLimit ?? 1;
  if (perUserLimit > 0) {
    const code = promo.code;
    const used = await OrderModel.countDocuments({ userId: ctx.userId, promoCode: code });
    if (used >= perUserLimit) {
      throw new HttpError(400, "You have already used this promo code");
    }
  }

  return { promo, type: promo.type, discount: discountFor(promo, ctx.subtotal, deliveryFee) };
}

/** Same validation but returns a friendly response for the checkout preview call. */
export async function previewPromo(ctx: PromoContext, deliveryFee = 0): Promise<{
  valid: boolean;
  message?: string;
  promo?: PromoSummary;
  discount?: number;
}> {
  try {
    const { promo, discount } = await validatePromo(ctx, deliveryFee);
    const label =
      promo.type === "percent"
        ? `${Number(promo.value) || 0}% off`
        : promo.type === "fixed"
          ? `₱${Number(promo.value) || 0} off`
          : "Free delivery";
    return {
      valid: true,
      discount,
      promo: {
        code: promo.code,
        type: promo.type,
        value: promo.value,
        minSubtotal: promo.minSubtotal,
        maxDiscount: promo.maxDiscount,
        description: promo.description,
        expiresAt: promo.expiresAt,
        discountLabel: label,
      },
    };
  } catch (err) {
    return {
      valid: false,
      message: err instanceof Error ? err.message : "Invalid promo code",
    };
  }
}
