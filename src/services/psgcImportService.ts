import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { DataImportModel } from "../models/dataImport.js";
import { GEOGRAPHIC_LEVELS, GeographicLocationModel } from "../models/geographicLocation.js";

const SOURCE_URL = "https://psa.gov.ph/classification/psgc";
const SOURCE_EFFECTIVE_DATE = new Date("2026-06-30T00:00:00.000Z");
const EXPECTED_VERSION = "PSGC-2026-Q2-2026-06-30";
const IMPORT_KEY = "psgc-luzon";
const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

export interface PsgcRow {
  psgcCode: string;
  correspondenceCode: string;
  officialName: string;
  displayName: string;
  geographicLevel: (typeof GEOGRAPHIC_LEVELS)[number];
  parentPsgcCode: string;
  regionPsgcCode: string;
  provincePsgcCode: string;
  cityMunicipalityPsgcCode: string;
  cityClassification: string;
  incomeClassification: string;
  oldName: string;
  sourceStatus: string;
  urbanRural: "" | "U" | "R";
  sourceVersion: string;
  suggestedSlug: string;
}

interface ImportCounts {
  total: number;
  regions: number;
  provinces: number;
  cities: number;
  municipalities: number;
  submunicipalities: number;
  barangays: number;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted value");
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function parsePsgcCsv(text: string): PsgcRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error("PSGC CSV is empty");
  const required = [
    "psgcCode", "correspondenceCode", "officialName", "displayName", "geographicLevel",
    "parentPsgcCode", "regionPsgcCode", "provincePsgcCode", "cityMunicipalityPsgcCode",
    "cityClassification", "incomeClassification", "oldName", "sourceStatus", "urbanRural",
    "sourceVersion", "suggestedSlug",
  ] as const;
  const positions = new Map(header.map((name, index) => [name, index]));
  for (const name of required) {
    if (!positions.has(name)) throw new Error(`PSGC CSV is missing column: ${name}`);
  }
  return body.map((values, rowIndex) => {
    const value = (name: (typeof required)[number]) => values[positions.get(name) ?? -1] ?? "";
    const level = value("geographicLevel");
    if (!GEOGRAPHIC_LEVELS.includes(level as (typeof GEOGRAPHIC_LEVELS)[number])) {
      throw new Error(`Invalid geographicLevel at CSV row ${rowIndex + 2}: ${level}`);
    }
    const urbanRural = value("urbanRural");
    if (urbanRural !== "" && urbanRural !== "U" && urbanRural !== "R") {
      throw new Error(`Invalid urbanRural at CSV row ${rowIndex + 2}: ${urbanRural}`);
    }
    return {
      psgcCode: value("psgcCode"),
      correspondenceCode: value("correspondenceCode"),
      officialName: value("officialName"),
      displayName: value("displayName"),
      geographicLevel: level as PsgcRow["geographicLevel"],
      parentPsgcCode: value("parentPsgcCode"),
      regionPsgcCode: value("regionPsgcCode"),
      provincePsgcCode: value("provincePsgcCode"),
      cityMunicipalityPsgcCode: value("cityMunicipalityPsgcCode"),
      cityClassification: value("cityClassification"),
      incomeClassification: value("incomeClassification"),
      oldName: value("oldName"),
      sourceStatus: value("sourceStatus"),
      urbanRural: urbanRural as PsgcRow["urbanRural"],
      sourceVersion: value("sourceVersion"),
      suggestedSlug: value("suggestedSlug"),
    };
  });
}

function countRows(rows: PsgcRow[]): ImportCounts {
  const count = (level: PsgcRow["geographicLevel"]) => rows.filter((row) => row.geographicLevel === level).length;
  return {
    total: rows.length,
    regions: count("region"),
    provinces: count("province"),
    cities: count("city"),
    municipalities: count("municipality"),
    submunicipalities: count("submunicipality"),
    barangays: count("barangay"),
  };
}

