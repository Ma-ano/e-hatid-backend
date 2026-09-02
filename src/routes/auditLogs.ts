import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { listAuditLogs } from "../controllers/auditLogController.js";

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);
auditLogsRouter.get("/", requireRole("admin"), listAuditLogs);