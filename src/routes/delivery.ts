import { Router } from "express";
import { estimateDelivery } from "../controllers/deliveryController.js";

export const deliveryRouter = Router();

deliveryRouter.get("/estimate", estimateDelivery);