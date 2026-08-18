import { Schema, model, type InferSchemaType } from "mongoose";

const configSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    perKmRate: { type: Number, default: 30 },
    gasPrice: { type: Number, default: 60 },
    kmPerLiter: { type: Number, default: 40 },
    bonus: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

export type Config = InferSchemaType<typeof configSchema>;
export const ConfigModel = model("Config", configSchema);
