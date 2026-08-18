import { Schema, model, type InferSchemaType } from "mongoose";

const applicationSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ["vendor", "rider"], required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    data: { type: Schema.Types.Mixed, default: {} },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type Application = InferSchemaType<typeof applicationSchema>;
export const ApplicationModel = model("Application", applicationSchema);
