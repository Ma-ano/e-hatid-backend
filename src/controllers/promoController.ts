import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { PromoModel, type PromoType } from "../models/promo.js";
import { UserModel } from "../models/user.js";
import { previewPromo } from "../services/promoService.js";

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

function toNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function toNullableDate(v: unknown): Date | null {
  if (typeof v === "string" && v !== "") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
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
      subtotal: toNumber(subtotal),
    },
    toNumber(deliveryFee),
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
  if (!code) throw new HttpError(400, "code required");
  if (!["percent", "fixed", "free_delivery"].includes(type)) {
    throw new HttpError(400, "type must be percent, fixed or free_delivery");
  }

  const exists = await PromoModel.findOne({ code }).lean();
  if (exists) throw new HttpError(409, "Promo code already exists");

  const promo = await PromoModel.create({
    code,
    type,
    value: toNumber(body.value),
    minSubtotal: toNumber(body.minSubtotal),
    maxDiscount: toNumber(body.maxDiscount),
    usageLimit: toNumber(body.usageLimit),
    perUserLimit: toNumber(body.perUserLimit, 1),
    startsAt: toNullableDate(body.startsAt),
    expiresAt: toNullableDate(body.expiresAt),
    stallId: typeof body.stallId === "string" ? body.stallId : "",
    active: body.active !== false,
    description: typeof body.description === "string" ? body.description : "",
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
    if (typeof body[key] === "string") update[key] = key === "code" ? body[key].trim().toUpperCase() : body[key];
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
    if (typeof body[key] === "number" && Number.isFinite(body[key])) update[key] = body[key];
  }
  for (const key of ["active"] as const) {
    if (typeof body[key] === "boolean") update[key] = body[key];
  }
  for (const key of ["startsAt", "expiresAt"] as const) {
    const d = toNullableDate(body[key]);
    update[key] = d;
  }

  if (typeof body.type === "string" && ["percent", "fixed", "free_delivery"].includes(body.type)) {
    update.type = body.type;
  }

  const promo = await PromoModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!promo) throw new HttpError(404, "Promo not found");
  res.status(200).json({ data: promo });
}

/** Admin: delete a promo. */
export async function deletePromo(req: Request, res: Response): Promise<void> {
  await requireAdmin(req);
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid promo id");
  const promo = await PromoModel.findByIdAndDelete(id).lean();
  if (!promo) throw new HttpError(404, "Promo not found");
  res.status(200).json({ data: { success: true } });
}
