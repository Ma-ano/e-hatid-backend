import { Schema, model, type InferSchemaType } from "mongoose";

const riderSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export type Rider = InferSchemaType<typeof riderSchema>;

export const RiderModel = model("Rider", riderSchema);