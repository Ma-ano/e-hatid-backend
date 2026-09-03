import { Router, type Request, type Response } from "express";

import { env } from "../config/env.js";
import { GeographicLocationModel } from "../models/geographicLocation.js";
import { RiderRecruitmentLocationModel } from "../models/riderRecruitmentLocation.js";
import {
  renderRiderHubPage,
  renderRiderLocationPage,
  renderSeoNotFound,
  type RiderPageData,
} from "../services/riderRecruitmentPage.js";

export const seoRouter = Router();
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function publicHeaders(res: Response, options?: { indexable?: boolean }): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'sha256-CyAli5hxFdPn77k9SirZTbMGSL55oU2ky9gjJsfH+lo='; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", options?.indexable ? "index, follow" : "noindex, follow");
  res.setHeader("Cache-Control", options?.indexable
    ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    : "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");
}

async function findPageData(slug: string): Promise<RiderPageData | null> {
  const recruitment = await RiderRecruitmentLocationModel.findOne({ slug, isPublished: true }).lean();
  if (!recruitment) return null;
  const location = await GeographicLocationModel.findOne({ psgcCode: recruitment.psgcCode, isActive: true }).lean();
  if (!location) return null;
  const ancestors = [];
  let parentCode = location.parentPsgcCode;
  for (let depth = 0; parentCode && depth < 4; depth += 1) {
    const parent = await GeographicLocationModel.findOne({ psgcCode: parentCode, isActive: true }).lean();
    if (!parent) break;
    ancestors.unshift(parent);
    parentCode = parent.parentPsgcCode;
  }
  const publishedAncestors = await RiderRecruitmentLocationModel.find({
    psgcCode: { $in: ancestors.map((item) => item.psgcCode) },
    isPublished: true,
  }, { psgcCode: 1 }).lean();
  const publishedAncestorCodes = new Set(publishedAncestors.map((item) => item.psgcCode));
  const siblingLocations = await GeographicLocationModel.find({
    parentPsgcCode: location.parentPsgcCode,
    psgcCode: { $ne: location.psgcCode },
    isActive: true,
    geographicLevel: { $in: ["province", "city", "municipality"] },
  }).limit(12).lean();
  const childGeo = await GeographicLocationModel.find({
    parentPsgcCode: location.psgcCode,
    isActive: true,
    geographicLevel: { $in: ["city", "municipality"] },
  }).sort({ displayName: 1 }).lean();
  const relatedRecruitment = await RiderRecruitmentLocationModel.find({
    psgcCode: { $in: siblingLocations.map((item) => item.psgcCode) },
    isPublished: true,
  }).lean();
  const childRecruitment = await RiderRecruitmentLocationModel.find({
    psgcCode: { $in: childGeo.map((item) => item.psgcCode) },
    isPublished: true,
  }).lean();
  const siblingByCode = new Map(siblingLocations.map((item) => [item.psgcCode, item]));
  const childByCode = new Map(childGeo.map((item) => [item.psgcCode, item]));
  return {
    recruitment,
    location,
    ancestors: ancestors.filter((item) => publishedAncestorCodes.has(item.psgcCode)),
    related: relatedRecruitment.flatMap((item) => {
      const geo = siblingByCode.get(item.psgcCode);
      return geo ? [{ slug: item.slug, displayName: geo.displayName, recruitmentStatus: item.recruitmentStatus }] : [];
    }),
    childLocations: childRecruitment.flatMap((item) => {
      const geo = childByCode.get(item.psgcCode);
      return geo ? [{ slug: item.slug, displayName: geo.displayName, geographicLevel: geo.geographicLevel, recruitmentStatus: item.recruitmentStatus }] : [];
    }),
  };
}

seoRouter.get("/riders", async (_req: Request, res: Response) => {
  const recruitment = await RiderRecruitmentLocationModel.find({ isPublished: true }).sort({ slug: 1 }).lean();
  const geo = await GeographicLocationModel.find({ psgcCode: { $in: recruitment.map((item) => item.psgcCode) }, isActive: true }).lean();
  const byCode = new Map(geo.map((item) => [item.psgcCode, item]));
  const items = recruitment.flatMap((item) => {
    const location = byCode.get(item.psgcCode);
    return location ? [{ slug: item.slug, displayName: location.displayName, recruitmentStatus: item.recruitmentStatus }] : [];
  });
  publicHeaders(res, { indexable: true });
  res.status(200).send(renderRiderHubPage(items, env.publicSiteUrl));
});

seoRouter.get("/riders/:slug", async (req: Request, res: Response) => {
  const rawSlug = req.params.slug;
  const slug = Array.isArray(rawSlug) ? (rawSlug[0] ?? "") : (rawSlug ?? "");
  if (!SLUG.test(slug) || slug.length > 120) {
    publicHeaders(res);
    res.status(404).send(renderSeoNotFound(env.publicSiteUrl));
    return;
  }
  const page = await findPageData(slug);
  if (!page) {
    const oldLocation = await GeographicLocationModel.findOne({ previousSlugs: slug, isActive: true }).lean();
    if (oldLocation) {
      const target = await RiderRecruitmentLocationModel.findOne({ psgcCode: oldLocation.psgcCode, isPublished: true }).lean();
      if (target) {
        res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
        res.redirect(301, `/riders/${target.slug}`);
        return;
      }
    }
    publicHeaders(res);
    res.status(404).send(renderSeoNotFound(env.publicSiteUrl));
    return;
  }
  publicHeaders(res, { indexable: page.recruitment.isIndexable && page.recruitment.recruitmentStatus === "active" });
  res.status(200).send(renderRiderLocationPage(page, env.publicSiteUrl));
});

seoRouter.get("/sitemap.xml", async (_req: Request, res: Response) => {
  const pages = await RiderRecruitmentLocationModel.find({
    recruitmentStatus: "active",
    isPublished: true,
    isIndexable: true,
  }).sort({ slug: 1 }).lean();
  const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  const urls = [
    `<url><loc>${escapeXml(`${env.publicSiteUrl}/riders`)}</loc></url>`,
    ...pages.map((page) => `<url><loc>${escapeXml(`${env.publicSiteUrl}/riders/${page.slug}`)}</loc><lastmod>${page.updatedAt.toISOString()}</lastmod></url>`),
  ];
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.removeHeader("X-Robots-Tag");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
});

seoRouter.get("/robots.txt", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.removeHeader("X-Robots-Tag");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${env.publicSiteUrl}/sitemap.xml\n`);
});
