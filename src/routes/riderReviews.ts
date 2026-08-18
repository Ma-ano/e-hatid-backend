import { Router } from "express";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import {
  createRiderReview,
  getRiderReviewStats,
  listRiderReviews,
} from "../controllers/reviewController.js";

export const riderReviewsRouter = Router();

riderReviewsRouter.get("/rider/:riderId", listRiderReviews);
riderReviewsRouter.get("/stat/:riderId", getRiderReviewStats);
riderReviewsRouter.post("/", requireAuth, csrfProtect, createRiderReview);
