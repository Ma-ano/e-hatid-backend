import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { StallModel } from "../models/stall.js";
import { logAudit } from "../services/auditLogService.js";
import { getDbUser } from "../middlewares/auth.js";

interface StallInput {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  logo?: unknown;
  prepTimeMin?: unknown;
  prepTimeMax?: unknown;
  deliveryTime?: unknown;
  deliveryFee?: unknown;
  minOrder?: unknown;
  category?: unknown;
  cuisine?: unknown;
  accentColor?: unknown;
  active?: unknown;
  address?: unknown;
  addressType?: unknown;
  addressUnit?: unknown;
  addressBuilding?: unknown;
  addressBlockLot?: unknown;
  addressStreet?: unknown;
  addressBarangay?: unknown;
  addressCity?: unknown;
  addressProvince?: unknown;
  addressPostalCode?: unknown;
  addressLandmark?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  isNew?: unknown;
  menu?: unknown;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function nonNegativeNumber(v: unknown, field: string, fallback = 0): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new HttpError(400, `${field} must be a non-negative number`);
  }
  return v;
}

function preparationMinutes(v: unknown, field: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 240) {
    throw new HttpError(400, `${field} must be a whole number between 1 and 240`);
  }
  return v;
}

function coordinate(v: unknown, field: "latitude" | "longitude"): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new HttpError(400, `${field} must be a finite number or null`);
  }
  const limit = field === "latitude" ? 90 : 180;
  if (v < -limit || v > limit) {
    throw new HttpError(400, `${field} is outside its valid range`);
  }
  return v;
}

const structuredAddressFields = [
  "addressType",
  "addressUnit",
  "addressBuilding",
  "addressBlockLot",
  "addressStreet",
  "addressBarangay",
  "addressCity",
  "addressProvince",
  "addressPostalCode",
  "addressLandmark",
] as const;

export interface StructuredStallAddress {
  addressType: "standalone" | "building";
  addressUnit: string;
  addressBuilding: string;
  addressBlockLot: string;
  addressStreet: string;
  addressBarangay: string;
  addressCity: string;
  addressProvince: string;
  addressPostalCode: string;
  addressLandmark: string;
}

function addressPart(value: unknown, field: string, maxLength = 120): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new HttpError(400, `${field} is too long`);
  return normalized;
}

function readStructuredAddress(body: StallInput, existing?: Record<string, unknown>): StructuredStallAddress {
  const read = (field: keyof StructuredStallAddress, maxLength = 120) =>
    addressPart(field in body ? body[field] : existing?.[field], field, maxLength);
  const rawType = "addressType" in body ? body.addressType : existing?.addressType;
  const addressType = rawType === "building" ? "building" : rawType === "standalone" || rawType == null ? "standalone" : null;
  if (!addressType) throw new HttpError(400, "addressType must be standalone or building");
  return {
    addressType,
    addressUnit: read("addressUnit", 80),
    addressBuilding: read("addressBuilding"),
    addressBlockLot: read("addressBlockLot", 80),
    addressStreet: read("addressStreet"),
    addressBarangay: read("addressBarangay"),
    addressCity: read("addressCity"),
    addressProvince: read("addressProvince"),
    addressPostalCode: read("addressPostalCode", 12),
    addressLandmark: read("addressLandmark", 200),
  };
}

export function validateAndComposeStallAddress(parts: StructuredStallAddress): string {
  if (parts.addressType === "building" && !parts.addressBuilding) {
    throw new HttpError(400, "Building or mall name is required for a building stall");
  }
  if (parts.addressType === "standalone" && !parts.addressBlockLot) {
    throw new HttpError(400, "Block, lot, house, or store number is required for a standalone stall");
  }
  if (!parts.addressStreet || !parts.addressBarangay || !parts.addressCity || !parts.addressProvince) {
    throw new HttpError(400, "Street, barangay, city or municipality, and province are required");
  }
  if (parts.addressPostalCode && !/^\d{4}$/.test(parts.addressPostalCode)) {
    throw new HttpError(400, "addressPostalCode must be a 4-digit Philippine postal code");
  }
  const address = [
    parts.addressUnit,
    parts.addressBuilding,
    parts.addressBlockLot,
    parts.addressStreet,
    parts.addressBarangay,
    parts.addressCity,
    parts.addressProvince,
    parts.addressPostalCode,
  ].filter(Boolean).join(", ");
  if (address.length > 500) throw new HttpError(400, "Stall address is too long");
  return address;
}

