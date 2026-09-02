import type { Request, Response } from "express";
import { HttpError } from "../middlewares/errorHandler.js";
import { StallModel } from "../models/stall.js";
import { estimateDeliveryFee, SERVICE_FEE } from "../services/deliveryFeeService.js";

interface EstimateResponse {
  estimated: boolean;
  deliveryFee: number;
  serviceFee: number;
  distanceKm: number;
  total: number;
}

export async function estimateDelivery(req: Request, res: Response): Promise<void> {
  const { stallId, lat, lng } = req.query as { stallId?: string; lat?: string; lng?: string };
  const subtotal = Number(req.query.subtotal);

  if (!stallId) throw new HttpError(400, "stallId is required");
  const stall = await StallModel.findById(stallId).lean();
  if (!stall) throw new HttpError(404, "Stall not found");

  const serviceFee = SERVICE_FEE;
  const toNumber = (v: string | undefined): number | null => {
    const n = Number(v);
    return typeof v === "string" && v !== "" && Number.isFinite(n) ? n : null;
  };
  const customerLat = toNumber(lat);
  const customerLng = toNumber(lng);

  const hasCoords =
    customerLat != null &&
    customerLng != null &&
    stall.latitude != null &&
    stall.longitude != null;

  let response: EstimateResponse;
  if (hasCoords) {
    const estimate = await estimateDeliveryFee({
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      pickupLat: stall.latitude as number,
      pickupLng: stall.longitude as number,
      dropLat: customerLat as number,
      dropLng: customerLng as number,
    });
    response = {
      estimated: true,
      deliveryFee: estimate.deliveryFee,
      serviceFee: estimate.serviceFee,
      distanceKm: estimate.distanceKm,
      total: estimate.total,
    };
  } else {
    const flat = Number(stall.deliveryFee ?? 0);
    response = {
      estimated: false,
      deliveryFee: flat,
      serviceFee,
      distanceKm: 0,
      total: Math.round((subtotal + flat + serviceFee) * 100) / 100,
    };
  }

  res.status(200).json({ data: response });
}