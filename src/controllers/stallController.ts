import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { StallModel } from "../models/stall.js";

interface StallInput {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  logo?: unknown;
  deliveryTime?: unknown;
  deliveryFee?: unknown;
  minOrder?: unknown;
  category?: unknown;
  cuisine?: unknown;
  accentColor?: unknown;
  active?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  isNew?: unknown;
  menu?: unknown;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function nullableNum(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

export async function listStalls(req: Request, res: Response): Promise<void> {
  const { category, search } = req.query as { category?: string; search?: string };
  const filter: Record<string, unknown> = {};
  if (category && category !== "All") {
    filter.category = category;
  }
  if (search && search.trim() !== "") {
    const q = search.trim();
    filter.$or = [{ name: { $regex: q, $options: "i" } }, { cuisine: { $regex: q, $options: "i" } }];
  }
  const stalls = await StallModel.find(filter).sort({ rating: -1 }).lean();
  res.status(200).json({ data: stalls });
}

export async function listMyStalls(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const stalls = await StallModel.find({ vendorId: authReq.user?.sub ?? "" }).lean();
  res.status(200).json({ data: stalls });
}

export async function getStall(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    throw new HttpError(400, "Invalid stall id");
  }
  const stall = await StallModel.findById(id).lean();
  if (!stall) {
    throw new HttpError(404, "Stall not found");
  }
  res.status(200).json({ data: stall });
}

export async function createStall(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const body = req.body as StallInput;
  if (typeof body.name !== "string" || body.name.trim() === "") {
    throw new HttpError(400, "stall name is required");
  }

  const stall = await StallModel.create({
    name: body.name.trim(),
    description: str(body.description),
    image: str(body.image),
    logo: str(body.logo),
    rating: 0,
    deliveryTime: str(body.deliveryTime),
    deliveryFee: num(body.deliveryFee),
    minOrder: num(body.minOrder),
    vendorId: authReq.user?.sub ?? "",
    category: str(body.category, "Fast Food"),
    cuisine: str(body.cuisine),
    accentColor: str(body.accentColor, "#5B21B6"),
    active: bool(body.active, true),
    address: str(body.address),
    latitude: nullableNum(body.latitude),
    longitude: nullableNum(body.longitude),
    menu: Array.isArray(body.menu) ? body.menu : [],
  });

  res.status(201).json({ data: stall });
}

export async function updateStall(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid stall id");

  const stall = await StallModel.findById(id).lean();
  if (!stall) {
    throw new HttpError(404, "Stall not found");
  }

  const admin = (authReq.user?.activeRole ?? authReq.user?.role) === "admin";
  const owner = stall.vendorId === authReq.user?.sub;
  if (!owner && !admin) {
    throw new HttpError(403, "You do not have permission to edit this stall");
  }

  const body = req.body as StallInput;
  const update: Record<string, unknown> = {};
  if ("name" in body) update.name = str(body.name);
  if ("description" in body) update.description = str(body.description);
  if ("image" in body) update.image = str(body.image);
  if ("logo" in body) update.logo = str(body.logo);
  if ("deliveryTime" in body) update.deliveryTime = str(body.deliveryTime);
  if ("deliveryFee" in body) update.deliveryFee = num(body.deliveryFee);
  if ("minOrder" in body) update.minOrder = num(body.minOrder);
  if ("category" in body) update.category = str(body.category);
  if ("cuisine" in body) update.cuisine = str(body.cuisine);
  if ("accentColor" in body) update.accentColor = str(body.accentColor);
  if ("active" in body) update.active = bool(body.active);
  if ("address" in body) update.address = str(body.address);
  if ("latitude" in body) update.latitude = nullableNum(body.latitude);
  if ("longitude" in body) update.longitude = nullableNum(body.longitude);
  if ("isNew" in body) update.isNew = bool(body.isNew);

  const updated = await StallModel.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  }).lean();
  res.status(200).json({ data: updated });
}

export async function updateStallMenu(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid stall id");

  const menu = req.body?.menu;
  if (!Array.isArray(menu)) {
    throw new HttpError(400, "menu must be an array of menu items");
  }

  const stall = await StallModel.findById(id).lean();
  if (!stall) {
    throw new HttpError(404, "Stall not found");
  }
  const admin = (authReq.user?.activeRole ?? authReq.user?.role) === "admin";
  const owner = stall.vendorId === authReq.user?.sub;
  if (!owner && !admin) {
    throw new HttpError(403, "You do not have permission to edit this stall's menu");
  }

  const updated = await StallModel.findByIdAndUpdate(id, { menu }, { new: true }).lean();
  res.status(200).json({ data: updated });
}

export async function deleteStall(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    throw new HttpError(400, "Invalid stall id");
  }
  const stall = await StallModel.findByIdAndDelete(id);
  if (!stall) {
    throw new HttpError(404, "Stall not found");
  }
  res.status(204).send();
}
