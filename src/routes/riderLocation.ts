import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  cleanupStaleLocations,
  getOrderRiderLocation,
  upsertRiderLocation,
} from "../controllers/riderLocationController.js";

export const riderLocationRouter = Router();

riderLocationRouter.use(requireAuth);

riderLocationRouter.put("/live", csrfProtect, upsertRiderLocation);
riderLocationRouter.get("/order/:orderId", getOrderRiderLocation);
riderLocationRouter.delete("/stale", requireRole("admin"), csrfProtect, cleanupStaleLocations);
