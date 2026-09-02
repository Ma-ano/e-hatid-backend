import { Schema, model, type InferSchemaType } from "mongoose";

const riderLocationSchema = new Schema(
  {
    riderId: { type: String, required: true, unique: true, index: true },
    location: {
      type: { type: String, enum: ["Point"], required: true, default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);

riderLocationSchema.index({ location: "2dsphere" });

export type RiderLocation = InferSchemaType<typeof riderLocationSchema>;
export const RiderLocationModel = model("RiderLocation", riderLocationSchema);
