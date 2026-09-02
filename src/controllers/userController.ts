import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { UserModel } from "../models/user.js";
import { toSafeUser } from "../services/userService.js";
import { getDbUser, requireAuth } from "../middlewares/auth.js";
import { logAudit } from "../services/auditLogService.js";

const PROFILE_FIELDS = [
  "name",
  "phone",
  "avatar",
  "address",
  "addressStreet",
  "addressBarangay",
  "addressCity",
  "addressProvince",
  "addressRegion",
  "addressZip",
  "vehicle",
  "licensePlate",
  "licenseNumber",
  "bankAccount",
  "bankName",
  "stallName",
  "stallAddress",
  "latitude",
  "longitude",
] as const;

export async function getMe(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const user = await UserModel.findById(authReq.user?.sub).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  res.status(200).json({ data: toSafeUser(user) });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const body = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    if (field in body && body[field] !== undefined) {
      update[field] = body[field];
    }
  }

  const user = await UserModel.findByIdAndUpdate(authReq.user?.sub, update, {
    new: true,
    runValidators: true,
  }).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  res.status(200).json({ data: toSafeUser(user) });
}

export async function setAvailability(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const { available } = req.body as { available?: unknown };
  const state = typeof available === "boolean" ? available : available === true;
  const user = await UserModel.findByIdAndUpdate(
    authReq.user?.sub,
    { available: state },
    { new: true },
  ).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  res.status(200).json({ data: toSafeUser(user) });
}

export async function applyForRole(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const { role } = req.body as { role?: unknown; data?: unknown };

  if (role !== "rider" && role !== "vendor") {
    throw new HttpError(400, "role must be 'rider' or 'vendor'");
  }

  const user = await UserModel.findById(authReq.user?.sub).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }

  const roles = user.roles ?? [];
  if (roles.includes(role)) {
    // If already approved, it's a no-op; return current state.
    res.status(200).json({ data: toSafeUser(user) });
    return;
  }

  const roleStatus = { ...(user.roleStatus ?? {}) };
  roleStatus[role] = "pending";

  await UserModel.findByIdAndUpdate(authReq.user?.sub, { roleStatus });

  const updated = await UserModel.findById(authReq.user?.sub).lean();
  res.status(200).json({ data: updated ? toSafeUser(updated) : toSafeUser(user) });
}

// ---- Admin: manage any user's role status ----

export async function setRoleStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { role, status } = req.body as { role?: unknown; status?: unknown };

  if (role !== "rider" && role !== "vendor" && role !== "admin") {
    throw new HttpError(400, "role must be 'rider', 'vendor' or 'admin'");
  }
  if (status !== "approved" && status !== "rejected" && status !== "pending") {
    throw new HttpError(400, "status must be 'approved', 'rejected' or 'pending'");
  }

  const user = await UserModel.findById(id).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }

  const roleStatus = { ...(user.roleStatus ?? {}) };
  roleStatus[role] = status;

  const roles = user.roles ?? [];
  let newRoles = roles;
  if (status === "approved" && !roles.includes(role)) {
    newRoles = [...roles, role];
  }
  if ((status === "rejected" || status === "pending") && role !== "admin") {
    newRoles = newRoles.filter((r) => r !== role);
  }

  const updated = await UserModel.findByIdAndUpdate(
    id,
    { roleStatus, roles: newRoles },
    { new: true },
  ).lean();

  await logAudit(req, {
    category: "user",
    action: `user.role.${status}`,
    targetType: "User",
    targetId: String(id),
    meta: { role, previousRoles: roles, newRoles },
  });

  res.status(200).json({ data: updated ? toSafeUser(updated) : null });
}

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await UserModel.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: users.map(toSafeUser) });
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const user = await UserModel.findById(id).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  res.status(200).json({ data: toSafeUser(user) });
}

export { requireAuth, getDbUser };
