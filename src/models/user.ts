import { Schema, model, type InferSchemaType } from "mongoose";

export const ROLES = ["customer", "rider", "vendor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_STATUSES = ["none", "pending", "approved", "rejected"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    phone: { type: String, trim: true, default: "" },

    // Auth
    passwordHash: { type: String, default: "" },
    emailVerified: { type: Boolean, default: false },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },

    // Address (split fields)
    addressStreet: { type: String, default: "" },
    addressBarangay: { type: String, default: "" },
    addressCity: { type: String, default: "" },
    addressProvince: { type: String, default: "" },
    addressRegion: { type: String, default: "" },
    addressZip: { type: String, default: "" },
    address: { type: String, default: "" },

    // Address book (prompt1.md spec)
    addresses: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            label: { type: String, default: "" },
            fullAddress: { type: String, default: "" },
            location: {
              type: new Schema(
                {
                  type: { type: String, default: "Point" },
                  coordinates: { type: [Number], default: [0, 0] },
                },
                { _id: false },
              ),
              default: null,
            },
            deliveryInstructions: { type: String, default: "" },
            isDefault: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    avatar: { type: String, default: "" },

    // Role system
    role: { type: String, enum: ROLES, default: "customer" },
    roles: { type: [String], enum: ROLES, default: ["customer"] },
    activeRole: { type: String, enum: ROLES, default: "customer" },
    roleStatus: {
      type: Map,
      of: { type: String, enum: ROLE_STATUSES },
      default: {
        customer: "approved",
        rider: "none",
        vendor: "none",
        admin: "none",
      },
    },

    isMasterAdmin: { type: Boolean, default: false },

    // Rider-specific
    vehicle: { type: String, default: "" },
    licensePlate: { type: String, default: "" },
    licenseNumber: { type: String, default: "" },
    bankAccount: { type: String, default: "" },
    bankName: { type: String, default: "" },

    // Vendor-specific
    stallName: { type: String, default: "" },
    stallAddress: { type: String, default: "" },

    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },

    accountStatus: { type: String, default: "" },

    // Rider availability (spec §39)
    available: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

export type User = InferSchemaType<typeof userSchema>;

export const UserModel = model("User", userSchema);
