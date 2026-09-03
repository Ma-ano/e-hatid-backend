import { Schema, model, type InferSchemaType } from "mongoose";

export const GEOGRAPHIC_LEVELS = [
  "region",
  "province",
  "city",
  "municipality",
  "submunicipality",
  "barangay",
] as const;

const sourceSchema = new Schema(
  {
    provider: { type: String, required: true, default: "Philippine Statistics Authority" },
    dataset: { type: String, required: true, default: "Philippine Standard Geographic Code" },
    version: { type: String, required: true },
    effectiveDate: { type: Date, required: true },
    sourceUrl: { type: String, required: true },
    importedAt: { type: Date, required: true },
  },
  { _id: false },
);

const geographicLocationSchema = new Schema(
  {
    psgcCode: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    correspondenceCode: { type: String, default: "" },
    officialName: { type: String, required: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    previousSlugs: { type: [String], default: [] },
    geographicLevel: { type: String, enum: GEOGRAPHIC_LEVELS, required: true },
    parentPsgcCode: { type: String, default: "" },
    regionPsgcCode: { type: String, required: true },
    provincePsgcCode: { type: String, default: "" },
    cityMunicipalityPsgcCode: { type: String, default: "" },
    cityClassification: { type: String, default: "" },
    incomeClassification: { type: String, default: "" },
    oldName: { type: String, default: "" },
    sourceStatus: { type: String, default: "" },
    urbanRural: { type: String, enum: ["", "U", "R"], default: "" },
    islandGroup: { type: String, enum: ["Luzon"], required: true, default: "Luzon" },
    isActive: { type: Boolean, required: true, default: true },
    source: { type: sourceSchema, required: true },
  },
  { timestamps: true, versionKey: false },
);

geographicLocationSchema.index({ parentPsgcCode: 1, geographicLevel: 1, officialName: 1 });
geographicLocationSchema.index({ regionPsgcCode: 1, provincePsgcCode: 1, geographicLevel: 1 });
geographicLocationSchema.index({ cityMunicipalityPsgcCode: 1, geographicLevel: 1 });
geographicLocationSchema.index({ displayName: "text", officialName: "text" });

export type GeographicLocation = InferSchemaType<typeof geographicLocationSchema>;
export const GeographicLocationModel = model("GeographicLocation", geographicLocationSchema);
