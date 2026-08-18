import { Router } from "express";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import {
  createReview,
  getReviewStats,
  hasReviewedOrder,
  listReviewsByStall,
} from "../controllers/reviewController.js";

export const reviewsRouter = Router();

// Public reads
reviewsRouter.get("/stat/:stallId", getReviewStats);
reviewsRouter.get("/stall/:stallId", listReviewsByStall);

// Protected writes + auth-scoped reads
reviewsRouter.get("/order/:orderId/check", requireAuth, hasReviewedOrder);
reviewsRouter.post("/", requireAuth, csrfProtect, createReview);
