import { Router } from "express";
import { estimateDelivery } from "../controllers/deliveryController.js";
import { rateLimit } from "../middlewares/rateLimit.js";

export const deliveryRouter = Router();

deliveryRouter.get(
  "/estimate",
  rateLimit({ windowMs: 60_000, max: 60, message: "Too many delivery estimates, please slow down." }),
  estimateDelivery,
);
