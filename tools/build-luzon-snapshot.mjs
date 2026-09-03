import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SOURCE_VERSION = "PSGC-2026-Q2-2026-06-30";
const Q2_RELEASE_URL = "https://psa.gov.ph/classification/psgc";

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[\",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayName(name, level) {
  if (level === "city") {
    const match = /^City of (.+)$/i.exec(name);
    if (match) return `${match[1]} City`;
  }
  return name;
}

function readJson(sourceDir, name) {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, name), "utf8"));
}

function toCsv(records, columns) {
  return [
    columns.join(","),
    ...records.map((record) => columns.map((column) => csvCell(record[column])).join(",")),
  ].join("\n") + "\n";
}

function main() {
  const sourceDir = path.resolve(process.argv[2] ?? "");
  const outputFile = path.resolve(process.argv[3] ?? "data/psgc/psgc-luzon-2026-06-30.csv");
  if (!sourceDir || !fs.existsSync(path.join(sourceDir, "regions.json"))) {
    throw new Error("Usage: node tools/build-luzon-snapshot.mjs <source-core-dir> [output.csv]");
  }

  const regions = readJson(sourceDir, "regions.json");
  const provinces = readJson(sourceDir, "provinces.json");
  const cities = readJson(sourceDir, "cities.json");
  const barangays = readJson(sourceDir, "barangays.json");
  const luzonRegionCodes = new Set(
    regions.filter((item) => item.island_group === "luzon").map((item) => item.psgc_code),
  );
  const pseudoProvinceCodes = new Set(provinces.filter((item) => item.is_pseudo).map((item) => item.psgc_code));

  const raw = [
    ...regions
      .filter((item) => luzonRegionCodes.has(item.psgc_code))
      .map((item) => ({ ...item, level: "region", parent: "" })),
    ...provinces
      .filter((item) => luzonRegionCodes.has(item.region_code) && !item.is_pseudo)
      .map((item) => ({ ...item, level: "province", parent: item.region_code })),
    ...cities
      .filter((item) => luzonRegionCodes.has(item.region_code))
      .map((item) => {
        const level = item.geographic_level === "City"
          ? "city"
          : item.geographic_level === "SubMun"
            ? "submunicipality"
            : "municipality";
        const parent = level === "submunicipality"
          ? `${item.psgc_code.slice(0, 5)}00000`
          : item.province_code === item.region_code || pseudoProvinceCodes.has(item.province_code)
            ? item.region_code
            : item.province_code;
        return { ...item, level, parent };
      }),
    ...barangays
      .filter((item) => luzonRegionCodes.has(item.region_code))
      .map((item) => ({ ...item, level: "barangay", parent: item.city_code })),
  ];

  const byCode = new Map(raw.map((item) => [item.psgc_code, item]));
  const q2Correction = raw.find((item) => {
    if (item.level !== "barangay" || item.name !== "Parang Parang") return false;
    const city = byCode.get(item.city_code);
    const province = byCode.get(item.province_code);
    return city?.name === "Orani" && province?.name === "Bataan";
  });
  if (!q2Correction) throw new Error("Could not apply PSA Q2 2026 Parang-Parang correction");
  q2Correction.old_names = q2Correction.old_names
    ? `${q2Correction.old_names}; Parang Parang`
    : "Parang Parang";
  q2Correction.name = "Parang-Parang";

  const records = raw.map((item) => {
    const province = item.province_code ? byCode.get(item.province_code) : undefined;
    const parent = item.parent ? byCode.get(item.parent) : undefined;
    const level = item.level;
    const shownName = displayName(item.name, level);
    return {
      psgcCode: item.psgc_code,
      correspondenceCode: item.correspondence_code ?? "",
      officialName: item.name,
      displayName: shownName,
      geographicLevel: level,
      parentPsgcCode: item.parent,
      regionPsgcCode: level === "region" ? item.psgc_code : item.region_code,
      provincePsgcCode: level === "province"
        ? item.psgc_code
        : item.province_code === item.region_code || pseudoProvinceCodes.has(item.province_code)
          ? ""
          : item.province_code ?? "",
      cityMunicipalityPsgcCode: level === "city" || level === "municipality"
        ? item.psgc_code
        : level === "submunicipality"
          ? item.parent
          : item.city_code ?? "",
      cityClassification: item.city_class ?? "",
      incomeClassification: item.income_classification ?? "",
      oldName: item.old_names ?? "",
      sourceStatus: item.status ?? "",
      urbanRural: item.urban_rural === "U" || item.urban_rural === "R" ? item.urban_rural : "",
      sourceVersion: SOURCE_VERSION,
      suggestedSlug: slugify(shownName),
      parentName: parent ? displayName(parent.name, parent.level) : "",
      provinceName: province?.name ?? "",
    };
  });

  const preferred = new Map([
    ["0304903000", "cabanatuan-city"],
    ["0304908000", "gapan-city"],
    ["0304917000", "science-city-of-munoz"],
    ["0304919000", "palayan-city"],
    ["0304926000", "san-jose-city-nueva-ecija"],
    ["0304900000", "nueva-ecija"],
    ["1300000000", "metro-manila"],
    ["1380100000", "caloocan"],
    ["1380200000", "las-pinas"],
    ["1380300000", "makati"],
    ["1380400000", "malabon"],
    ["1380500000", "mandaluyong"],
    ["1380600000", "manila"],
    ["1380700000", "marikina"],
    ["1380800000", "muntinlupa"],
    ["1380900000", "navotas"],
    ["1381000000", "paranaque"],
    ["1381100000", "pasay"],
    ["1381200000", "pasig"],
    ["1381300000", "quezon-city"],
    ["1381400000", "san-juan"],
    ["1381500000", "taguig"],
    ["1381600000", "valenzuela"],
    ["1381701000", "pateros"],
  ]);

  const groups = new Map();
  for (const record of records) {
    record.suggestedSlug = preferred.get(record.psgcCode) ?? record.suggestedSlug;
    const values = groups.get(record.suggestedSlug) ?? [];
    values.push(record);
    groups.set(record.suggestedSlug, values);
  }
  for (const values of groups.values()) {
    if (values.length < 2) continue;
    for (const record of values) {
      if (preferred.has(record.psgcCode)) continue;
      const context = record.provinceName || record.parentName || record.geographicLevel;
      record.suggestedSlug = `${record.suggestedSlug}-${slugify(context)}`;
    }
  }
  const seen = new Map();
  for (const record of records) {
    const count = seen.get(record.suggestedSlug) ?? 0;
    seen.set(record.suggestedSlug, count + 1);
    if (count > 0) record.suggestedSlug = `${record.suggestedSlug}-${record.psgcCode}`;
  }

  records.sort((a, b) => a.psgcCode.localeCompare(b.psgcCode));
  const columns = [
    "psgcCode", "correspondenceCode", "officialName", "displayName", "geographicLevel",
    "parentPsgcCode", "regionPsgcCode", "provincePsgcCode", "cityMunicipalityPsgcCode",
    "cityClassification", "incomeClassification", "oldName", "sourceStatus", "urbanRural",
    "sourceVersion", "suggestedSlug",
  ];
  const csv = toCsv(records, columns);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, csv, "utf8");
  const counts = Object.fromEntries(
    [...new Set(records.map((item) => item.geographicLevel))].sort().map((level) => [
      level,
      records.filter((item) => item.geographicLevel === level).length,
    ]),
  );
  const outputDir = path.dirname(outputFile);
  const nuevaEcija = records.filter((record) => record.psgcCode === "0304900000" || record.provincePsgcCode === "0304900000");
  const ncr = records.filter((record) => record.regionPsgcCode === "1300000000");
  fs.writeFileSync(path.join(outputDir, "psgc-nueva-ecija-2026-06-30.csv"), toCsv(nuevaEcija, columns), "utf8");
  fs.writeFileSync(path.join(outputDir, "psgc-ncr-2026-06-30.csv"), toCsv(ncr, columns), "utf8");
  const higherLevels = new Set(["region", "province", "city", "municipality", "submunicipality"]);
  const summary = {
    provider: "Philippine Statistics Authority",
    dataset: "Philippine Standard Geographic Code",
    sourceVersion: SOURCE_VERSION,
    effectiveDate: "2026-06-30",
    sourceUrl: Q2_RELEASE_URL,
    generatedAt: new Date().toISOString(),
    counts: { total: records.length, ...counts },
    checksumSha256: crypto.createHash("sha256").update(csv).digest("hex"),
    luzonInventory: records
      .filter((record) => higherLevels.has(record.geographicLevel))
      .map(({ psgcCode, officialName, displayName, geographicLevel, parentPsgcCode, regionPsgcCode, provincePsgcCode, cityClassification, incomeClassification, suggestedSlug }) => ({
        psgcCode,
        officialName,
        displayName,
        geographicLevel,
        parentPsgcCode,
        regionPsgcCode,
        provincePsgcCode,
        cityClassification,
        incomeClassification,
        slug: suggestedSlug,
      })),
    priorityAreas: {
      nuevaEcija: {
        counts: Object.fromEntries([...higherLevels, "barangay"].map((level) => [level, nuevaEcija.filter((record) => record.geographicLevel === level).length])),
        localGovernmentUnits: nuevaEcija.filter((record) => record.geographicLevel === "city" || record.geographicLevel === "municipality").map((record) => ({ psgcCode: record.psgcCode, name: record.displayName, level: record.geographicLevel, slug: record.suggestedSlug })),
      },
      ncr: {
        counts: Object.fromEntries([...higherLevels, "barangay"].map((level) => [level, ncr.filter((record) => record.geographicLevel === level).length])),
        localGovernmentUnits: ncr.filter((record) => record.geographicLevel === "city" || record.geographicLevel === "municipality").map((record) => ({ psgcCode: record.psgcCode, name: record.displayName, level: record.geographicLevel, slug: record.suggestedSlug })),
      },
    },
  };
  fs.writeFileSync(path.join(outputDir, "psgc-luzon-inventory-2026-06-30.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputFile,
    sourceVersion: SOURCE_VERSION,
    sourceRelease: Q2_RELEASE_URL,
    sha256: crypto.createHash("sha256").update(csv).digest("hex"),
    total: records.length,
    counts,
  }, null, 2));
}

main();
