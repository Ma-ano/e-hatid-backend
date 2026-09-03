import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parsePsgcCsv, validatePsgcRows } from "../services/psgcImportService.js";
import {
  renderRiderLocationPage,
  renderSeoNotFound,
  safeJsonLd,
  type RiderPageData,
} from "../services/riderRecruitmentPage.js";

function pageData(overrides?: Partial<RiderPageData["recruitment"]>): RiderPageData {
  return {
    recruitment: {
      _id: "recruitment-id",
      geographicLocationId: "location-id",
      psgcCode: "0304903000",
      slug: "cabanatuan-city",
      recruitmentStatus: "coming_soon",
      isPublished: true,
      isIndexable: false,
      headline: "E-Hatid rider applications in Cabanatuan City",
      introduction: "Verified location information with current application status.",
      localInformation: ["Cabanatuan City is in Nueva Ecija."],
      benefits: ["Applications use the existing E-Hatid account."],
      requirements: ["An E-Hatid account is required."],
      faqs: [{ question: "Are applications open?", answer: "Not currently." }],
      applicationNotes: "Approval is not guaranteed.",
      seoTitle: "Rider application information in Cabanatuan City | E-Hatid",
      metaDescription: "Current E-Hatid rider application information for Cabanatuan City.",
      validThrough: null,
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedBy: "test",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      ...overrides,
    },
    location: {
      _id: "location-id",
      psgcCode: "0304903000",
      correspondenceCode: "034903000",
      officialName: "City of Cabanatuan",
      displayName: "Cabanatuan City",
      slug: "cabanatuan-city",
      previousSlugs: [],
      geographicLevel: "city",
      parentPsgcCode: "0304900000",
      regionPsgcCode: "0300000000",
      provincePsgcCode: "0304900000",
      cityMunicipalityPsgcCode: "0304903000",
      cityClassification: "Component City",
      incomeClassification: "1st",
      oldName: "",
      sourceStatus: "",
      urbanRural: "",
      islandGroup: "Luzon",
      isActive: true,
      source: {
        provider: "Philippine Statistics Authority",
        dataset: "Philippine Standard Geographic Code",
        version: "PSGC-2026-Q2-2026-06-30",
        effectiveDate: new Date("2026-06-30T00:00:00.000Z"),
        sourceUrl: "https://psa.gov.ph/classification/psgc",
        importedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    ancestors: [],
    related: [],
    childLocations: [],
  } as unknown as RiderPageData;
}

test("Cabanatuan SSR includes useful HTML, canonical metadata, FAQ JSON-LD, and noindex status", () => {
  const html = renderRiderLocationPage(pageData(), "https://e-hatid.vercel.app");
  assert.match(html, /<title>Rider application information in Cabanatuan City \| E-Hatid<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/e-hatid\.vercel\.app\/riders\/cabanatuan-city">/);
  assert.match(html, /<h1>E-Hatid rider applications in Cabanatuan City<\/h1>/);
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.doesNotMatch(html, /"@type":"JobPosting"/);
  assert.match(html, /<script defer src="\/_vercel\/speed-insights\/script\.js"/);
});

test("active published recruitment emits JobPosting without inventing salary", () => {
  const html = renderRiderLocationPage(pageData({ recruitmentStatus: "active", isIndexable: true }), "https://e-hatid.vercel.app");
  assert.match(html, /<meta name="robots" content="index,follow">/);
  assert.match(html, /"@type":"JobPosting"/);
  assert.doesNotMatch(html, /baseSalary/);
});

test("JSON-LD serialization neutralizes executable tag content", () => {
  const json = safeJsonLd({ value: "</script><script>alert(1)</script>" });
  assert.doesNotMatch(json, /<\/script>/);
  assert.match(json, /\\u003c\/script\\u003e/);
});

test("SEO 404 document is a real noindex HTML response body", () => {
  const html = renderSeoNotFound("https://e-hatid.vercel.app");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<h1>Rider location not found<\/h1>/);
});

test("committed Luzon inventory passes hierarchy and priority completeness validation", async () => {
  const csv = await fs.readFile(path.resolve("data/psgc/psgc-luzon-2026-06-30.csv"), "utf8");
  const rows = parsePsgcCsv(csv);
  const counts = validatePsgcRows(rows);
  assert.deepEqual(counts, {
    total: 21330,
    regions: 8,
    provinces: 38,
    cities: 77,
    municipalities: 694,
    submunicipalities: 14,
    barangays: 20499,
  });
});

test("duplicate PSGC slugs are rejected before database writes", async () => {
  const csv = await fs.readFile(path.resolve("data/psgc/psgc-luzon-2026-06-30.csv"), "utf8");
  const rows = parsePsgcCsv(csv);
  const first = rows[0];
  const second = rows[1];
  assert.ok(first && second);
  second.suggestedSlug = first.suggestedSlug;
  assert.throws(() => validatePsgcRows(rows), /Duplicate suggested slug/);
});
