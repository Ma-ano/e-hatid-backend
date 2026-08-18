import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  checkPromo,
  createPromo,
  deletePromo,
  listActivePromos,
  listPromos,
  updatePromo,
} from "../controllers/promoController.js";

export const promosRouter = Router();

// Public: currently redeemable promo codes (for the offers page).
promosRouter.get("/active", listActivePromos);
// Any authenticated user checks a code before checkout.
promosRouter.post("/check", requireAuth, csrfProtect, checkPromo);

// Admin management.
promosRouter.get("/", requireAuth, requireRole("admin"), listPromos);
promosRouter.post("/", requireAuth, requireRole("admin"), csrfProtect, createPromo);
promosRouter.put("/:id", requireAuth, requireRole("admin"), csrfProtect, updatePromo);
promosRouter.delete("/:id", requireAuth, requireRole("admin"), csrfProtect, deletePromo);