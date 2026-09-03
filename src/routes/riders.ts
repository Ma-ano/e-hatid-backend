import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";

import {
  createRider,
  deleteRider,
  getRider,
  listRiders,
  updateRider,
} from "../controllers/riderController.js";
import { getPublicRecruitmentLocation } from "./riderRecruitment.js";
import { rateLimit } from "../middlewares/rateLimit.js";

export const ridersRouter = Router();

ridersRouter.get(
  "/locations/:slug",
  rateLimit({ windowMs: 60_000, max: 60, message: "Too many rider-location requests" }),
  getPublicRecruitmentLocation,
);
ridersRouter.use(requireAuth, requireRole("admin"));
ridersRouter.get("/", listRiders);
ridersRouter.get("/:id", getRider);
ridersRouter.post("/", csrfProtect, createRider);
ridersRouter.put("/:id", csrfProtect, updateRider);
ridersRouter.delete("/:id", csrfProtect, deleteRider);
