import { Schema, model, type InferSchemaType } from "mongoose";

export const ORDER_STATUSES = [
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
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["cod"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["unpaid", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const orderItemSchema = new Schema(
  {
    menuItemId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
      validate: { validator: Number.isInteger, message: "quantity must be an integer" },
    },
    image: { type: String, default: "" },
    selectedOptions: { type: [String], default: [] },
    selectedAddOns: { type: [String], default: [] },
    specialInstructions: { type: String, default: "", maxlength: 500 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    stallId: { type: String, required: true },
    vendorId: { type: String, index: true },
    stallName: { type: String, default: "" },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },

    items: { type: [orderItemSchema], default: [] },

    subtotal: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    serviceFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    promoCode: { type: String, default: "" },
    total: { type: Number, required: true, min: 0 },

    distance: { type: Number, default: 0, min: 0 },
    deliveryAddress: { type: String, default: "", maxlength: 500 },
    deliveryLocation: {
      type: new Schema(
        {
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
        },
        { _id: false },
      ),
      default: null,
    },
    deliveryInstructions: { type: String, default: "", maxlength: 500 },

    customerLatitude: { type: Number, default: null, min: -90, max: 90 },
    customerLongitude: { type: Number, default: null, min: -180, max: 180 },
    stallLatitude: { type: Number, default: null, min: -90, max: 90 },
    stallLongitude: { type: Number, default: null, min: -180, max: 180 },

    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },

    riderId: { type: String, default: null, index: true },
    riderName: { type: String, default: "" },
    riderPhone: { type: String, default: "" },
    riderPlate: { type: String, default: "" },
    riderAvatar: { type: String, default: "" },

    cancelledReason: { type: String, default: "", maxlength: 500 },
    completedAt: { type: Date, default: null },

    notes: { type: String, default: "", maxlength: 500 },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cod" },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "unpaid" },
    paidAt: { type: Date, default: null },

    estimatedDeliveryTime: { type: String, default: "" },
    acceptedAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },

    // Idempotency: POST /orders can be retried safely with the same key.
    idempotencyKey: { type: String, default: "", maxlength: 128 },
    idempotencyFingerprint: { type: String, default: "", select: false },
  },
  { timestamps: true, versionKey: false },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ vendorId: 1, createdAt: -1 });
orderSchema.index({ riderId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ riderId: 1, status: 1, createdAt: -1 });
orderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, riderId: 1, readyAt: 1, createdAt: 1 });
orderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } },
);

export type Order = InferSchemaType<typeof orderSchema>;
export type OrderItem = InferSchemaType<typeof orderItemSchema>;

export const OrderModel = model("Order", orderSchema);
