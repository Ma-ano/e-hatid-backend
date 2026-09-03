import { Schema, model, type InferSchemaType } from "mongoose";

const otpRequestSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    isUsed: { type: Boolean, default: false },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

otpRequestSchema.index({ email: 1, createdAt: -1 });
otpRequestSchema.index({ ipAddress: 1, createdAt: -1 });
otpRequestSchema.index({ userId: 1, isUsed: 1, createdAt: -1 });
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export type OtpRequest = InferSchemaType<typeof otpRequestSchema>;
export const OtpRequestModel = model("OtpRequest", otpRequestSchema);
