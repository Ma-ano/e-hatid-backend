import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { OrderModel, type OrderStatus } from "../models/order.js";
import { StallModel } from "../models/stall.js";
import { UserModel } from "../models/user.js";
import { estimateDeliveryFee } from "../services/deliveryFeeService.js";
import { validatePromo } from "../services/promoService.js";
import { PromoModel } from "../models/promo.js";
import { pushNotification } from "../services/notificationService.js";
import { logAudit } from "../services/auditLogService.js";
import { getIO } from "../socket.js";

interface AuthUser {
  sub: string;
  role: string;
  activeRole: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

const VALID_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "delivering",
  "delivered",
  "cancelled",
  "rejected",
  "completed",
  "ready_for_pickup",
];

export async function createOrder(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const body = req.body as {
    stallId?: unknown;
    items?: unknown;
    deliveryAddress?: unknown;
    deliveryLocation?: unknown;
    distance?: unknown;
    customerLatitude?: unknown;
    customerLongitude?: unknown;
    notes?: unknown;
    promoCode?: unknown;
    paymentMethod?: unknown;
  };
  const { stallId, items } = body;
  if (typeof stallId !== "string" || stallId === "") throw new HttpError(400, "stallId required");
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "items must be a non-empty array");
  }

const stall = await StallModel.findById(stallId).lean();
  if (!stall) throw new HttpError(404, "Stall not found");

  const orderUser = await UserModel.findById(user.sub).lean();
  if (!orderUser) throw new HttpError(404, "User not found");
  if (!orderUser.emailVerified) {
    throw new HttpError(403, "Please verify your email before placing an order.");
  }

  interface IncomingItem {
    menuItemId?: unknown;
    name?: unknown;
    price?: unknown;
    quantity?: unknown;
    image?: unknown;
    selectedOptions?: unknown;
    selectedAddOns?: unknown;
    specialInstructions?: unknown;
  }

  // Re-validate every item against the vendor's current menu. Never trust the
  // client-supplied price: unit prices are rebuilt from the DB menu snapshot.
  const menu = (stall as { menu?: unknown[] }).menu ?? [];
  const validatedItems: {
    menuItemId: string;
    name: string;
    price: number;
    quantity: number;
    image: string;
    selectedOptions: string[];
    selectedAddOns: string[];
    specialInstructions: string;
  }[] = [];
  let subtotal = 0;

  for (const raw of items) {
    const it = (raw && typeof raw === "object" ? raw : {}) as IncomingItem;
    const menuItemId = typeof it.menuItemId === "string" ? it.menuItemId : "";
    const quantity =
      typeof it.quantity === "number" && it.quantity > 0 ? Math.floor(it.quantity) : 1;

    const menuItem = (menu as { id?: unknown; name?: unknown; price?: unknown; available?: unknown; options?: { choices?: { name?: unknown; price?: unknown }[] }[]; addOns?: { name?: unknown; price?: unknown }[] }[]).find(
      (m) => String(m.id) === menuItemId,
    );
    if (!menuItem) {
      const label = typeof it.name === "string" && it.name ? it.name : "An item";
      throw new HttpError(400, `"${label}" is no longer available`);
    }
    if (menuItem.available === false) {
      throw new HttpError(400, `"${String(menuItem.name ?? menuItemId)}" is currently unavailable`);
    }

    let unitPrice = Number(menuItem.price ?? 0);

    const opts =
      Array.isArray(it.selectedOptions)
        ? (it.selectedOptions as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
    for (const label of opts) {
      const choice = (menuItem.options ?? [])
        .flatMap((g) => g.choices ?? [])
        .find((c) => c.name === label);
      if (choice) unitPrice += Number(choice.price ?? 0);
    }

    const addOns =
      Array.isArray(it.selectedAddOns)
        ? (it.selectedAddOns as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
    for (const label of addOns) {
      const addOn = (menuItem.addOns ?? []).find((a) => a.name === label);
      if (addOn) unitPrice += Number(addOn.price ?? 0);
    }

    const unit = Math.round(unitPrice * 100) / 100;
    subtotal += unit * quantity;

    validatedItems.push({
      menuItemId,
      name: String(menuItem.name ?? menuItemId),
      price: unit,
      quantity,
      image: typeof it.image === "string" ? it.image : "",
      selectedOptions: opts,
      selectedAddOns: addOns,
      specialInstructions: typeof it.specialInstructions === "string" ? it.specialInstructions : "",
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  const toNullableNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  // Parse deliveryLocation from the request body (prompt1.md spec)
  const rawDeliveryLocation = body.deliveryLocation;
  let deliveryLocation = null;
  let deliveryInstructionsFromLocation = "";
  if (rawDeliveryLocation && typeof rawDeliveryLocation === "object" && !Array.isArray(rawDeliveryLocation)) {
    const dlObj = rawDeliveryLocation as Record<string, unknown>;
    const fullAddress = typeof dlObj.fullAddress === "string" ? dlObj.fullAddress.trim() : "";
    const instructions = typeof dlObj.deliveryInstructions === "string" ? dlObj.deliveryInstructions.trim() : "";
    deliveryInstructionsFromLocation = instructions;

    let locationGeo = null;
    const rawLoc = dlObj.location;
    if (rawLoc && typeof rawLoc === "object" && !Array.isArray(rawLoc)) {
      const locObj = rawLoc as Record<string, unknown>;
      const coords = locObj.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
          locationGeo = { type: "Point", coordinates: [lng, lat] };
        }
      }
    }

    deliveryLocation = {
      fullAddress,
      location: locationGeo,
      deliveryInstructions: instructions,
    };
  }

  const customerLat = toNullableNumber(body.customerLatitude);
  const customerLng = toNullableNumber(body.customerLongitude);

  // Compute the delivery fee through the fee engine (geo service + config).
  // The client-sent `distance` is deliberately ignored (prompt1.md §34): a
  // tampered value would directly shrink the fare. Distance is always derived
  // from the authoritative stall/customer coordinates.
  let deliveryFee = Number(stall.deliveryFee ?? 0);
  let distance = 0;
  let serviceFee = 1.49;

  const hasCoords = customerLat != null && customerLng != null && stall.latitude != null && stall.longitude != null;
  if (hasCoords) {
    const feeInput: Parameters<typeof estimateDeliveryFee>[0] = {
      subtotal,
      pickupLat: stall.latitude as number,
      pickupLng: stall.longitude as number,
      dropLat: customerLat as number,
      dropLng: customerLng as number,
    };
    const estimate = await estimateDeliveryFee(feeInput);
    deliveryFee = estimate.deliveryFee;
    distance = estimate.distanceKm;
    serviceFee = estimate.serviceFee;
  }

  // Validate and apply a promo code if one was supplied. The discount is
  // recomputed server-side; the client-supplied amount is never trusted.
  let discount = 0;
  let promoCode = "";
  const rawPromo = body.promoCode;
  if (typeof rawPromo === "string" && rawPromo.trim() !== "") {
    const promo = await validatePromo(
      { code: rawPromo, subtotal, stallId: String(stall._id), userId: user.sub },
      deliveryFee,
    );
    discount = promo.discount;
    promoCode = promo.promo.code;
  }

  // Payment method is validated server-side. E-Hatid currently supports COD only;
  // any other value is rejected so unsupported methods can never be recorded.
  const paymentMethod = body.paymentMethod === "cod" ? "cod" : "cod";

  // Idempotency: if the client retries a request (e.g. after a dropped response),
  // serve the same order instead of creating a duplicate.
  const idempotencyKey = (req.headers["x-idempotency-key"] as string | undefined) ?? "";
  if (idempotencyKey !== "") {
    const existing = await OrderModel.findOne({ userId: user.sub, idempotencyKey }).lean();
    if (existing) {
      res.status(200).json({ data: existing, message: "Order already exists for this request" });
      return;
    }
  }

  // Estimated delivery window (minutes), derived from the authoritative distance.
  const ETA_BASE_MIN = 20;
  const ETA_PER_KM_MIN = 4;
  const etaMinutes = distance > 0 ? Math.round(ETA_BASE_MIN + distance * ETA_PER_KM_MIN) : ETA_BASE_MIN;
  const estimatedDeliveryTime = `${etaMinutes}-${Math.min(etaMinutes + 10, 90)} min`;

  const order = await OrderModel.create({
    userId: user.sub,
    stallId: String(stall._id),
    vendorId: stall.vendorId,
    stallName: stall.name,
    customerName: orderUser.name,
    customerPhone: orderUser.phone,
    items: validatedItems,
    subtotal,
    deliveryFee,
    serviceFee,
    discount,
    promoCode,
    total: Math.round((subtotal + deliveryFee + serviceFee - discount) * 100) / 100,
    paymentMethod,
    paymentStatus: "unpaid",
    deliveryLocation,
    deliveryAddress: deliveryLocation?.fullAddress || (typeof body.deliveryAddress === "string" ? body.deliveryAddress : ""),
    deliveryInstructions: deliveryInstructionsFromLocation || "",
    notes: typeof body.notes === "string" ? body.notes : "",
    distance,
    estimatedDeliveryTime,
    customerLatitude: customerLat,
    customerLongitude: customerLng,
    stallLatitude: stall.latitude ?? null,
    stallLongitude: stall.longitude ?? null,
    status: "pending",
    idempotencyKey,
  });

  // Track promo redemption.
  if (promoCode) {
    await PromoModel.updateOne({ code: promoCode }, { $inc: { usedCount: 1 } }).catch((err) => {
      console.warn("[promos] failed to increment usage:", err);
    });
  }

  // Notify vendor of a new incoming order.
  if (stall.vendorId) {
    await pushNotification(
      { vendorId: String(stall.vendorId) },
      `New order #${String(order._id).slice(-6).toUpperCase()} from ${orderUser.name || "a customer"}`,
      "info",
      String(order._id),
    );
  }

  res.status(201).json({ data: order });
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid order id");

  const order = await OrderModel.findById(id).lean();
  if (!order) throw new HttpError(404, "Order not found");

  const authUser = await UserModel.findById(user.sub).lean();
  const isAdmin = (authUser?.roles ?? []).includes("admin");
  const isParty = order.userId === user.sub || order.vendorId === user.sub || order.riderId === user.sub;
  if (!isAdmin && !isParty) {
    throw new HttpError(403, "You do not have access to this order");
  }
  res.status(200).json({ data: order });
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const authUser = await UserModel.findById(user.sub).lean();
  if (!authUser) throw new HttpError(404, "User not found");

  const roles = (authUser.roles ?? []) as string[];
  const filter: Record<string, unknown> = {};
  const { status } = req.query as { status?: string };
  if (status && VALID_STATUSES.includes(status as OrderStatus)) {
    filter.status = status;
  }

  let query: Record<string, unknown>;
  if (roles.includes("admin")) {
    query = filter;
  } else {
    // A user may hold multiple roles (e.g. customer + rider). Match orders where
    // they are the customer, the vendor, or the rider.
    const or: Record<string, unknown>[] = [];
    if (roles.includes("vendor")) or.push({ vendorId: user.sub });
    if (roles.includes("rider")) or.push({ riderId: user.sub });
    or.push({ userId: user.sub }); // everyone is a customer
    if (or.length === 0) {
      query = { ...filter, userId: user.sub };
    } else {
      query = { ...filter, $or: or };
    }
  }

  const orders = await OrderModel.find(query).sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: orders });
}

