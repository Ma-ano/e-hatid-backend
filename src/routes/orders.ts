import { Router } from "express";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import {
  createOrder,
  getOrder,
  listAvailableOrders,
  listOrders,
  updateOrderStatus,
} from "../controllers/orderController.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.post("/", csrfProtect, createOrder);
ordersRouter.get("/", listOrders);
ordersRouter.get("/available", listAvailableOrders);
ordersRouter.get("/:id", getOrder);
ordersRouter.put("/:id/status", csrfProtect, updateOrderStatus);
