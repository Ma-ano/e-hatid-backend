import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  createStall,
  deleteStall,
  getStall,
  listMyStalls,
  listStalls,
  updateStall,
  updateStallMenu,
} from "../controllers/stallController.js";

export const stallsRouter = Router();

// Public browsing
stallsRouter.get("/", listStalls);
// Vendor-specific (must precede /:id so "mine" isn't captured as an id).
stallsRouter.get("/mine", requireAuth, requireRole("vendor"), listMyStalls);
stallsRouter.get("/:id", getStall);

// Vendor manages own stalls (role approved) — strict route order.
stallsRouter.post("/", requireAuth, requireRole("vendor"), csrfProtect, createStall);
stallsRouter.put("/:id/menu", requireAuth, requireRole("vendor"), csrfProtect, updateStallMenu);
stallsRouter.put("/:id", requireAuth, requireRole("vendor"), csrfProtect, updateStall);
stallsRouter.delete("/:id", requireAuth, requireRole("admin"), csrfProtect, deleteStall);
