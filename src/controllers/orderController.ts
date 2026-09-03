import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { HttpError } from "../middlewares/errorHandler.js";
import { OrderModel, type OrderStatus } from "../models/order.js";
import { StallModel } from "../models/stall.js";
import { UserModel } from "../models/user.js";
import { estimateDeliveryFee, estimateDeliveryWindow } from "../services/deliveryFeeService.js";
import {
  releasePromoUse,
  reservePromoUse,
  validatePromo,
  type PromoReservation,
} from "../services/promoService.js";
import { pushNotification } from "../services/notificationService.js";
import { logAudit } from "../services/auditLogService.js";
import { getIO } from "../socket.js";
import { createHash } from "node:crypto";

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

const MAX_DISTINCT_ITEMS = 100;
const MAX_ITEM_QUANTITY = 99;
const MAX_TEXT_LENGTH = 500;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withoutInternalFields(order: Record<string, unknown>): Record<string, unknown> {
  const result = { ...order };
  delete result.idempotencyFingerprint;
  return result;
}

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

  const rawIdempotencyKey = req.headers["x-idempotency-key"];
  if (typeof rawIdempotencyKey !== "string" || rawIdempotencyKey.trim() === "") {
    throw new HttpError(400, "x-idempotency-key header is required");
  }
  const idempotencyKey = rawIdempotencyKey.trim();
  if (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw new HttpError(400, "x-idempotency-key is invalid");
  }
  const requestFingerprint = fingerprint(body);
  const existing = await OrderModel.findOne({ userId: user.sub, idempotencyKey })
    .select("+idempotencyFingerprint")
    .lean();
  if (existing) {
    if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== requestFingerprint) {
      throw new HttpError(409, "This idempotency key was already used for a different order");
    }
    res.status(200).json({ data: withoutInternalFields(existing), message: "Order already exists for this request" });
    return;
  }

  if (typeof stallId !== "string" || stallId === "") throw new HttpError(400, "stallId required");
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "items must be a non-empty array");
  }
  if (items.length > MAX_DISTINCT_ITEMS) {
    throw new HttpError(400, `items cannot contain more than ${MAX_DISTINCT_ITEMS} entries`);
  }

  const stall = await StallModel.findById(stallId).lean();
  if (!stall) throw new HttpError(404, "Stall not found");
  if (!stall.active) throw new HttpError(409, "This stall is currently unavailable");

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
    if (
      typeof it.quantity !== "number" ||
      !Number.isInteger(it.quantity) ||
      it.quantity < 1 ||
      it.quantity > MAX_ITEM_QUANTITY
    ) {
      throw new HttpError(400, `quantity must be an integer between 1 and ${MAX_ITEM_QUANTITY}`);
    }
    const quantity = it.quantity;

    const menuItem = (menu as {
      id?: unknown;
      name?: unknown;
      price?: unknown;
      image?: unknown;
      available?: unknown;
      options?: {
        name?: unknown;
        required?: unknown;
        maxSelections?: unknown;
        choices?: { name?: unknown; price?: unknown }[];
      }[];
      addOns?: { name?: unknown; price?: unknown }[];
    }[]).find(
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
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpError(409, `"${String(menuItem.name ?? menuItemId)}" has an invalid price`);
    }

    if (it.selectedOptions !== undefined && !Array.isArray(it.selectedOptions)) {
      throw new HttpError(400, "selectedOptions must be an array");
    }
    const rawOptions = (it.selectedOptions ?? []) as unknown[];
    if (!rawOptions.every((option): option is string => typeof option === "string")) {
      throw new HttpError(400, "selectedOptions must contain only strings");
    }
    const opts = [...new Set(rawOptions)];
    if (opts.length !== rawOptions.length) {
      throw new HttpError(400, "selectedOptions cannot contain duplicates");
    }
    for (const group of menuItem.options ?? []) {
      const choices = group.choices ?? [];
      const selectedCount = opts.filter((label) => choices.some((choice) => choice.name === label)).length;
      const maxSelections = Number(group.maxSelections ?? 1);
      if (!Number.isInteger(maxSelections) || maxSelections < 1) {
        throw new HttpError(409, `"${String(menuItem.name ?? menuItemId)}" has invalid option settings`);
      }
      if (group.required && selectedCount === 0) {
        throw new HttpError(400, `Please choose an option for ${String(group.name ?? "this item")}`);
      }
      if (selectedCount > maxSelections) {
        throw new HttpError(400, `Too many selections for ${String(group.name ?? "this item")}`);
      }
    }
    for (const label of opts) {
      const choice = (menuItem.options ?? [])
        .flatMap((g) => g.choices ?? [])
        .find((c) => c.name === label);
      if (!choice) throw new HttpError(400, `Unknown option: ${label}`);
      const optionPrice = Number(choice.price ?? 0);
      if (!Number.isFinite(optionPrice) || optionPrice < 0) {
        throw new HttpError(409, `"${String(menuItem.name ?? menuItemId)}" has an invalid option price`);
      }
      unitPrice += optionPrice;
    }

    if (it.selectedAddOns !== undefined && !Array.isArray(it.selectedAddOns)) {
      throw new HttpError(400, "selectedAddOns must be an array");
    }
    const rawAddOns = (it.selectedAddOns ?? []) as unknown[];
    if (!rawAddOns.every((addOn): addOn is string => typeof addOn === "string")) {
      throw new HttpError(400, "selectedAddOns must contain only strings");
    }
    const addOns = [...new Set(rawAddOns)];
    if (addOns.length !== rawAddOns.length) {
      throw new HttpError(400, "selectedAddOns cannot contain duplicates");
    }
    for (const label of addOns) {
      const addOn = (menuItem.addOns ?? []).find((a) => a.name === label);
      if (!addOn) throw new HttpError(400, `Unknown add-on: ${label}`);
      const addOnPrice = Number(addOn.price ?? 0);
      if (!Number.isFinite(addOnPrice) || addOnPrice < 0) {
        throw new HttpError(409, `"${String(menuItem.name ?? menuItemId)}" has an invalid add-on price`);
      }
      unitPrice += addOnPrice;
    }

    const unit = Math.round(unitPrice * 100) / 100;
    subtotal += unit * quantity;

    validatedItems.push({
      menuItemId,
      name: String(menuItem.name ?? menuItemId),
      price: unit,
      quantity,
      image: typeof menuItem.image === "string" ? menuItem.image : "",
      selectedOptions: opts,
      selectedAddOns: addOns,
      specialInstructions:
        typeof it.specialInstructions === "string"
          ? it.specialInstructions.trim().slice(0, MAX_TEXT_LENGTH)
          : "",
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  if (subtotal < Number(stall.minOrder ?? 0)) {
    throw new HttpError(400, `Minimum order is ₱${Number(stall.minOrder ?? 0).toFixed(2)}`);
  }

  const toCoordinate = (v: unknown, kind: "latitude" | "longitude"): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new HttpError(400, `${kind} must be a finite number`);
    }
    const limit = kind === "latitude" ? 90 : 180;
    if (v < -limit || v > limit) {
      throw new HttpError(400, `${kind} is outside its valid range`);
    }
    return v;
  };

  // Parse deliveryLocation from the request body (prompt1.md spec)
  const rawDeliveryLocation = body.deliveryLocation;
  let deliveryLocation: {
    fullAddress: string;
    location: { type: "Point"; coordinates: [number, number] } | null;
    deliveryInstructions: string;
  } | null = null;
  let deliveryInstructionsFromLocation = "";
  if (rawDeliveryLocation && typeof rawDeliveryLocation === "object" && !Array.isArray(rawDeliveryLocation)) {
    const dlObj = rawDeliveryLocation as Record<string, unknown>;
    const fullAddress = typeof dlObj.fullAddress === "string" ? dlObj.fullAddress.trim() : "";
    if (fullAddress.length > MAX_TEXT_LENGTH) throw new HttpError(400, "Delivery address is too long");
    const instructions = typeof dlObj.deliveryInstructions === "string" ? dlObj.deliveryInstructions.trim() : "";
    if (instructions.length > MAX_TEXT_LENGTH) throw new HttpError(400, "Delivery instructions are too long");
    deliveryInstructionsFromLocation = instructions;

    let locationGeo: { type: "Point"; coordinates: [number, number] } | null = null;
    const rawLoc = dlObj.location;
    if (rawLoc && typeof rawLoc === "object" && !Array.isArray(rawLoc)) {
      const locObj = rawLoc as Record<string, unknown>;
      const coords = locObj.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
          locationGeo = { type: "Point", coordinates: [lng, lat] };
        } else {
          throw new HttpError(400, "Invalid delivery location coordinates");
        }
      } else {
        throw new HttpError(400, "deliveryLocation.location must contain two coordinates");
      }
    }

    deliveryLocation = {
      fullAddress,
      location: locationGeo,
      deliveryInstructions: instructions,
    };
  }

  let customerLat = toCoordinate(body.customerLatitude, "latitude");
  let customerLng = toCoordinate(body.customerLongitude, "longitude");
  if ((customerLat === null) !== (customerLng === null)) {
    throw new HttpError(400, "Both customerLatitude and customerLongitude are required together");
  }
  if (deliveryLocation?.location) {
    const [locationLng, locationLat] = deliveryLocation.location.coordinates;
    if (customerLat === null && customerLng === null) {
      customerLat = locationLat;
      customerLng = locationLng;
    } else if (
      customerLat !== null &&
      customerLng !== null &&
      (Math.abs(customerLat - locationLat) > 0.0001 || Math.abs(customerLng - locationLng) > 0.0001)
    ) {
      throw new HttpError(400, "Delivery coordinates do not match the selected location");
    }
  }

  const fallbackAddress = typeof body.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  if (fallbackAddress.length > MAX_TEXT_LENGTH) throw new HttpError(400, "Delivery address is too long");
  const deliveryAddress = deliveryLocation?.fullAddress || fallbackAddress;
  if (!deliveryAddress) throw new HttpError(400, "A delivery address is required");

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
  let appliedPromo: Parameters<typeof reservePromoUse>[0] | null = null;
  const rawPromo = body.promoCode;
  if (typeof rawPromo === "string" && rawPromo.trim() !== "") {
    const promo = await validatePromo(
      { code: rawPromo, subtotal, stallId: String(stall._id), userId: user.sub },
      deliveryFee,
    );
    discount = promo.discount;
    promoCode = promo.promo.code;
    appliedPromo = promo.promo;
  }

  // Payment method is validated server-side. E-Hatid currently supports COD only;
  // any other value is rejected so unsupported methods can never be recorded.
  if (body.paymentMethod !== undefined && body.paymentMethod !== "cod") {
    throw new HttpError(400, "Unsupported payment method");
  }
  const paymentMethod = "cod";

  // Idempotency: if the client retries a request (e.g. after a dropped response),
  // serve the same order instead of creating a duplicate.
  let promoReservation: PromoReservation | null = null;
  if (appliedPromo) {
    promoReservation = await reservePromoUse(appliedPromo, user.sub);
  }

  // Snapshot preparation + route-based rider travel so the order ETA remains
  // explainable even if the vendor changes preparation settings later.
  const deliveryWindow = estimateDeliveryWindow(distance, stall);

  let order;
  try {
    order = await OrderModel.create({
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
      deliveryAddress,
      deliveryInstructions: deliveryInstructionsFromLocation || "",
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, MAX_TEXT_LENGTH) : "",
      distance,
      estimatedDeliveryTime: deliveryWindow.estimatedDeliveryTime,
      preparationTimeMin: deliveryWindow.preparationTimeMin,
      preparationTimeMax: deliveryWindow.preparationTimeMax,
      travelTimeMin: deliveryWindow.travelTimeMin,
      travelTimeMax: deliveryWindow.travelTimeMax,
      customerLatitude: customerLat,
      customerLongitude: customerLng,
      stallLatitude: stall.latitude ?? null,
      stallLongitude: stall.longitude ?? null,
      status: "pending",
      idempotencyKey,
      idempotencyFingerprint: requestFingerprint,
    });
  } catch (err) {
    if (promoReservation) {
      await releasePromoUse(promoReservation)
        .catch((rollbackError) => console.error("[promos] reservation rollback failed:", rollbackError));
    }
    if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
      const racedOrder = await OrderModel.findOne({ userId: user.sub, idempotencyKey })
        .select("+idempotencyFingerprint")
        .lean();
      if (racedOrder && (!racedOrder.idempotencyFingerprint || racedOrder.idempotencyFingerprint === requestFingerprint)) {
        res.status(200).json({ data: withoutInternalFields(racedOrder), message: "Order already exists for this request" });
        return;
      }
      throw new HttpError(409, "This idempotency key was already used for a different order");
    }
    throw err;
  }

  // Notify vendor of a new incoming order.
  if (stall.vendorId) {
    try {
      await pushNotification(
        { vendorId: String(stall.vendorId) },
        `New order #${String(order._id).slice(-6).toUpperCase()} from ${orderUser.name || "a customer"}`,
        "info",
        String(order._id),
      );
    } catch (err) {
      console.warn("[orders] vendor notification failed:", err);
    }
  }

  res.status(201).json({ data: withoutInternalFields(order.toObject()) });
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

  const orders = await OrderModel.find(query).sort({ createdAt: -1 }).limit(500).lean();
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
  if (!authUser?.available) {
    res.status(200).json({ data: [] });
    return;
  }

  const orders = await OrderModel.find({
    status: { $in: ["ready", "ready_for_pickup"] },
    riderId: { $in: [null, ""] },
  })
    .select("_id stallId stallName items.name items.quantity deliveryFee total distance status readyAt createdAt")
    .sort({ readyAt: 1, createdAt: 1 })
    .limit(100)
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
      if (
        roles.includes("rider") &&
        !order.riderId &&
        (order.status === "ready" || order.status === "ready_for_pickup")
      ) return "rider-claim";
      return null;
    case "delivered":
      return roles.includes("rider") && order.riderId === userId ? "rider" : null;
    case "cancelled":
      // Customer may cancel before preparation starts; vendor may cancel later.
      if (order.userId === userId && (order.status === "pending" || order.status === "accepted")) return "customer";
      if (
        roles.includes("vendor") &&
        order.vendorId === userId &&
        ["accepted", "preparing", "ready", "ready_for_pickup"].includes(order.status)
      ) return "vendor";
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
  if (typeof cancelledReason === "string" && cancelledReason.trim().length > MAX_TEXT_LENGTH) {
    throw new HttpError(400, "Cancellation reason is too long");
  }

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
  if (next === "delivering" && roles.includes("rider") && !authUser?.available) {
    throw new HttpError(403, "Go online before accepting a delivery");
  }
  const actor = actorFor(next, order, roles, user.sub);
  if (!actor) {
    throw new HttpError(403, "This status transition is not allowed");
  }

  const update: Record<string, unknown> = { status: next };
  if (next === "cancelled" || next === "rejected") {
    update.cancelledReason = typeof cancelledReason === "string" && cancelledReason.trim()
      ? cancelledReason.trim()
      : `Order ${next}`;
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
    } else if (next === "cancelled" && actor === "customer") {
      await pushNotification({ vendorId: order.vendorId ?? null }, `Order ${shortId} was cancelled by the customer`, "warning", String(id));
    } else if (next === "cancelled" || next === "rejected") {
      await pushNotification({ userId: order.userId }, `Your order ${shortId} was ${next}`, "warning", String(id));
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
