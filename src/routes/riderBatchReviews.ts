import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  adminDeleteBatchReview,
  adminListBatchReviews,
  createMyBatchReview,
  deleteMyBatchReview,
  myBatchReviews,
} from "../controllers/riderBatchReviewController.js";

export const batchReviewsRouter = Router();

batchReviewsRouter.post("/", requireAuth, requireRole("rider"), csrfProtect, createMyBatchReview);
batchReviewsRouter.get("/", requireAuth, requireRole("rider"), myBatchReviews);
batchReviewsRouter.delete("/:id", requireAuth, requireRole("rider"), csrfProtect, deleteMyBatchReview);
batchReviewsRouter.get("/admin", requireAuth, requireRole("admin"), adminListBatchReviews);
batchReviewsRouter.delete("/admin/:id", requireAuth, requireRole("admin"), csrfProtect, adminDeleteBatchReview);