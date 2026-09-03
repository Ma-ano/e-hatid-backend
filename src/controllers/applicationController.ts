import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { ApplicationModel } from "../models/application.js";
import { UserModel } from "../models/user.js";
import { logAudit } from "../services/auditLogService.js";
import { pushNotification } from "../services/notificationService.js";

interface AuthUser {
  sub: string;
}

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

const APPLICATION_FIELDS = {
  vendor: new Set(["stallName", "stallAddress", "cuisine", "about"]),
  rider: new Set(["vehicle", "licensePlate", "licence", "about", "sourceLocationSlug"]),
} as const;

function sanitizeApplicationData(
  role: "vendor" | "rider",
  raw: unknown,
  applicant: { name?: string; email?: string; phone?: string },
): Record<string, string> {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
    throw new HttpError(400, "data must be an object");
  }

  const input = (raw ?? {}) as Record<string, unknown>;
  const allowed = APPLICATION_FIELDS[role];
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    // Identity/contact values are always sourced from the authenticated user.
    if (key === "name" || key === "contactEmail" || key === "contactPhone") continue;
    if (!allowed.has(key)) throw new HttpError(400, `Unsupported application field: ${key}`);
    if (typeof value !== "string") throw new HttpError(400, `${key} must be a string`);
    output[key] = value.trim().slice(0, 1000);
  }
  output.name = applicant.name ?? "";
  output.contactEmail = applicant.email ?? "";
  output.contactPhone = applicant.phone ?? "";
  return output;
}

export async function submitApplication(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { role, data } = req.body as { role?: unknown; data?: unknown };
  if (role !== "vendor" && role !== "rider") {
    throw new HttpError(400, "role must be 'rider' or 'vendor'");
  }

  const applicant = await UserModel.findById(user.sub).lean();
  if (!applicant) throw new HttpError(404, "User not found");
  if ((applicant.roles ?? []).includes(role)) {
    throw new HttpError(409, `This account already has the ${role} role`);
  }
  const applicationData = sanitizeApplicationData(role, data, applicant);

  const existing = await ApplicationModel.findOne({ userId: user.sub, role, status: "pending" }).lean();
  if (existing) {
    throw new HttpError(409, "You already have a pending application for this role");
  }

  let application;
  try {
    application = await ApplicationModel.create({
      userId: user.sub,
      role,
      status: "pending",
      data: applicationData,
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
      throw new HttpError(409, "You already have a pending application for this role");
    }
    throw err;
  }

  await UserModel.updateOne(
    { _id: user.sub },
    { $set: { [`roleStatus.${role}`]: "pending" } },
  );

  res.status(201).json({ data: application });
}

export async function listMyApplications(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  const applications = await ApplicationModel.find({ userId: user.sub }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: applications });
}

export async function reviewApplication(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  // Authorize as admin via dbUser loaded by requireRole.
  const authUser = await UserModel.findById(user.sub).lean();
  if (!authUser || !(authUser.roles ?? []).includes("admin")) {
    throw new HttpError(403, "Admin access required");
  }

  const { id } = req.params;
  const { decision, rejectionReason } = req.body as { decision?: unknown; rejectionReason?: unknown };
  if (decision !== "approved" && decision !== "rejected") {
    throw new HttpError(400, "decision must be 'approved' or 'rejected'");
  }

  const status = decision;
  const application = await ApplicationModel.findOneAndUpdate(
    { _id: id, status: "pending" },
    {
      $set: {
        status,
        reviewedBy: user.sub,
        reviewedAt: new Date(),
        rejectionReason: decision === "rejected" && typeof rejectionReason === "string" ? rejectionReason.trim().slice(0, 500) : "",
      },
    },
    { new: false },
  ).lean();
  if (!application) {
    const exists = await ApplicationModel.exists({ _id: id });
    if (!exists) throw new HttpError(404, "Application not found");
    throw new HttpError(409, "Application already reviewed");
  }

  await logAudit(req, {
    category: "application",
    action: `application.${decision}`,
    targetType: "Application",
    targetId: String(id),
    meta: {
      role: application.role,
      applicantUserId: application.userId,
      rejectionReason: typeof rejectionReason === "string" ? rejectionReason : "",
    },
  });

  // If approved, add the role to the applicant's user account.
  if (decision === "approved") {
    await UserModel.updateOne(
      { _id: application.userId },
      {
        $addToSet: { roles: application.role },
        $set: { [`roleStatus.${application.role}`]: "approved" },
        $inc: { sessionVersion: 1 },
      },
    );
  } else {
    await UserModel.updateOne(
      { _id: application.userId },
      {
        $pull: { roles: application.role },
        $set: { [`roleStatus.${application.role}`]: "rejected" },
        $inc: { sessionVersion: 1 },
      },
    );
  }

  // Notify the applicant so the outcome is visible in their notification center.
  try {
    const roleLabel = application.role === "vendor" ? "Vendor" : "Rider";
    if (decision === "approved") {
      await pushNotification(
        { userId: application.userId },
        `${roleLabel} Application Approved — you can now access the ${roleLabel.toLowerCase()} dashboard.`,
        "success",
        undefined,
        application.role === "vendor" ? "/vendor" : "/rider",
      );
    } else {
      const reason =
        typeof rejectionReason === "string" && rejectionReason.trim() !== ""
          ? ` Reason: ${rejectionReason.trim()}`
          : "";
      await pushNotification(
        { userId: application.userId },
        `Your ${roleLabel} application was not approved.${reason}`,
        "warning",
        undefined,
        application.role === "vendor" ? "/become-vendor" : "/become-rider",
      );
    }
  } catch (err) {
    console.warn("[applications] notification push failed:", err);
  }

  const updated = await ApplicationModel.findById(id).lean();
  res.status(200).json({ data: updated });
}

export async function listApplications(_req: Request, res: Response): Promise<void> {
  const applications = await ApplicationModel.find().sort({ createdAt: -1 }).limit(500).lean();
  res.status(200).json({ data: applications });
}
