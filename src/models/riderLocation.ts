import { Schema, model, type InferSchemaType } from "mongoose";

const riderLocationSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    riderId: { type: String, required: true, index: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);

export type RiderLocation = InferSchemaType<typeof riderLocationSchema>;
export const RiderLocationModel = model("RiderLocation", riderLocationSchema);
