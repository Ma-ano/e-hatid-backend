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

interface AddressEntry {
  id: string;
  label?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zip?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault: boolean;
}

const ADDRESS_FIELDS = [
  "label",
  "street",
  "barangay",
  "city",
  "province",
  "zip",
  "address",
  "latitude",
  "longitude",
] as const;

function newAddressId(): string {
  return `addr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickFields(body: Record<string, unknown>): Partial<Omit<AddressEntry, "id" | "isDefault">> {
  const out: Partial<Omit<AddressEntry, "id" | "isDefault">> = {};
  for (const field of ADDRESS_FIELDS) {
    if (field === "latitude" || field === "longitude") {
      const v = body[field];
      if (typeof v === "number" && Number.isFinite(v)) out[field] = v;
    } else if (typeof body[field] === "string" && body[field] !== "") {
      out[field] = (body[field] as string).trim();
    }
  }
  return out;
}

function toList(raw: unknown): AddressEntry[] {
  return Array.isArray(raw) ? (raw as AddressEntry[]) : [];
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
  if (typeof body.address !== "string" || body.address!.trim() === "") {
    throw new HttpError(400, "address is required");
  }

  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");

  const list = toList(doc.addresses);
  const isFirst = list.length === 0;
  const wantsDefault = body.isDefault === true;

  const entry: AddressEntry = {
    id: newAddressId(),
    ...pickFields(body),
    isDefault: wantsDefault || isFirst,
  };
  if (entry.isDefault) {
    for (const a of list) a.isDefault = false;
  }

  await UserModel.findByIdAndUpdate(user.sub, { $set: { addresses: [...list, entry] } });

  res.status(201).json({ data: entry });
}

export async function updateAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const addrId = paramStr(req.params.addrId);
  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");

  const list = toList(doc.addresses);
  const index = list.findIndex((a) => a.id === addrId);
  if (index === -1) throw new HttpError(404, "Address not found");
  const current = list[index];
  if (!current) throw new HttpError(404, "Address not found");

  const body = (req.body ?? {}) as Record<string, unknown>;
  const wantsDefault = body.isDefault === true;
  if (wantsDefault) {
    for (const a of list) a.isDefault = false;
  }

  const merged: AddressEntry = {
    ...current,
    ...pickFields(body),
    id: addrId,
    isDefault: wantsDefault ? true : current.isDefault,
  };
  if (merged.isDefault) {
    for (const a of list) a.isDefault = false;
  }
  list[index] = merged;

  await UserModel.findByIdAndUpdate(user.sub, { $set: { addresses: list } });

  res.status(200).json({ data: merged });
}

export async function deleteAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const addrId = paramStr(req.params.addrId);
  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");

  const list = toList(doc.addresses);
  const removed = list.find((a) => a.id === addrId);
  if (!removed) throw new HttpError(404, "Address not found");

  const next = list.filter((a) => a.id !== addrId);
  if (removed.isDefault && next.length > 0 && next[0]) {
    next[0].isDefault = true;
  }

  await UserModel.findByIdAndUpdate(user.sub, { $set: { addresses: next } });

  res.status(200).json({ data: { success: true } });
}

export async function setDefaultAddress(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { id } = (req.body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id === "") throw new HttpError(400, "id is required");

  const doc = await UserModel.findById(user.sub).lean();
  if (!doc) throw new HttpError(404, "User not found");

  const list = toList(doc.addresses);
  const target = list.find((a) => a.id === id);
  if (!target) throw new HttpError(404, "Address not found");

  for (const a of list) a.isDefault = false;
  target.isDefault = true;

  await UserModel.findByIdAndUpdate(user.sub, { $set: { addresses: list } });

  res.status(200).json({ data: { success: true } });
}