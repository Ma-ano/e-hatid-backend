import { Router } from "express";

import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { usersRouter } from "./users.js";
import { stallsRouter } from "./stalls.js";
import { ordersRouter } from "./orders.js";
import { configRouter } from "./config.js";
import { ridersRouter } from "./riders.js";
import { otpRouter } from "./otp.js";
import { reviewsRouter } from "./reviews.js";
import { riderReviewsRouter } from "./riderReviews.js";
import { applicationsRouter } from "./applications.js";
import { riderLocationRouter } from "./riderLocation.js";
import { notificationsRouter } from "./notifications.js";
import { earningsRouter } from "./earnings.js";
import { promosRouter } from "./promos.js";
import { loadUser } from "../middlewares/auth.js";

export const apiRouter = Router();

// Load (optional) auth cookie for all /api routes; guest-friendly reads still work.
apiRouter.use(loadUser);

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/stalls", stallsRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/config", configRouter);
apiRouter.use("/riders", ridersRouter);
apiRouter.use("/otp", otpRouter);
apiRouter.use("/reviews", reviewsRouter);
apiRouter.use("/rider-reviews", riderReviewsRouter);
apiRouter.use("/applications", applicationsRouter);
apiRouter.use("/rider-location", riderLocationRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/earnings", earningsRouter);
apiRouter.use("/promos", promosRouter);
