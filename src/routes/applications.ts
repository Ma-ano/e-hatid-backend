import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  listApplications,
  listMyApplications,
  reviewApplication,
  submitApplication,
} from "../controllers/applicationController.js";

const applicationLimiter = rateLimit({ windowMs: 60_000, max: 10, message: "Too many applications, please try again later." });

export const applicationsRouter = Router();

applicationsRouter.use(requireAuth);

applicationsRouter.get("/mine", listMyApplications);
applicationsRouter.post("/", csrfProtect, applicationLimiter, submitApplication);

applicationsRouter.get("/", requireRole("admin"), listApplications);
applicationsRouter.put("/:id/review", requireRole("admin"), csrfProtect, reviewApplication);
