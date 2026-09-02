import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  checkPromo,
  createPromo,
  deletePromo,
  listActivePromos,
  listPromos,
  updatePromo,
} from "../controllers/promoController.js";

// Prevent promo-code brute-forcing during checkout.
const promoCheckLimiter = rateLimit({ windowMs: 60_000, max: 30, message: "Too many promo attempts, please slow down." });

export const promosRouter = Router();

// Public: currently redeemable promo codes (for the offers page).
promosRouter.get("/active", listActivePromos);
// Any authenticated user checks a code before checkout.
promosRouter.post("/check", requireAuth, csrfProtect, promoCheckLimiter, checkPromo);

// Admin management.
promosRouter.get("/", requireAuth, requireRole("admin"), listPromos);
promosRouter.post("/", requireAuth, requireRole("admin"), csrfProtect, createPromo);
promosRouter.put("/:id", requireAuth, requireRole("admin"), csrfProtect, updatePromo);
promosRouter.delete("/:id", requireAuth, requireRole("admin"), csrfProtect, deletePromo);