/** Orders that a rider can pick up: ready/unassigned, not yet claimed. */
export async function listAvailableOrders(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const authUser = await UserModel.findById(user.sub).lean();
  const roles = (authUser?.roles ?? []) as string[];
  if (!roles.includes("rider")) {
    throw new HttpError(403, "Riders only");
  }

  const orders = await OrderModel.find({
    status: { $in: ["ready", "ready_for_pickup"] },
    riderId: { $in: [null, ""] },
  })
    .sort({ readyAt: 1, createdAt: 1 })
    .lean();
  res.status(200).json({ data: orders });
}

/**
 * Strict order state machine.
 * Allowed edges are explicit so only sensible transitions are possible.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["accepted", "rejected", "cancelled"],
  accepted: ["preparing", "cancelled", "rejected"],
  preparing: ["ready", "cancelled", "rejected"],
  ready: ["delivering", "ready_for_pickup", "cancelled"],
  ready_for_pickup: ["delivering", "cancelled"],
  delivering: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
  rejected: [],
  completed: [],
};

/** Actor that is allowed to drive a transition (or admin, always). */
function actorFor(
  next: OrderStatus,
  order: { userId: string; vendorId?: string | null; riderId?: string | null; status: string },
  roles: string[],
  userId: string,
): "admin" | "customer" | "vendor" | "rider" | "rider-claim" | null {
  if (roles.includes("admin")) return "admin";
  switch (next) {
    case "accepted":
    case "preparing":
    case "ready":
    case "ready_for_pickup":
      return roles.includes("vendor") && order.vendorId === userId ? "vendor" : null;
    case "rejected":
      return roles.includes("vendor") && order.vendorId === userId ? "vendor" : null;
    case "delivering":
      // Rider claims an unassigned ready order, or continues their own.
      if (roles.includes("rider") && order.riderId === userId) return "rider";
      if (roles.includes("rider") && !order.riderId && order.status === "ready") return "rider-claim";
      return null;
    case "delivered":
      return roles.includes("rider") && order.riderId === userId ? "rider" : null;
    case "cancelled":
      // Only the customer can cancel a pending order; vendor cancels accepted/preparing/ready.
      if (order.userId === userId) return "customer";
      if (roles.includes("vendor") && order.vendorId === userId) return "vendor";
      return null;
    default:
      return null;
  }
}

