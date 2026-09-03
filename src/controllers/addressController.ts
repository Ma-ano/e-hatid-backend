import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { UserModel } from "../models/user.js";
import { randomUUID } from "node:crypto";

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
  return `addr-${randomUUID()}`;
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
  if (deliveryInstructions.length > 500) {
    throw new HttpError(400, "Delivery instructions are too long.");
  }
  const wantsDefault = body.isDefault === true;

  const entry: AddressEntry = {
    id: newAddressId(),
    label: typeof body.label === "string" ? body.label.trim().slice(0, 60) : "",
    fullAddress,
    location: location ?? null,
    deliveryInstructions,
    isDefault: wantsDefault,
  };

  // One pipeline update enforces the cap and preserves an existing default.
  // The first address, or one explicitly requested as default, becomes default.
  const result = await UserModel.updateOne(
    {
      _id: user.sub,
      $expr: { $lt: [{ $size: { $ifNull: ["$addresses", []] } }, MAX_ADDRESSES] },
    },
    [
      {
        $set: {
          addresses: {
            $let: {
              vars: { current: { $ifNull: ["$addresses", []] } },
              in: {
                $concatArrays: [
                  {
                    $cond: [
                      wantsDefault,
                      { $map: { input: "$$current", as: "a", in: { $mergeObjects: ["$$a", { isDefault: false }] } } },
                      "$$current",
                    ],
                  },
                  [
                    {
                      ...entry,
                      isDefault: { $or: [wantsDefault, { $eq: [{ $size: "$$current" }, 0] }] },
                    },
                  ],
                ],
              },
            },
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

  const doc = await UserModel.findById(user.sub).lean();
  const list = doc ? toList(doc.addresses) : [];
  const saved = list.find((a) => a.id === entry.id);

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
  if (deliveryInstructions.length > 500) {
    throw new HttpError(400, "Delivery instructions are too long.");
  }

  const merged: AddressEntry = {
    ...current,
    id: addrId,
    label: typeof body.label === "string" ? body.label.trim().slice(0, 60) : (current.label ?? ""),
    fullAddress,
    location,
    deliveryInstructions,
    isDefault: current.isDefault, // default changes go through setDefaultAddress
  };

  const result = await UserModel.updateOne(
    { _id: user.sub, addresses: { $elemMatch: { id: addrId } } },
    { $set: { "addresses.$[address]": merged } },
    { arrayFilters: [{ "address.id": addrId }] },
  );
  if (result.matchedCount === 0) throw new HttpError(404, "Address not found");

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

  const result = await UserModel.updateOne(
    { _id: user.sub, addresses: { $elemMatch: { id: addrId } } },
    [
      {
        $set: {
          addresses: {
            $let: {
              vars: {
                remaining: {
                  $filter: {
                    input: { $ifNull: ["$addresses", []] },
                    as: "address",
                    cond: { $ne: ["$$address.id", addrId] },
                  },
                },
                removedWasDefault: {
                  $anyElementTrue: {
                    $map: {
                      input: { $ifNull: ["$addresses", []] },
                      as: "address",
                      in: {
                        $and: [
                          { $eq: ["$$address.id", addrId] },
                          { $eq: ["$$address.isDefault", true] },
                        ],
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  "$$removedWasDefault",
                  {
                    $map: {
                      input: "$$remaining",
                      as: "address",
                      in: {
                        $mergeObjects: [
                          "$$address",
                          {
                            isDefault: {
                              $eq: [
                                "$$address.id",
                                {
                                  $getField: {
                                    field: "id",
                                    input: { $arrayElemAt: ["$$remaining", 0] },
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                  "$$remaining",
                ],
              },
            },
          },
        },
      },
    ],
    { updatePipeline: true },
  );
  if (result.matchedCount === 0) throw new HttpError(404, "Address not found");

  res.status(200).json({ data: { success: true } });
}

export async function setDefaultAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { id } = (req.body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id === "") throw new HttpError(400, "id is required");

  const result = await UserModel.updateOne(
    { _id: user.sub, addresses: { $elemMatch: { id } } },
    [
      {
        $set: {
          addresses: {
            $map: {
              input: { $ifNull: ["$addresses", []] },
              as: "address",
              in: {
                $mergeObjects: ["$$address", { isDefault: { $eq: ["$$address.id", id] } }],
              },
            },
          },
        },
      },
    ],
    { updatePipeline: true },
  );

  if (result.matchedCount === 0) {
    throw new HttpError(404, "Address not found");
  }

  res.status(200).json({ data: { success: true } });
}
