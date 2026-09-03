import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { UserModel } from "../models/user.js";
import { toSafeUser } from "../services/userService.js";
import { getDbUser, requireAuth } from "../middlewares/auth.js";
import { logAudit } from "../services/auditLogService.js";
import { ApplicationModel } from "../models/application.js";

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
      const value = body[field];
      if (field === "latitude" || field === "longitude") {
        if (value === null) {
          update[field] = null;
          continue;
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new HttpError(400, `${field} must be a finite number or null`);
        }
        const limit = field === "latitude" ? 90 : 180;
        if (value < -limit || value > limit) {
          throw new HttpError(400, `${field} is outside its valid range`);
        }
        update[field] = value;
        continue;
      }
      if (typeof value !== "string") {
        throw new HttpError(400, `${field} must be a string`);
      }
      const trimmed = value.trim();
      if (field === "name" && trimmed === "") {
        throw new HttpError(400, "name cannot be empty");
      }
      const maxLength = field === "avatar" ? 750_000 : 500;
      if (trimmed.length > maxLength) {
        throw new HttpError(400, `${field} is too long`);
      }
      update[field] = trimmed;
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
  if (typeof available !== "boolean") {
    throw new HttpError(400, "available must be a boolean");
  }
  const user = await UserModel.findByIdAndUpdate(
    authReq.user?.sub,
    { available },
    { new: true },
  ).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  res.status(200).json({ data: toSafeUser(user) });
}

export async function applyForRole(req: Request, res: Response): Promise<void> {
  const authReq = req as Request & { user?: { sub: string } };
  const userId = authReq.user?.sub;
  if (!userId) throw new HttpError(401, "Authentication required");
  const { role } = req.body as { role?: unknown; data?: unknown };

  if (role !== "rider" && role !== "vendor") {
    throw new HttpError(400, "role must be 'rider' or 'vendor'");
  }

  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new HttpError(404, "User not found");
  }

  const roles = user.roles ?? [];
  if (roles.includes(role)) {
    // If already approved, it's a no-op; return current state.
    res.status(200).json({ data: toSafeUser(user) });
    return;
  }

  const pending = await ApplicationModel.findOne({ userId, role, status: "pending" }).lean();
  if (!pending) {
    try {
      await ApplicationModel.create({ userId, role, status: "pending", data: {} });
    } catch (err) {
      if (!(typeof err === "object" && err !== null && (err as { code?: number }).code === 11000)) {
        throw err;
      }
    }
  }

  await UserModel.findByIdAndUpdate(userId, {
    $set: { [`roleStatus.${role}`]: "pending" },
  });

  const updated = await UserModel.findById(userId).lean();
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

  const actor = getDbUser(req) as { isMasterAdmin?: boolean } | undefined;
  if (role === "admin" && actor?.isMasterAdmin !== true) {
    throw new HttpError(403, "Only the master administrator can change admin access");
  }
  if (role === "admin" && user.isMasterAdmin && status !== "approved") {
    throw new HttpError(403, "The master administrator cannot be demoted");
  }

  const roles = user.roles ?? [];
  const newRoles = status === "approved"
    ? (roles.includes(role) ? roles : [...roles, role])
    : roles.filter((memberRole) => memberRole !== role);

  const update: Record<string, unknown> = {
    [`roleStatus.${role}`]: status,
    roles: newRoles,
  };
  if (status !== "approved" && user.activeRole === role) {
    update.activeRole = "customer";
  }

  const updated = await UserModel.findByIdAndUpdate(
    id,
    { $set: update, $inc: { sessionVersion: 1 } },
    { new: true, runValidators: true },
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
  const users = await UserModel.find().sort({ createdAt: -1 }).limit(500).lean();
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
