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

applicationSchema.index(
  { userId: 1, role: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);
applicationSchema.index({ status: 1, createdAt: -1 });

export type Application = InferSchemaType<typeof applicationSchema>;
export const ApplicationModel = model("Application", applicationSchema);
