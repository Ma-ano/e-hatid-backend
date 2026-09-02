import { ConfigModel } from "../models/config.js";
import { env } from "../config/env.js";

export interface DeliveryEstimate {
  distanceKm: number;
  deliveryFee: number;
  gasCost: number;
  fuelShare: number;
  driverShare: number;
  platformShare: number;
  serviceFee: number;
  total: number;
}

export interface DeliveryFeeInput {
  subtotal: number;
  distanceKm?: number;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropLat?: number | null;
  dropLng?: number | null;
}

export const SERVICE_FEE = 1.49;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function distanceFromGeo(
  pickupLat: number,
  pickupLng: number,
  dropLat: number,
  dropLng: number,
): Promise<number> {
  const url = `${env.geoServiceUrl.replace(/\/$/, "")}/api/v1/distance`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.geoDistanceTimeoutMs);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: { lat: pickupLat, lon: pickupLng },
        destination: { lat: dropLat, lon: dropLng },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      throw new Error(`geo service returned ${resp.status}`);
    }
    const json = (await resp.json()) as { data?: { distance_km?: number } };
    return Number(json.data?.distance_km ?? 0);  } catch (err) {
    console.warn("[fee] geo service unavailable, using haversine fallback:", err);
    return haversineKm(pickupLat, pickupLng, dropLat, dropLng);
  }
}

async function getConfig() {
  const config = await ConfigModel.findOneAndUpdate(
    { key: "delivery" },
    { $setOnInsert: { perKmRate: 30, gasPrice: 60, kmPerLiter: 40, bonus: 0 } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return {
    perKmRate: config.perKmRate,
    gasPrice: config.gasPrice,
    kmPerLiter: config.kmPerLiter,
    bonus: config.bonus,
  };
}

export async function estimateDeliveryFee(input: DeliveryFeeInput): Promise<DeliveryEstimate> {
  let distanceKm = input.distanceKm ?? 0;
  if (
    (distanceKm === 0 || distanceKm === undefined) &&
    input.pickupLat != null &&
    input.pickupLng != null &&
    input.dropLat != null &&
    input.dropLng != null
  ) {
    distanceKm = await distanceFromGeo(input.pickupLat, input.pickupLng, input.dropLat, input.dropLng);
  }

  const cfg = await getConfig();
  const rate = cfg.perKmRate ?? 0;
  const gas = cfg.gasPrice ?? 0;
  const kmPerL = cfg.kmPerLiter || 1;
  const bonus = cfg.bonus ?? 0;

  // system.md §8.4 formula:
  //   final_km = max(1, ceil(distance_km))
  //   fuelAdjustment = (gasPrice / kmPerLiter) * distance_km
  //   fare = final_km * perKmRate + fuelAdjustment + bonus
  const finalKm = Math.max(1, Math.ceil(distanceKm));
  const fuelAdjustment = (gas / kmPerL) * distanceKm;
  const deliveryFee = Math.round(finalKm * rate + fuelAdjustment + bonus);
  const serviceFee = SERVICE_FEE;
  const total = Math.round((input.subtotal + deliveryFee + serviceFee) * 100) / 100;

  // Split (70/30 of the net fare after fuel).
  const driverShare = Math.round((deliveryFee - fuelAdjustment) * 0.7 * 100) / 100;
  const platformShare = Math.round((deliveryFee - fuelAdjustment) * 0.3 * 100) / 100;

  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    deliveryFee,
    gasCost: Math.round(fuelAdjustment * 100) / 100,
    fuelShare: Math.round(fuelAdjustment * 100) / 100,
    driverShare,
    platformShare,
    serviceFee,
    total,
  };
}
