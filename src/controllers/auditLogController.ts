import type { Request, Response } from "express";
import { AuditLogModel } from "../models/auditLog.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  const { category } = req.query as { category?: string };
  const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter: Record<string, unknown> = {};
  if (category && category.trim() !== "") filter.category = category.trim();

  const logs = await AuditLogModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const categories = await AuditLogModel.distinct("category");

  res.status(200).json({ data: logs, categories });
}