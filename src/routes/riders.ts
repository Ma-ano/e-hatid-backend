import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";

import {
  createRider,
  deleteRider,
  getRider,
  listRiders,
  updateRider,
} from "../controllers/riderController.js";

export const ridersRouter = Router();

ridersRouter.use(requireAuth, requireRole("admin"));
ridersRouter.get("/", listRiders);
ridersRouter.get("/:id", getRider);
ridersRouter.post("/", csrfProtect, createRider);
ridersRouter.put("/:id", csrfProtect, updateRider);
ridersRouter.delete("/:id", csrfProtect, deleteRider);
