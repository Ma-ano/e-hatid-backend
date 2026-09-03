import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { PromoModel, type PromoType } from "../models/promo.js";
import { UserModel } from "../models/user.js";
import { previewPromo } from "../services/promoService.js";
import { logAudit } from "../services/auditLogService.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

async function requireAdmin(req: Request): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const dbUser = await UserModel.findById(user.sub).lean();
  if (!dbUser || !(dbUser.roles ?? []).includes("admin")) {
    throw new HttpError(403, "Admin access required");
  }
}

function toNumber(v: unknown, field: string, fallback = 0): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new HttpError(400, `${field} must be a non-negative number`);
  }
  return v;
}
function toNullableDate(v: unknown, field: string): Date | null {
  if (v === null || v === "") return null;
  if (typeof v === "string" && v !== "") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new HttpError(400, `${field} must be a valid date or null`);
}

/** Preview a promo code before checkout (any authenticated user). */
export async function checkPromo(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { code, stallId, subtotal, deliveryFee } = req.body as Record<string, unknown>;
  if (typeof code !== "string" || code.trim() === "") {
    throw new HttpError(400, "Promo code required");
  }
  if (typeof stallId !== "string" || stallId === "") {
    throw new HttpError(400, "stallId required");
  }

  const result = await previewPromo(
    {
      code,
      stallId,
      userId: user.sub,
      subtotal: toNumber(subtotal, "subtotal"),
    },
    toNumber(deliveryFee, "deliveryFee"),
  );
  res.status(200).json({ data: result });
}

/** Public list of currently redeemable promos (for the offers page). */
export async function listActivePromos(_req: Request, res: Response): Promise<void> {
  const now = new Date();
  const promos = await PromoModel.find({
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({
    data: promos.map((p) => ({
      code: p.code,
      type: p.type,
      value: p.value,
      minSubtotal: p.minSubtotal,
      maxDiscount: p.maxDiscount,
      description: p.description,
      expiresAt: p.expiresAt,
      stallId: p.stallId,
    })),
  });
}

/** Admin: list all promos. */
export async function listPromos(req: Request, res: Response): Promise<void> {
  await requireAdmin(req);
  const promos = await PromoModel.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: promos });
}

/** Admin: create a promo. */
export async function createPromo(req: Request, res: Response): Promise<void> {
  await requireAdmin(req);
  const body = req.body as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const type = body.type as PromoType;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    throw new HttpError(400, "code must be 3-32 letters, numbers, underscores or hyphens");
  }
  if (!["percent", "fixed", "free_delivery"].includes(type)) {
    throw new HttpError(400, "type must be percent, fixed or free_delivery");
  }

  const exists = await PromoModel.findOne({ code }).lean();
  if (exists) throw new HttpError(409, "Promo code already exists");

  const value = toNumber(body.value, "value");
  if (type === "percent" && value > 100) {
    throw new HttpError(400, "Percent promo value cannot exceed 100");
  }
  const startsAt = toNullableDate(body.startsAt ?? null, "startsAt");
  const expiresAt = toNullableDate(body.expiresAt ?? null, "expiresAt");
  if (startsAt && expiresAt && startsAt >= expiresAt) {
    throw new HttpError(400, "expiresAt must be later than startsAt");
  }

  const promo = await PromoModel.create({
    code,
    type,
    value,
    minSubtotal: toNumber(body.minSubtotal, "minSubtotal"),
    maxDiscount: toNumber(body.maxDiscount, "maxDiscount"),
    usageLimit: toNumber(body.usageLimit, "usageLimit"),
    perUserLimit: toNumber(body.perUserLimit, "perUserLimit", 1),
    startsAt,
    expiresAt,
    stallId: typeof body.stallId === "string" ? body.stallId : "",
    active: body.active !== false,
    description: typeof body.description === "string" ? body.description : "",
  });
  await logAudit(req, {
    category: "promo",
    action: "promo.created",
    targetType: "Promo",
    targetId: String(promo._id),
    meta: { code },
  });
  res.status(201).json({ data: promo });
}

/** Admin: update a promo. */
export async function updatePromo(req: Request, res: Response): Promise<void> {
  await requireAdmin(req);
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid promo id");

  const body = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  const strings: (keyof typeof body)[] = ["code", "description", "stallId"];
  for (const key of strings) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string") throw new HttpError(400, `${key} must be a string`);
    update[key] = key === "code" ? body[key].trim().toUpperCase() : body[key];
  }
  if (typeof update.code === "string" && !/^[A-Z0-9_-]{3,32}$/.test(update.code)) {
    throw new HttpError(400, "code must be 3-32 letters, numbers, underscores or hyphens");
  }
  const numbers: (keyof typeof body)[] = [
    "value",
    "minSubtotal",
    "maxDiscount",
    "usageLimit",
    "usedCount",
    "perUserLimit",
  ];
  for (const key of numbers) {
    if (body[key] !== undefined) update[key] = toNumber(body[key], key);
  }
  for (const key of ["active"] as const) {
    if (typeof body[key] === "boolean") update[key] = body[key];
  }
  for (const key of ["startsAt", "expiresAt"] as const) {
    if (key in body) update[key] = toNullableDate(body[key], key);
  }

  if (body.type !== undefined) {
    if (typeof body.type !== "string" || !["percent", "fixed", "free_delivery"].includes(body.type)) {
      throw new HttpError(400, "type must be percent, fixed or free_delivery");
    }
    update.type = body.type;
  }

  const current = await PromoModel.findById(id).lean();
  if (!current) throw new HttpError(404, "Promo not found");
  const nextType = (update.type ?? current.type) as PromoType;
  const nextValue = typeof update.value === "number" ? update.value : current.value;
  if (nextType === "percent" && nextValue > 100) {
    throw new HttpError(400, "Percent promo value cannot exceed 100");
  }
  const nextStart = "startsAt" in update ? update.startsAt as Date | null : current.startsAt;
  const nextExpiry = "expiresAt" in update ? update.expiresAt as Date | null : current.expiresAt;
  if (nextStart && nextExpiry && new Date(nextStart) >= new Date(nextExpiry)) {
    throw new HttpError(400, "expiresAt must be later than startsAt");
  }

  const promo = await PromoModel.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).lean();
  if (!promo) throw new HttpError(404, "Promo not found");
  await logAudit(req, {
    category: "promo",
    action: "promo.updated",
    targetType: "Promo",
    targetId: String(id),
    meta: { update },
  });
  res.status(200).json({ data: promo });
}

/** Admin: delete a promo. */
export async function deletePromo(req: Request, res: Response): Promise<void> {
  await requireAdmin(req);
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid promo id");
  const promo = await PromoModel.findByIdAndDelete(id).lean();
  if (!promo) throw new HttpError(404, "Promo not found");
  await logAudit(req, {
    category: "promo",
    action: "promo.deleted",
    targetType: "Promo",
    targetId: String(id),
    meta: { code: promo.code },
  });
  res.status(200).json({ data: { success: true } });
}
