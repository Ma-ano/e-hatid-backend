import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  getDeliveryConfig,
  updateDeliveryConfig,
} from "../controllers/configController.js";

export const configRouter = Router();

configRouter.get("/delivery", getDeliveryConfig);
configRouter.put("/delivery", requireAuth, requireRole("admin"), csrfProtect, updateDeliveryConfig);
