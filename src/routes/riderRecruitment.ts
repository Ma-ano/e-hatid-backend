import { Router, type Request, type Response } from "express";

import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import { HttpError } from "../middlewares/errorHandler.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import { GeographicLocationModel } from "../models/geographicLocation.js";
import { RiderRecruitmentLocationModel } from "../models/riderRecruitmentLocation.js";

export const riderRecruitmentRouter = Router();
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function getPublicRecruitmentLocation(req: Request, res: Response): Promise<void> {
  const rawSlug = req.params.slug;
  const slug = Array.isArray(rawSlug) ? (rawSlug[0] ?? "") : (rawSlug ?? "");
  if (!SLUG.test(slug) || slug.length > 120) throw new HttpError(404, "Rider location not found");
  const recruitment = await RiderRecruitmentLocationModel.findOne({ slug, isPublished: true }).lean();
  if (!recruitment) throw new HttpError(404, "Rider location not found");
  const location = await GeographicLocationModel.findOne({ psgcCode: recruitment.psgcCode, isActive: true }).lean();
  if (!location) throw new HttpError(404, "Rider location not found");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.status(200).json({ data: { recruitment, location } });
}

riderRecruitmentRouter.get(
  "/:slug",
  rateLimit({ windowMs: 60_000, max: 60, message: "Too many rider-location requests" }),
  getPublicRecruitmentLocation,
);

riderRecruitmentRouter.use("/admin", requireAuth, requireRole("admin"));

riderRecruitmentRouter.get("/admin/all", async (_req: Request, res: Response) => {
  const records = await RiderRecruitmentLocationModel.find().sort({ updatedAt: -1 }).limit(500).lean();
  const geo = await GeographicLocationModel.find({ psgcCode: { $in: records.map((item) => item.psgcCode) } }).lean();
  const byCode = new Map(geo.map((item) => [item.psgcCode, item]));
  res.status(200).json({ data: records.map((item) => ({ ...item, location: byCode.get(item.psgcCode) ?? null })) });
});

riderRecruitmentRouter.put("/admin/:id", csrfProtect, async (req: Request, res: Response) => {
  const allowed = [
    "recruitmentStatus", "isPublished", "isIndexable", "headline", "introduction", "localInformation",
    "benefits", "requirements", "faqs", "applicationNotes", "seoTitle", "metaDescription", "salary",
    "validThrough",
  ] as const;
  const input = req.body as Record<string, unknown>;
  const unsupported = Object.keys(input).filter((key) => !allowed.includes(key as (typeof allowed)[number]));
  if (unsupported.length > 0) throw new HttpError(400, `Unsupported fields: ${unsupported.join(", ")}`);
  const existing = await RiderRecruitmentLocationModel.findById(req.params.id).lean();
  if (!existing) throw new HttpError(404, "Rider recruitment location not found");
  const nextStatus = typeof input.recruitmentStatus === "string" ? input.recruitmentStatus : existing.recruitmentStatus;
  const nextPublished = typeof input.isPublished === "boolean" ? input.isPublished : existing.isPublished;
  const nextIndexable = typeof input.isIndexable === "boolean" ? input.isIndexable : existing.isIndexable;
  if (nextIndexable && (!nextPublished || nextStatus !== "active")) {
    throw new HttpError(400, "Only active, published recruitment pages may be indexable");
  }
  const update = Object.fromEntries(allowed.filter((key) => key in input).map((key) => [key, input[key]]));
  const user = (req as Request & { user?: { sub?: string } }).user;
  update.updatedBy = user?.sub ?? "admin";
  if (update.isPublished === true) update.publishedAt = new Date();
  const record = await RiderRecruitmentLocationModel.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (!record) throw new HttpError(404, "Rider recruitment location not found");
  res.status(200).json({ data: record });
});
