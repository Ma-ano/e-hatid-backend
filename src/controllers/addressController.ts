import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { UserModel } from "../models/user.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

function paramStr(value: unknown): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

interface AddressEntry {
  id: string;
  label?: string;
  fullAddress: string;
  location?: GeoJsonPoint | null;
  deliveryInstructions?: string;
  isDefault: boolean;
}

/** Server-side cap (prompt1.md §30) — mirrors the UI limit but is authoritative. */
const MAX_ADDRESSES = 10;

function newAddressId(): string {
  return `addr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toList(raw: unknown): AddressEntry[] {
  return Array.isArray(raw) ? (raw as AddressEntry[]) : [];
}

/**
 * Strict location parsing (prompt1.md §29): malformed coordinates are a client
 * bug, not something to silently drop — reject the request so bad data never
 * reaches the DB. Returns undefined only when no location was supplied at all.
 */
function parseLocation(body: Record<string, unknown>): GeoJsonPoint | undefined {
  const loc = body.location;
  if (!loc) return undefined; // not provided
  if (typeof loc === "object" && !Array.isArray(loc)) {
    const coords = (loc as Record<string, unknown>).coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (
        Number.isFinite(lng) &&
        Number.isFinite(lat) &&
        lng >= -180 &&
        lng <= 180 &&
        lat >= -90 &&
        lat <= 90
      ) {
        return { type: "Point", coordinates: [lng, lat] };
      }
    }
  }
  throw new HttpError(
    400,
    "Invalid location coordinates. Please re-select your delivery spot on the map.",
  );
}

export async function listAddresses(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");
  res.status(200).json({ data: toList(doc.addresses) });
}

export async function createAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const body = (req.body ?? {}) as Record<string, unknown>;

  const fullAddress = typeof body.fullAddress === "string" ? body.fullAddress.trim() : "";
  if (!fullAddress) {
    throw new HttpError(400, "Please enter your complete delivery address.");
  }
  if (fullAddress.length > 500) {
    throw new HttpError(400, "Address is too long. Please keep it under 500 characters.");
  }

  const location = parseLocation(body);
  const deliveryInstructions =
    typeof body.deliveryInstructions === "string" ? body.deliveryInstructions.trim() : "";
  const wantsDefault = body.isDefault === true;

  const entry: AddressEntry = {
    id: newAddressId(),
    label: typeof body.label === "string" ? body.label.trim().slice(0, 60) : "",
    fullAddress,
    location: location ?? null,
    deliveryInstructions,
    isDefault: wantsDefault,
  };

  // Atomic create (prompt1.md §30): one update that pushes the entry, clears
  // every other default when this becomes default, and enforces the max-10 cap
  // via a filter — a concurrent request can't slip past the count check.
  const result = await UserModel.updateOne(
    {
      _id: user.sub,
      $expr: { $lt: [{ $size: { $ifNull: ["$addresses", []] } }, MAX_ADDRESSES] },
    },
    [
      {
        $set: {
          addresses: {
            $concatArrays: [
              { $map: { input: "$addresses", as: "a", in: { $mergeObjects: ["$$a", { isDefault: false }] } } },
              [entry],
            ],
          },
        },
      },
    ],
    { updatePipeline: true },
  );

  if (result.modifiedCount === 0) {
    // Either the user hit the cap or doesn't exist.
    const exists = await UserModel.exists({ _id: user.sub });
    if (!exists) throw new HttpError(404, "User not found");
    throw new HttpError(
      400,
      `You can only save up to ${MAX_ADDRESSES} addresses. Delete one first.`,
    );
  }

  // First address always becomes the default.
  const doc = await UserModel.findById(user.sub).lean();
  const list = doc ? toList(doc.addresses) : [];
  const saved = list.find((a) => a.id === entry.id);
  if (saved && list.length > 0 && !list.some((a) => a.isDefault)) {
    saved.isDefault = true;
    await UserModel.updateOne(
      { _id: user.sub, addresses: { $elemMatch: { id: entry.id } } },
      { $set: { "addresses.$.isDefault": true } },
    );
  }

  res.status(201).json({ data: saved ?? entry });
}

export async function updateAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const addrId = paramStr(req.params.addrId);
  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");

  const list = toList(doc.addresses);
  const index = list.findIndex((a) => a.id === addrId);
  const current = index >= 0 ? list[index] : undefined;
  if (!current) throw new HttpError(404, "Address not found");

  const body = (req.body ?? {}) as Record<string, unknown>;

  const fullAddress =
    typeof body.fullAddress === "string" ? body.fullAddress.trim() : current.fullAddress;
  if (!fullAddress) {
    throw new HttpError(400, "Please enter your complete delivery address.");
  }
  if (fullAddress.length > 500) {
    throw new HttpError(400, "Address is too long. Please keep it under 500 characters.");
  }

  let location: GeoJsonPoint | null;
  try {
    location =
      "location" in body ? (parseLocation(body) ?? null) : (current.location ?? null);
  } catch {
    throw new HttpError(
      400,
      "Invalid location coordinates. Please re-select your delivery spot on the map.",
    );
  }

  const deliveryInstructions =
    "deliveryInstructions" in body
      ? typeof body.deliveryInstructions === "string"
        ? body.deliveryInstructions.trim()
        : ""
      : (current.deliveryInstructions ?? "");

  const merged: AddressEntry = {
    ...current,
    id: addrId,
    label: typeof body.label === "string" ? body.label.trim().slice(0, 60) : (current.label ?? ""),
    fullAddress,
    location,
    deliveryInstructions,
    isDefault: current.isDefault, // default changes go through setDefaultAddress
  };

  await UserModel.findByIdAndUpdate(
    user.sub,
    { $set: { [`addresses.${index}`]: merged } },
  );

  const updatedDoc = await UserModel.findById(user.sub).lean();
  const updated = toList(updatedDoc?.addresses).find((a) => a.id === addrId);
  if (!updated) throw new HttpError(404, "Address not found");

  res.status(200).json({ data: updated });
}

export async function deleteAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const addrId = paramStr(req.params.addrId);
  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");

  const removed = toList(doc.addresses).find((a) => a.id === addrId);
  if (!removed) throw new HttpError(404, "Address not found");

  await UserModel.findByIdAndUpdate(user.sub, { $pull: { addresses: { id: addrId } } });

  // If the deleted address was the default, promote the first remaining one.
  if (removed.isDefault) {
    await ensureSingleDefault(user.sub);
  }

  res.status(200).json({ data: { success: true } });
}

export async function setDefaultAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { id } = (req.body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id === "") throw new HttpError(400, "id is required");

  // Atomic default switch (prompt1.md §30): a single bulkWrite clears all
  // defaults then flags the target — no interleaved request can observe zero
  // or two defaults between the steps.
  const result = await UserModel.bulkWrite([
    {
      updateOne: {
        filter: { _id: user.sub },
        update: { $set: { "addresses.$[elem].isDefault": false } },
        arrayFilters: [{ "elem.isDefault": true }],
      },
    },
    {
      updateOne: {
        filter: { _id: user.sub, addresses: { $elemMatch: { id } } },
        update: { $set: { "addresses.$.isDefault": true } },
      },
    },
  ]);

  if (result.modifiedCount === 0) {
    throw new HttpError(404, "Address not found");
  }

  res.status(200).json({ data: { success: true } });
}

/** Guarantee exactly one default exists (first address wins if none do). */
async function ensureSingleDefault(userId: string): Promise<void> {
  const doc = await UserModel.findById(userId).lean();
  if (!doc) return;
  const list = toList(doc.addresses);
  if (list.length === 0 || list.some((a) => a.isDefault)) return;

  const first = list[0];
  if (!first) return;
  await UserModel.bulkWrite([
    {
      updateOne: {
        filter: { _id: userId },
        update: { $set: { "addresses.$[elem].isDefault": false } },
        arrayFilters: [{ "elem.isDefault": true }],
      },
    },
    {
      updateOne: {
        filter: { _id: userId, addresses: { $elemMatch: { id: first.id } } },
        update: { $set: { "addresses.$.isDefault": true } },
      },
    },
  ]);
}
