import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { RiderLocationModel } from "../models/riderLocation.js";
import { OrderModel } from "../models/order.js";
import { UserModel } from "../models/user.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

/** Rider upserts their live "currently delivering" GPS position. */
export async function upsertRiderLocation(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { orderId, lat, lng } = req.body as { orderId?: unknown; lat?: unknown; lng?: unknown };
  if (typeof orderId !== "string" || orderId === "") throw new HttpError(400, "orderId required");
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpError(400, "lat and lng must be numbers");
  }

  // Rider may only report location on an order they're delivering.
  const order = await OrderModel.findById(orderId).lean();
  const isRiderOnOrder = order && (order.riderId === user.sub || (order.status === "ready" || order.status === "delivering"));
  const authUser = await UserModel.findById(user.sub).lean();
  const isAdmin = (authUser?.roles ?? []).includes("admin");
  if (!isAdmin && !(isRiderOnOrder && order && order.riderId === user.sub)) {
    throw new HttpError(403, "You can only report location on an order you are delivering");
  }

  const location = await RiderLocationModel.findOneAndUpdate(
    { orderId },
    { orderId, riderId: user.sub, lat, lng },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.status(200).json({ data: location });
}

/** Read the live rider location for an order (customer/vendor/admin). */
export async function getOrderRiderLocation(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { orderId } = req.params;
  const order = await OrderModel.findById(orderId).lean();
  if (!order) throw new HttpError(404, "Order not found");

  const authUser = await UserModel.findById(user.sub).lean();
  const isAdmin = (authUser?.roles ?? []).includes("admin");
  const isParty = order.userId === user.sub || order.vendorId === user.sub || order.riderId === user.sub;
  if (!isAdmin && !isParty) {
    throw new HttpError(403, "You do not have access to this order");
  }

  const location = await RiderLocationModel.findOne({ orderId } as never).lean();
  res.status(200).json({ data: location ?? null });
}

/** Admin: purge stale rider locations older than N minutes. */
export async function cleanupStaleLocations(req: Request, res: Response): Promise<void> {
  const { minutes } = req.query as { minutes?: string };
  const mins = Number(minutes);
  const cutoff = new Date(Date.now() - (Number.isFinite(mins) && mins > 0 ? mins : 60) * 60 * 1000);
  const result = await RiderLocationModel.deleteMany({ updatedAt: { $lt: cutoff } });
  res.status(200).json({ data: { deleted: result.deletedCount } });
}
