import { Router, type Request, type Response } from "express";

import { rateLimit } from "../middlewares/rateLimit.js";
import { HttpError } from "../middlewares/errorHandler.js";
import { GEOGRAPHIC_LEVELS, GeographicLocationModel } from "../models/geographicLocation.js";

export const locationsRouter = Router();
const publicLimit = rateLimit({ windowMs: 60_000, max: 90, message: "Too many location requests" });
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pagination(req: Request): { page: number; limit: number; skip: number } {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 30);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "page must be positive and limit must be between 1 and 100");
  }
  return { page, limit, skip: (page - 1) * limit };
}

function publicProjection() {
  return {
    _id: 0,
    psgcCode: 1,
    correspondenceCode: 1,
    officialName: 1,
    displayName: 1,
    slug: 1,
    geographicLevel: 1,
    parentPsgcCode: 1,
    regionPsgcCode: 1,
    provincePsgcCode: 1,
    cityMunicipalityPsgcCode: 1,
    cityClassification: 1,
    incomeClassification: 1,
    urbanRural: 1,
    islandGroup: 1,
    source: 1,
  };
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

locationsRouter.use(publicLimit);

locationsRouter.get("/regions", async (req: Request, res: Response) => {
  const { page, limit, skip } = pagination(req);
  const filter: Record<string, unknown> = { geographicLevel: "region", islandGroup: "Luzon", isActive: true };
  const [items, total] = await Promise.all([
    GeographicLocationModel.find(filter).select(publicProjection()).sort({ psgcCode: 1 }).skip(skip).limit(limit).lean(),
    GeographicLocationModel.countDocuments(filter),
  ]);
  res.status(200).json({ data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

locationsRouter.get("/search", async (req: Request, res: Response) => {
  const { page, limit, skip } = pagination(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const level = typeof req.query.level === "string" ? req.query.level : "";
  if (level && !GEOGRAPHIC_LEVELS.includes(level as (typeof GEOGRAPHIC_LEVELS)[number])) {
    throw new HttpError(400, "Unsupported geographic level");
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter: Record<string, unknown> = { islandGroup: "Luzon", isActive: true };
  if (q) filter.$or = [
    { displayName: { $regex: escaped, $options: "i" } },
    { officialName: { $regex: escaped, $options: "i" } },
    { psgcCode: q },
  ];
  if (level) filter.geographicLevel = level;
  if (typeof req.query.parentPsgcCode === "string" && /^\d{10}$/.test(req.query.parentPsgcCode)) {
    filter.parentPsgcCode = req.query.parentPsgcCode;
  }
  const [items, total] = await Promise.all([
    GeographicLocationModel.find(filter, publicProjection()).sort({ geographicLevel: 1, displayName: 1 }).skip(skip).limit(limit).lean(),
    GeographicLocationModel.countDocuments(filter),
  ]);
  res.status(200).json({ data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

locationsRouter.get("/code/:psgcCode/children", async (req: Request, res: Response) => {
  const { page, limit, skip } = pagination(req);
  const psgcCode = firstParam(req.params.psgcCode);
  if (!/^\d{10}$/.test(psgcCode)) throw new HttpError(404, "Location not found");
  const parent = await GeographicLocationModel.exists({ psgcCode, isActive: true });
  if (!parent) throw new HttpError(404, "Location not found");
  const filter = { parentPsgcCode: psgcCode, isActive: true };
  const [items, total] = await Promise.all([
    GeographicLocationModel.find(filter).select(publicProjection()).sort({ geographicLevel: 1, displayName: 1 }).skip(skip).limit(limit).lean(),
    GeographicLocationModel.countDocuments(filter),
  ]);
  res.status(200).json({ data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

locationsRouter.get("/:slug", async (req: Request, res: Response) => {
  const slug = firstParam(req.params.slug);
  if (!SLUG.test(slug) || slug.length > 160) throw new HttpError(404, "Location not found");
  const item = await GeographicLocationModel.findOne({ slug, isActive: true }).select(publicProjection()).lean();
  if (!item) throw new HttpError(404, "Location not found");
  res.status(200).json({ data: item });
});
