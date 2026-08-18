import { UserModel } from "../models/user.js";

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  avatar: string;
  address: string;
  role: string;
  roles: string[];
  activeRole: string;
  roleStatus: Record<string, string>;
  isMasterAdmin: boolean;
  vehicle: string | undefined;
  licensePlate: string | undefined;
  licenseNumber: string | undefined;
  bankAccount: string | undefined;
  bankName: string | undefined;
  stallName: string | undefined;
  stallAddress: string | undefined;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  createdAt: unknown | undefined;
  available: boolean;
}

export function toSafeUser(doc: {
  _id: unknown;
  name: string;
  email: string;
  phone?: string;
  emailVerified?: boolean;
  avatar?: string;
  address?: string;
  role?: string;
  roles?: string[];
  activeRole?: string;
  roleStatus?: unknown;
  isMasterAdmin?: boolean;
  vehicle?: string;
  licensePlate?: string;
  licenseNumber?: string;
  bankAccount?: string;
  bankName?: string;
  stallName?: string;
  stallAddress?: string;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: unknown;
  available?: boolean;
}): SafeUser {
  const rawStatus = doc.roleStatus;
  const roleStatus: Record<string, string> = {};
  if (rawStatus instanceof Map) {
    rawStatus.forEach((value, key) => {
      roleStatus[key] = String(value);
    });
  } else if (rawStatus && typeof rawStatus === "object") {
    Object.assign(roleStatus, rawStatus as Record<string, string>);
  }

  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    phone: doc.phone ?? "",
    emailVerified: doc.emailVerified ?? false,
    avatar: doc.avatar ?? "",
    address: doc.address ?? "",
    role: doc.role ?? "customer",
    roles: doc.roles ?? ["customer"],
    activeRole: doc.activeRole ?? doc.role ?? "customer",
    roleStatus,
    isMasterAdmin: doc.isMasterAdmin ?? false,
    vehicle: doc.vehicle,
    licensePlate: doc.licensePlate,
    licenseNumber: doc.licenseNumber,
    bankAccount: doc.bankAccount,
    bankName: doc.bankName,
    stallName: doc.stallName,
    stallAddress: doc.stallAddress,
    latitude: doc.latitude,
    longitude: doc.longitude,
    createdAt: doc.createdAt,
    available: doc.available ?? false,
  };
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  const user = await UserModel.findById(id).lean();
  return user ? toSafeUser(user) : null;
}
