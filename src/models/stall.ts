import { Schema, model, type InferSchemaType } from "mongoose";

const optionChoiceSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
  },
  { _id: false },
);

const menuItemOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    required: { type: Boolean, default: false },
    maxSelections: { type: Number, default: 1 },
    choices: { type: [optionChoiceSchema], default: [] },
  },
  { _id: false },
);

const menuItemAddOnSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
  },
  { _id: false },
);

const menuItemSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true },
    image: { type: String, default: "" },
    category: { type: String, default: "" },
    available: { type: Boolean, default: true },
    popular: { type: Boolean, default: false },
    stallId: { type: String, default: "" },
    options: { type: [menuItemOptionSchema], default: [] },
    addOns: { type: [menuItemAddOnSchema], default: [] },
  },
  { _id: false },
);

const stallSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    logo: { type: String, default: "" },
    rating: { type: Number, default: 0 },
    deliveryTime: { type: String, default: "" },
    deliveryFee: { type: Number, default: 0 },
    minOrder: { type: Number, default: 0 },
    vendorId: { type: String, required: true, index: true },
    category: { type: String, default: "Fast Food" },
    cuisine: { type: String, default: "" },
    accentColor: { type: String, default: "#5B21B6" },
    active: { type: Boolean, default: true },
    address: { type: String, default: "" },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    isNew: { type: Boolean, default: false },
    menu: { type: [menuItemSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export type Stall = InferSchemaType<typeof stallSchema>;
export type MenuItem = InferSchemaType<typeof menuItemSchema>;

export const StallModel = model("Stall", stallSchema);
