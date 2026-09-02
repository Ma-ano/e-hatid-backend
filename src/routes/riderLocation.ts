import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  cleanupStaleLocations,
  getOrderRiderLocation,
  upsertRiderLocation,
  upsertRiderLocationByOrder,
} from "../controllers/riderLocationController.js";

export const riderLocationRouter = Router();

riderLocationRouter.use(requireAuth);

// New endpoint: POST /api/rider/location (riderId-based, GeoJSON)
riderLocationRouter.post(
  "/",
  rateLimit({ windowMs: 60_000, max: 30, message: "Too many location updates" }),
  csrfProtect,
  upsertRiderLocation,
);

// Legacy endpoint: PUT /api/rider-location/live (orderId-based, backward compat)
riderLocationRouter.put("/live", csrfProtect, upsertRiderLocationByOrder);

// Read rider location for an order
riderLocationRouter.get("/order/:orderId", getOrderRiderLocation);

// Admin: purge stale locations
riderLocationRouter.delete("/stale", requireRole("admin"), csrfProtect, cleanupStaleLocations);
