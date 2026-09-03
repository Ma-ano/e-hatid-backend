import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { NotificationModel } from "../models/notification.js";
import { UserModel } from "../models/user.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

/** List notifications for the current user (by id, vendorId, or riderId match). */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const authUser = await UserModel.findById(user.sub).lean();
  const roles = (authUser?.roles ?? []) as string[];

  const or: Record<string, unknown>[] = [{ userId: user.sub }];
  if (roles.includes("vendor")) or.push({ vendorId: user.sub });
  if (roles.includes("rider")) or.push({ riderId: user.sub });

  const notifications = await NotificationModel.find({ $or: or }).sort({ createdAt: -1 }).limit(200).lean();
  const unread = notifications.filter((n) => !n.read).length;
  res.status(200).json({ data: notifications, unreadCount: unread });
}

/** Mark a single notification as read. */
export async function markRead(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const { id } = req.params;

  const notification = await NotificationModel.findById(id).lean();
  if (!notification) throw new HttpError(404, "Notification not found");

  const isOwner =
    notification.userId === user.sub ||
    notification.vendorId === user.sub ||
    notification.riderId === user.sub;
  if (!isOwner) throw new HttpError(403, "Not your notification");

  const updated = await NotificationModel.findByIdAndUpdate(id, { read: true }, { new: true }).lean();
  res.status(200).json({ data: updated });
}

/** Mark all of the current user's notifications as read. */
export async function markAllRead(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const result = await NotificationModel.updateMany(
    {
      $or: [{ userId: user.sub }, { vendorId: user.sub }, { riderId: user.sub }],
      read: false,
    },
    { read: true },
  );
  res.status(200).json({ data: { updated: result.modifiedCount } });
}
