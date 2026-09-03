import { HttpError } from "../middlewares/errorHandler.js";
import { OrderModel } from "../models/order.js";
import { PromoModel, type Promo, type PromoType } from "../models/promo.js";
import { PromoRedemptionModel } from "../models/promoRedemption.js";

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

type StoredPromo = Promo & { _id: unknown };

export interface PromoResult {
  promo: StoredPromo;
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

export async function findQualifiedPromo(ctx: PromoContext): Promise<StoredPromo | null> {
  const code = ctx.code.trim().toUpperCase();
  if (!code) return null;
  const promo = await PromoModel.findOne({ code }).lean();
  return promo as StoredPromo | null;
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

export interface PromoReservation {
  promoId: string;
  userId: string;
  reservedForUser: boolean;
}

/** Atomically reserve global and per-user promo capacity before creating an order. */
export async function reservePromoUse(
  promo: StoredPromo,
  userId: string,
): Promise<PromoReservation> {
  const promoId = String(promo._id);
  const perUserLimit = promo.perUserLimit ?? 1;
  let reservedForUser = false;

  if (perUserLimit > 0) {
    const existingCounter = await PromoRedemptionModel.findOneAndUpdate(
      { promoId, userId, count: { $lt: perUserLimit } },
      { $inc: { count: 1 } },
      { new: true },
    ).lean();

    if (existingCounter) {
      reservedForUser = true;
    } else {
      const historicalCount = await OrderModel.countDocuments({ userId, promoCode: promo.code });
      if (historicalCount >= perUserLimit) {
        throw new HttpError(409, "You have already used this promo code");
      }
      try {
        await PromoRedemptionModel.create({ promoId, userId, count: historicalCount + 1 });
        reservedForUser = true;
      } catch (err) {
        if (!(typeof err === "object" && err !== null && (err as { code?: number }).code === 11000)) {
          throw err;
        }
        const racedCounter = await PromoRedemptionModel.findOneAndUpdate(
          { promoId, userId, count: { $lt: perUserLimit } },
          { $inc: { count: 1 } },
          { new: true },
        ).lean();
        if (!racedCounter) throw new HttpError(409, "You have already used this promo code");
        reservedForUser = true;
      }
    }
  }

  const globalReservation = await PromoModel.updateOne(
    {
      _id: promo._id,
      active: true,
      $or: [
        { usageLimit: { $lte: 0 } },
        { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
      ],
    },
    { $inc: { usedCount: 1 } },
  );
  if (globalReservation.modifiedCount !== 1) {
    if (reservedForUser) {
      await PromoRedemptionModel.updateOne(
        { promoId, userId, count: { $gt: 0 } },
        { $inc: { count: -1 } },
      );
    }
    throw new HttpError(409, "This promo code has just reached its usage limit");
  }

  return { promoId, userId, reservedForUser };
}

/** Release a reservation when order creation fails before it commits. */
export async function releasePromoUse(reservation: PromoReservation): Promise<void> {
  await PromoModel.updateOne(
    { _id: reservation.promoId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
  );
  if (reservation.reservedForUser) {
    await PromoRedemptionModel.updateOne(
      { promoId: reservation.promoId, userId: reservation.userId, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  }
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
