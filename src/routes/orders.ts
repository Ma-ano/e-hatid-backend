import { Router } from "express";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import {
  createOrder,
  getOrder,
  listAvailableOrders,
  listOrders,
  updateOrderStatus,
} from "../controllers/orderController.js";

// A single customer wouldn't legitimately place more than ~20 orders per minute.
const orderCreateLimiter = rateLimit({ windowMs: 60_000, max: 20, message: "Too many order requests, please try again shortly." });
const orderUpdateLimiter = rateLimit({ windowMs: 60_000, max: 60, message: "Too many order updates, please try again shortly." });

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.post("/", csrfProtect, orderCreateLimiter, createOrder);
ordersRouter.get("/", listOrders);
ordersRouter.get("/available", listAvailableOrders);
ordersRouter.get("/:id", getOrder);
ordersRouter.put("/:id/status", csrfProtect, orderUpdateLimiter, updateOrderStatus);
