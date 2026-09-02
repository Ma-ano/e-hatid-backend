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
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    image: { type: String, default: "" },
    selectedOptions: { type: [String], default: [] },
    selectedAddOns: { type: [String], default: [] },
    specialInstructions: { type: String, default: "" },
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

    subtotal: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    serviceFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    promoCode: { type: String, default: "" },
    total: { type: Number, required: true },

    distance: { type: Number, default: 0 },
    deliveryAddress: { type: String, default: "" },
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
    deliveryInstructions: { type: String, default: "" },

    customerLatitude: { type: Number, default: null },
    customerLongitude: { type: Number, default: null },
    stallLatitude: { type: Number, default: null },
    stallLongitude: { type: Number, default: null },

    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },

    riderId: { type: String, default: null, index: true },
    riderName: { type: String, default: "" },
    riderPhone: { type: String, default: "" },
    riderPlate: { type: String, default: "" },
    riderAvatar: { type: String, default: "" },

    cancelledReason: { type: String, default: "" },
    completedAt: { type: Date, default: null },

    notes: { type: String, default: "" },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cod" },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "unpaid" },
    paidAt: { type: Date, default: null },

    estimatedDeliveryTime: { type: String, default: "" },
    acceptedAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },

    // Idempotency: POST /orders can be retried safely with the same key.
    idempotencyKey: { type: String, default: "", index: true },
  },
  { timestamps: true, versionKey: false },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ vendorId: 1, createdAt: -1 });
orderSchema.index({ riderId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string", $ne: "" } } });

export type Order = InferSchemaType<typeof orderSchema>;
export type OrderItem = InferSchemaType<typeof orderItemSchema>;

export const OrderModel = model("Order", orderSchema);
