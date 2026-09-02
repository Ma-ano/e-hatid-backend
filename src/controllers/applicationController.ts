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

export async function submitApplication(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  if (!user) throw new HttpError(401, "Authentication required");

  const { role, data } = req.body as { role?: unknown; data?: unknown };
  if (role !== "vendor" && role !== "rider") {
    throw new HttpError(400, "role must be 'rider' or 'vendor'");
  }

  const existing = await ApplicationModel.findOne({ userId: user.sub, role, status: "pending" }).lean();
  if (existing) {
    throw new HttpError(409, "You already have a pending application for this role");
  }

  const application = await ApplicationModel.create({
    userId: user.sub,
    role,
    status: "pending",
    data: data && typeof data === "object" ? data : {},
  });

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

  const application = await ApplicationModel.findById(id).lean();
  if (!application) throw new HttpError(404, "Application not found");
  if (application.status !== "pending") {
    throw new HttpError(409, "Application already reviewed");
  }

  const status = decision;
  await ApplicationModel.findByIdAndUpdate(id, {
    status,
    reviewedBy: user.sub,
    reviewedAt: new Date(),
    rejectionReason: decision === "rejected" && typeof rejectionReason === "string" ? rejectionReason : "",
  });

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
    const applicant = await UserModel.findById(application.userId).lean();
    if (applicant) {
      const roles = applicant.roles ?? [];
      const roleStatus = { ...(applicant.roleStatus ?? {}) };
      roleStatus[application.role] = "approved";
      const newRoles = roles.includes(application.role) ? roles : [...roles, application.role];
      await UserModel.findByIdAndUpdate(application.userId, { roles: newRoles, roleStatus });
    }
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
  const applications = await ApplicationModel.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: applications });
}
