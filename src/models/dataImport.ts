import { Schema, model, type InferSchemaType } from "mongoose";

const countSchema = new Schema(
  {
    total: { type: Number, required: true },
    regions: { type: Number, required: true },
    provinces: { type: Number, required: true },
    cities: { type: Number, required: true },
    municipalities: { type: Number, required: true },
    submunicipalities: { type: Number, required: true },
    barangays: { type: Number, required: true },
  },
  { _id: false },
);

const dataImportSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    provider: { type: String, required: true },
    dataset: { type: String, required: true },
    sourceVersion: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    effectiveDate: { type: Date, required: true },
    sourceChecksumSha256: { type: String, required: true },
    importedChecksumSha256: { type: String, required: true },
    status: { type: String, enum: ["running", "complete", "failed"], required: true },
    counts: { type: countSchema, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type DataImport = InferSchemaType<typeof dataImportSchema>;
export const DataImportModel = model("DataImport", dataImportSchema);
