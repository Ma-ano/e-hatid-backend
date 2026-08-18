import { Router } from "express";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import {
  listNotifications,
  markAllRead,
  markRead,
} from "../controllers/notificationController.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", listNotifications);
notificationsRouter.put("/read-all", csrfProtect, markAllRead);
notificationsRouter.put("/:id/read", csrfProtect, markRead);
