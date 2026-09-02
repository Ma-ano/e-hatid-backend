import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { RiderLocationModel } from "../models/riderLocation.js";
import { OrderModel } from "../models/order.js";
import { UserModel } from "../models/user.js";
import { getIO } from "../socket.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

/** Rider upserts their live GPS position (POST /api/rider/location). */
export async function upsertRiderLocation(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { riderId, lat, lng } = req.body as { riderId?: unknown; lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpError(400, "lat and lng must be finite numbers");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpError(400, "lat must be -90..90 and lng must be -180..180");
  }

  // Prefer authenticated identity; only allow rider to report own location.
  const authUser = await UserModel.findById(user.sub).lean();
  const isAdmin = (authUser?.roles ?? []).includes("admin");
  const isRider = (authUser?.roles ?? []).includes("rider");
  const effectiveRiderId = typeof riderId === "string" && riderId !== "" ? riderId : user.sub;

  if (!isAdmin && (!isRider || effectiveRiderId !== user.sub)) {
    throw new HttpError(403, "Riders can only report their own location");
  }

  const location = await RiderLocationModel.findOneAndUpdate(
    { riderId: effectiveRiderId },
    {
      riderId: effectiveRiderId,
      location: { type: "Point", coordinates: [lng, lat] },
      lat,
      lng,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  try {
    getIO().to(`rider_${effectiveRiderId}`).emit("rider:location", {
      riderId: effectiveRiderId,
      lat,
      lng,
      updatedAt: location.updatedAt,
    });
  } catch {
    // socket not critical; ignore emit failures
  }

  res.status(200).json({ data: location });
}

/** Legacy endpoint: Rider upserts location by orderId (PUT /api/rider-location/live). */
export async function upsertRiderLocationByOrder(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { orderId, lat, lng } = req.body as { orderId?: unknown; lat?: unknown; lng?: unknown };
  if (typeof orderId !== "string" || orderId === "") throw new HttpError(400, "orderId required");
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpError(400, "lat and lng must be finite numbers");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpError(400, "lat must be -90..90 and lng must be -180..180");
  }

  const order = await OrderModel.findById(orderId).lean();
  const authUser = await UserModel.findById(user.sub).lean();
  const isAdmin = (authUser?.roles ?? []).includes("admin");
  const isRiderOnOrder = order && order.riderId === user.sub;
  if (!isAdmin && !isRiderOnOrder) {
    throw new HttpError(403, "You can only report location on an order you are delivering");
  }

  const effectiveRiderId = order?.riderId ?? user.sub;

  const location = await RiderLocationModel.findOneAndUpdate(
    { riderId: effectiveRiderId },
    {
      riderId: effectiveRiderId,
      location: { type: "Point", coordinates: [lng, lat] },
      lat,
      lng,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  try {
    getIO().to(`rider_${effectiveRiderId}`).emit("rider:location", {
      riderId: effectiveRiderId,
      lat,
      lng,
      updatedAt: location.updatedAt,
    });
  } catch {
    // socket not critical; ignore emit failures
  }

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

  const riderId = order.riderId;
  if (!riderId) {
    res.status(200).json({ data: null });
    return;
  }

  const location = await RiderLocationModel.findOne({ riderId } as never).lean();
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
