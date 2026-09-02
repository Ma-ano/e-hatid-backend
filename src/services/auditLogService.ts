import type { Request } from "express";
import { AuditLogModel } from "../models/auditLog.js";

export interface AuditEntry {
  category: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Append a record to the audit log. Never throws: auditing must not break the
 * primary request. Falls back to a console warning on failure.
 */
export async function logAudit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    const actorId =
      (req as Request & { user?: { sub?: string } }).user?.sub ?? "";
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";
    await AuditLogModel.create({
      actorId: actorId || null,
      category: entry.category,
      action: entry.action,
      targetType: entry.targetType ?? "",
      targetId: entry.targetId ?? "",
      meta: entry.meta ?? {},
      ip,
    });
  } catch (err) {
    console.warn("[audit] failed to write audit log:", err);
  }
}