export function validatePsgcRows(rows: PsgcRow[]): ImportCounts {
  const errors: string[] = [];
  const byCode = new Map<string, PsgcRow>();
  const slugs = new Set<string>();
  for (const row of rows) {
    if (!/^\d{10}$/.test(row.psgcCode)) errors.push(`Invalid PSGC code: ${row.psgcCode}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.suggestedSlug)) errors.push(`Invalid slug: ${row.suggestedSlug}`);
    if (!row.officialName || !row.displayName) errors.push(`Missing name for ${row.psgcCode}`);
    if (row.sourceVersion !== EXPECTED_VERSION) errors.push(`Unexpected source version for ${row.psgcCode}`);
    if (byCode.has(row.psgcCode)) errors.push(`Duplicate PSGC code: ${row.psgcCode}`);
    if (slugs.has(row.suggestedSlug)) errors.push(`Duplicate suggested slug: ${row.suggestedSlug}`);
    byCode.set(row.psgcCode, row);
    slugs.add(row.suggestedSlug);
  }
  for (const row of rows) {
    if (row.geographicLevel === "region") {
      if (row.parentPsgcCode) errors.push(`Region ${row.psgcCode} must not have a parent`);
      continue;
    }
    const parent = byCode.get(row.parentPsgcCode);
    if (!parent) {
      errors.push(`Missing parent ${row.parentPsgcCode} for ${row.psgcCode}`);
      continue;
    }
    const validParents: Record<PsgcRow["geographicLevel"], PsgcRow["geographicLevel"][]> = {
      region: [],
      province: ["region"],
      city: ["province", "region"],
      municipality: ["province", "region"],
      submunicipality: ["city"],
      barangay: ["city", "municipality", "submunicipality"],
    };
    if (!validParents[row.geographicLevel].includes(parent.geographicLevel)) {
      errors.push(`Invalid parent level ${parent.geographicLevel} for ${row.psgcCode}`);
    }
    if (!byCode.has(row.regionPsgcCode) || byCode.get(row.regionPsgcCode)?.geographicLevel !== "region") {
      errors.push(`Invalid region reference for ${row.psgcCode}`);
    }
  }

  const counts = countRows(rows);
  const ne = rows.filter((row) => row.psgcCode === "0304900000" || row.provincePsgcCode === "0304900000");
  const ncr = rows.filter((row) => row.regionPsgcCode === "1300000000");
  const expected = [
    [counts.regions, 8, "Luzon regions"],
    [counts.provinces, 38, "Luzon provinces"],
    [ne.filter((row) => row.geographicLevel === "city").length, 5, "Nueva Ecija cities"],
    [ne.filter((row) => row.geographicLevel === "municipality").length, 27, "Nueva Ecija municipalities"],
    [ne.filter((row) => row.geographicLevel === "barangay").length, 849, "Nueva Ecija barangays"],
    [ncr.filter((row) => row.geographicLevel === "city").length, 16, "NCR cities"],
    [ncr.filter((row) => row.geographicLevel === "municipality").length, 1, "NCR municipalities"],
    [ncr.filter((row) => row.geographicLevel === "barangay").length, 1715, "NCR barangays"],
  ] as const;
  for (const [actual, wanted, label] of expected) {
    if (actual !== wanted) errors.push(`${label}: expected ${wanted}, received ${actual}`);
  }
  if (errors.length > 0) {
    throw new Error(`PSGC validation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n${errors.slice(0, 50).join("\n")}`);
  }
  return counts;
}

async function acquireImportLock(checksum: string, counts: ImportCounts): Promise<void> {
  const startedAt = new Date();
  try {
    const lock = await DataImportModel.findOneAndUpdate(
      {
        key: IMPORT_KEY,
        $or: [
          { status: { $ne: "running" } },
          { startedAt: { $lt: new Date(Date.now() - LOCK_TIMEOUT_MS) } },
        ],
      },
      {
        $set: {
          provider: "Philippine Statistics Authority",
          dataset: "Philippine Standard Geographic Code",
          sourceVersion: EXPECTED_VERSION,
          sourceUrl: SOURCE_URL,
          effectiveDate: SOURCE_EFFECTIVE_DATE,
          sourceChecksumSha256: checksum,
          importedChecksumSha256: checksum,
          status: "running",
          counts,
          startedAt,
          completedAt: null,
          error: "",
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();
    if (!lock) throw new Error("PSGC import is already running");
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000) {
      throw new Error("PSGC import is already running");
    }
    throw error;
  }
}

export async function importPsgc(options: { sourceFile: string; dryRun?: boolean }): Promise<ImportCounts & { checksum: string }> {
  const sourceFile = path.resolve(options.sourceFile);
  const buffer = await fs.readFile(sourceFile);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const rows = parsePsgcCsv(buffer.toString("utf8"));
  const counts = validatePsgcRows(rows);
  if (options.dryRun) return { ...counts, checksum };

  await acquireImportLock(checksum, counts);
  try {
    const existing = await GeographicLocationModel.find(
      { islandGroup: "Luzon" },
      { psgcCode: 1, slug: 1 },
    ).lean();
    const existingSlugByCode = new Map(existing.map((item) => [item.psgcCode, item.slug]));
    const slugOwners = new Map(existing.map((item) => [item.slug, item.psgcCode]));
    const assigned = new Set<string>();
    const importedAt = new Date();

    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500);
      await GeographicLocationModel.bulkWrite(
        batch.map((row) => {
          let slug = existingSlugByCode.get(row.psgcCode) ?? row.suggestedSlug;
          if (!existingSlugByCode.has(row.psgcCode)) {
            const owner = slugOwners.get(slug);
            if ((owner && owner !== row.psgcCode) || assigned.has(slug)) slug = `${slug}-${row.psgcCode}`;
          }
          assigned.add(slug);
          return {
            updateOne: {
              filter: { psgcCode: row.psgcCode },
              update: {
                $set: {
                  correspondenceCode: row.correspondenceCode,
                  officialName: row.officialName,
                  displayName: row.displayName,
                  geographicLevel: row.geographicLevel,
                  parentPsgcCode: row.parentPsgcCode,
                  regionPsgcCode: row.regionPsgcCode,
                  provincePsgcCode: row.provincePsgcCode,
                  cityMunicipalityPsgcCode: row.cityMunicipalityPsgcCode,
                  cityClassification: row.cityClassification,
                  incomeClassification: row.incomeClassification,
                  oldName: row.oldName,
                  sourceStatus: row.sourceStatus,
                  urbanRural: row.urbanRural,
                  islandGroup: "Luzon",
                  isActive: true,
                  source: {
                    provider: "Philippine Statistics Authority",
                    dataset: "Philippine Standard Geographic Code",
                    version: EXPECTED_VERSION,
                    effectiveDate: SOURCE_EFFECTIVE_DATE,
                    sourceUrl: SOURCE_URL,
                    importedAt,
                  },
                },
                $setOnInsert: { slug, previousSlugs: [] },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }
    await GeographicLocationModel.updateMany(
      { islandGroup: "Luzon", "source.version": { $ne: EXPECTED_VERSION } },
      { $set: { isActive: false } },
    );
    await DataImportModel.updateOne(
      { key: IMPORT_KEY },
      { $set: { status: "complete", completedAt: new Date(), error: "" } },
    );
    return { ...counts, checksum };
  } catch (error) {
    await DataImportModel.updateOne(
      { key: IMPORT_KEY },
      { $set: { status: "failed", completedAt: new Date(), error: error instanceof Error ? error.message : String(error) } },
    );
    throw error;
  }
}
