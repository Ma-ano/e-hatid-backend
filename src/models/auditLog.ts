import { Schema, model, type InferSchemaType } from "mongoose";

const auditLogSchema = new Schema(
  {
    // Who performed the action. Empty for system-driven events.
    actorId: { type: String, default: null, index: true },
    actorEmail: { type: String, default: "" },

    // What happened and where (e.g. "order.status.updated", "promo.deleted").
    category: { type: String, required: true, index: true },
    action: { type: String, required: true },

    // The record that was mutated.
    targetType: { type: String, default: "" },
    targetId: { type: String, default: "", index: true },

    // Free-form structured detail (diff, reason, previous/next state).
    meta: { type: Schema.Types.Mixed, default: {} },

    ip: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;

export const AuditLogModel = model("AuditLog", auditLogSchema);