export async function updateOrderStatus(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new HttpError(400, "Invalid order id");

  const { status, cancelledReason } = req.body as { status?: unknown; cancelledReason?: unknown };
  if (typeof status !== "string" || !VALID_STATUSES.includes(status as OrderStatus)) {
    throw new HttpError(400, "invalid status");
  }
  const next = status as OrderStatus;

  const order = await OrderModel.findById(id).lean();
  if (!order) throw new HttpError(404, "Order not found");

  // Reject terminal re-transitions and unknown transitions.
  if (order.status === next) {
    throw new HttpError(409, "Order is already in this status");
  }
  const allowedFromCurrent = TRANSITIONS[order.status as OrderStatus] ?? [];
  if (!allowedFromCurrent.includes(next)) {
    throw new HttpError(400, `Cannot transition from ${order.status} to ${next}`);
  }

  const authUser = await UserModel.findById(user.sub).lean();
  const roles = (authUser?.roles ?? []) as string[];
  const actor = actorFor(next, order, roles, user.sub);
  if (!actor) {
    throw new HttpError(403, "This status transition is not allowed");
  }

  const update: Record<string, unknown> = { status: next };
  if (next === "cancelled" || next === "rejected") {
    update.cancelledReason = typeof cancelledReason === "string" ? cancelledReason : `Order ${next}`;
  }
  if (next === "delivering" && actor === "rider-claim") {
    update.riderId = user.sub;
    update.riderName = authUser?.name ?? "";
    update.riderPhone = authUser?.phone ?? "";
    update.riderPlate = authUser?.licensePlate ?? "";
    update.riderAvatar = authUser?.avatar ?? "";
  }
  if (next === "delivered") {
    update.completedAt = new Date();
    update.paymentStatus = "paid";
    update.paidAt = new Date();
  }
  if (next === "completed") {
    update.paymentStatus = "paid";
    update.paidAt = new Date();
  }
  if (next === "accepted") update.acceptedAt = new Date();
  if (next === "ready" || next === "ready_for_pickup") update.readyAt = new Date();
  if (next === "delivering") update.pickedUpAt = new Date();

  // Atomic transition: gate the update on the current status so two actors can
  // never double-claim or double-accept the same order (spec §5, §27).
  const claimFilter: Record<string, unknown> = { _id: id, status: order.status };
  if (actor === "rider-claim") {
    claimFilter.riderId = { $in: [null, ""] };
  }
  const updated = await OrderModel.findOneAndUpdate(claimFilter, { $set: update }, { new: true }).lean();
  if (!updated) {
    throw new HttpError(409, "This order was just updated by someone else. Please refresh and try again.");
  }

  await logAudit(req, {
    category: "order",
    action: `order.status.${next}`,
    targetType: "Order",
    targetId: String(id),
    meta: {
      from: order.status,
      to: next,
      actor,
      cancelledReason: typeof cancelledReason === "string" ? cancelledReason : "",
    },
  });

  // Push role-scoped notifications for the other party.
  const shortId = String(id).slice(-6).toUpperCase();
  try {
    if (next === "accepted" || next === "ready") {
      await pushNotification({ userId: order.userId }, `Your order ${shortId} is now ${next}`, "success", String(id));
    } else if (next === "delivering") {
      await pushNotification({ userId: order.userId }, `Your order ${shortId} is on the way!`, "info", String(id));
    } else if (next === "delivered") {
      await pushNotification({ userId: order.userId }, `Your order ${shortId} was delivered`, "success", String(id));
    } else if (next === "cancelled" || next === "rejected") {
      await pushNotification({ vendorId: order.vendorId ?? null }, `Order ${shortId} was ${next}`, "warning", String(id));
    }
  } catch (err) {
    console.warn("[orders] notification push failed:", err);
  }

  // Emit real-time socket event for live tracking.
  try {
    getIO().to(`order:${id}`).emit("order:status", {
      ...updated,
      orderId: id,
      status: next,
    });
  } catch {
    // socket not critical; ignore emit failures
  }

  res.status(200).json({ data: updated });
}
