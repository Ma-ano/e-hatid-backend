import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  listApplications,
  listMyApplications,
  reviewApplication,
  submitApplication,
} from "../controllers/applicationController.js";

export const applicationsRouter = Router();

applicationsRouter.use(requireAuth);

applicationsRouter.get("/mine", listMyApplications);
applicationsRouter.post("/", csrfProtect, submitApplication);

applicationsRouter.get("/", requireRole("admin"), listApplications);
applicationsRouter.put("/:id/review", requireRole("admin"), csrfProtect, reviewApplication);
