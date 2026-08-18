import { Schema, model, type InferSchemaType } from "mongoose";

export const NOTIFICATION_TYPES = ["info", "success", "error", "warning"] as const;

const notificationSchema = new Schema(
  {
    userId: { type: String, default: null, index: true },
    vendorId: { type: String, default: null },
    riderId: { type: String, default: null },
    message: { type: String, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: "info" },
    read: { type: Boolean, default: false },
    orderId: { type: String, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export type Notification = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = model("Notification", notificationSchema);
