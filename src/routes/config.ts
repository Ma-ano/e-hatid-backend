import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  getDeliveryConfig,
  updateDeliveryConfig,
} from "../controllers/configController.js";

export const configRouter = Router();

// Public read (matches old Firestore "public-read, admin-write")
configRouter.get("/delivery", getDeliveryConfig);
configRouter.put("/delivery", requireAuth, requireRole("admin"), csrfProtect, updateDeliveryConfig);
