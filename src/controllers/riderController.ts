import type { Request, Response } from "express";
import { isValidObjectId } from "mongoose";

import { HttpError } from "../middlewares/errorHandler.js";
import { RiderModel } from "../models/rider.js";

export async function listRiders(_req: Request, res: Response): Promise<void> {
  const riders = await RiderModel.find().sort({ createdAt: -1 }).lean();
  res.status(200).json({ data: riders });
}

export async function getRider(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new HttpError(400, "Invalid rider id");
  }

  const rider = await RiderModel.findById(id).lean();
  if (rider === null) {
    throw new HttpError(404, "Rider not found");
  }

  res.status(200).json({ data: rider });
}

export async function createRider(req: Request, res: Response): Promise<void> {
  const { name, email, phone, active } = req.body as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    active?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    throw new HttpError(400, "name is required and must be a non-empty string");
  }
  if (typeof email !== "string" || email.trim() === "") {
    throw new HttpError(400, "email is required and must be a non-empty string");
  }

  const rider = await RiderModel.create({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: typeof phone === "string" ? phone.trim() : "",
    active: typeof active === "boolean" ? active : true,
  });

  res.status(201).json({ data: rider });
}

export async function updateRider(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new HttpError(400, "Invalid rider id");
  }

  const { name, email, phone, active } = req.body as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    active?: unknown;
  };

  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    throw new HttpError(400, "name must be a non-empty string");
  }
  if (email !== undefined && (typeof email !== "string" || email.trim() === "")) {
    throw new HttpError(400, "email must be a non-empty string");
  }

  const update: {
    name?: string;
    email?: string;
    phone?: string;
    active?: boolean;
  } = {};
  if (name !== undefined) update.name = name.trim();
  if (email !== undefined) update.email = email.trim().toLowerCase();
  if (phone !== undefined) {
    if (typeof phone !== "string") {
      throw new HttpError(400, "phone must be a string");
    }
    update.phone = phone.trim();
  }
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      throw new HttpError(400, "active must be a boolean");
    }
    update.active = active;
  }

  const rider = await RiderModel.findByIdAndUpdate(id, update, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (rider === null) {
    throw new HttpError(404, "Rider not found");
  }

  res.status(200).json({ data: rider });
}

export async function deleteRider(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw new HttpError(400, "Invalid rider id");
  }

  const rider = await RiderModel.findByIdAndDelete(id);
  if (rider === null) {
    throw new HttpError(404, "Rider not found");
  }

  res.status(204).send();
}