import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { myEarnings, myRiderRating } from "../controllers/earningsController.js";

export const earningsRouter = Router();

earningsRouter.use(requireAuth);

earningsRouter.get("/", myEarnings);
earningsRouter.get("/rider-rating", myRiderRating);