function hasStructuredAddress(body: StallInput): boolean {
  return structuredAddressFields.some((field) => field in body);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listStalls(req: Request, res: Response): Promise<void> {
  const { category, search } = req.query as { category?: string; search?: string };
  const filter: Record<string, unknown> = {};
  if (category && category !== "All") {
    filter.category = category;
  }
  if (search && search.trim() !== "") {
    const q = escapeRegex(search.trim().slice(0, 100));
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
  const prepTimeMin = preparationMinutes(body.prepTimeMin, "prepTimeMin", 15);
  const prepTimeMax = preparationMinutes(body.prepTimeMax, "prepTimeMax", 25);
  if (prepTimeMax < prepTimeMin) {
    throw new HttpError(400, "prepTimeMax must be greater than or equal to prepTimeMin");
  }
  const structuredAddress = hasStructuredAddress(body) ? readStructuredAddress(body) : null;
  const address = structuredAddress
    ? validateAndComposeStallAddress(structuredAddress)
    : addressPart(body.address, "address", 500);
  const latitude = coordinate(body.latitude, "latitude");
  const longitude = coordinate(body.longitude, "longitude");
  if ((latitude === null) !== (longitude === null)) {
    throw new HttpError(400, "Both latitude and longitude are required together");
  }
  if (structuredAddress && (latitude === null || longitude === null)) {
    throw new HttpError(400, "Choose an exact map location for the structured stall address");
  }

  const stall = await StallModel.create({
    name: body.name.trim(),
    description: str(body.description),
    image: str(body.image),
    logo: str(body.logo),
    rating: 0,
    prepTimeMin,
    prepTimeMax,
    deliveryTime: `${prepTimeMin}-${prepTimeMax} min`,
    deliveryFee: nonNegativeNumber(body.deliveryFee, "deliveryFee"),
    minOrder: nonNegativeNumber(body.minOrder, "minOrder"),
    vendorId: authReq.user?.sub ?? "",
    category: str(body.category, "Fast Food"),
    cuisine: str(body.cuisine),
    accentColor: str(body.accentColor, "#5B21B6"),
    active: bool(body.active, true),
    address,
    ...(structuredAddress ?? {}),
    latitude,
    longitude,
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

  const dbUser = getDbUser(req) as { roles?: string[] } | undefined;
  const admin = dbUser?.roles?.includes("admin") === true;
  const owner = stall.vendorId === authReq.user?.sub;
  if (!owner && !admin) {
    throw new HttpError(403, "You do not have permission to edit this stall");
  }

  const body = req.body as StallInput;
  const update: Record<string, unknown> = {};
  const nextLatitude = "latitude" in body ? coordinate(body.latitude, "latitude") : stall.latitude ?? null;
  const nextLongitude = "longitude" in body ? coordinate(body.longitude, "longitude") : stall.longitude ?? null;
  if ((nextLatitude === null) !== (nextLongitude === null)) {
    throw new HttpError(400, "Both latitude and longitude are required together");
  }
  if ("name" in body) update.name = str(body.name);
  if ("description" in body) update.description = str(body.description);
  if ("image" in body) update.image = str(body.image);
  if ("logo" in body) update.logo = str(body.logo);
  if ("deliveryTime" in body) update.deliveryTime = str(body.deliveryTime);
  const prepTimeMin = "prepTimeMin" in body
    ? preparationMinutes(body.prepTimeMin, "prepTimeMin", 15)
    : Number(stall.prepTimeMin ?? 15);
  const prepTimeMax = "prepTimeMax" in body
    ? preparationMinutes(body.prepTimeMax, "prepTimeMax", 25)
    : Number(stall.prepTimeMax ?? 25);
  if (prepTimeMax < prepTimeMin) {
    throw new HttpError(400, "prepTimeMax must be greater than or equal to prepTimeMin");
  }
  if ("prepTimeMin" in body || "prepTimeMax" in body) {
    update.prepTimeMin = prepTimeMin;
    update.prepTimeMax = prepTimeMax;
    update.deliveryTime = `${prepTimeMin}-${prepTimeMax} min`;
  }
  if ("deliveryFee" in body) update.deliveryFee = nonNegativeNumber(body.deliveryFee, "deliveryFee");
  if ("minOrder" in body) update.minOrder = nonNegativeNumber(body.minOrder, "minOrder");
  if ("category" in body) update.category = str(body.category);
  if ("cuisine" in body) update.cuisine = str(body.cuisine);
  if ("accentColor" in body) update.accentColor = str(body.accentColor);
  if ("active" in body) update.active = bool(body.active);
  if (hasStructuredAddress(body)) {
    const structuredAddress = readStructuredAddress(body, stall as unknown as Record<string, unknown>);
    if (nextLatitude === null || nextLongitude === null) {
      throw new HttpError(400, "Choose an exact map location for the structured stall address");
    }
    update.address = validateAndComposeStallAddress(structuredAddress);
    Object.assign(update, structuredAddress);
  } else if ("address" in body) {
    update.address = addressPart(body.address, "address", 500);
  }
  if ("latitude" in body) update.latitude = nextLatitude;
  if ("longitude" in body) update.longitude = nextLongitude;
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
  const dbUser = getDbUser(req) as { roles?: string[] } | undefined;
  const admin = dbUser?.roles?.includes("admin") === true;
  const owner = stall.vendorId === authReq.user?.sub;
  if (!owner && !admin) {
    throw new HttpError(403, "You do not have permission to edit this stall's menu");
  }

  const updated = await StallModel.findByIdAndUpdate(id, { menu }, { new: true, runValidators: true }).lean();
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
  await logAudit(req, {
    category: "stall",
    action: "stall.deleted",
    targetType: "Stall",
    targetId: String(id),
    meta: { name: stall.name },
  });
  res.status(204).send();
}
