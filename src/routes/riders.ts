import { Router } from "express";

import {
  createRider,
  deleteRider,
  getRider,
  listRiders,
  updateRider,
} from "../controllers/riderController.js";

export const ridersRouter = Router();

ridersRouter.get("/", listRiders);
ridersRouter.get("/:id", getRider);
ridersRouter.post("/", createRider);
ridersRouter.put("/:id", updateRider);
ridersRouter.delete("/:id", deleteRider);