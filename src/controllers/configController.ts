import type { Request, Response } from "express";
import { ConfigModel } from "../models/config.js";

const DELIVERY_KEY = "delivery";
const DEFAULTS = { perKmRate: 30, gasPrice: 60, kmPerLiter: 40, bonus: 0 };

export async function getDeliveryConfig(_req: Request, res: Response): Promise<void> {
  const config = await ConfigModel.findOneAndUpdate(
    { key: DELIVERY_KEY },
    { $setOnInsert: DEFAULTS },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  ).lean();
  res.status(200).json({
    data: {
      perKmRate: config.perKmRate,
      gasPrice: config.gasPrice,
      kmPerLiter: config.kmPerLiter,
      bonus: config.bonus,
    },
  });
}

export async function updateDeliveryConfig(req: Request, res: Response): Promise<void> {
  const { perKmRate, gasPrice, kmPerLiter, bonus } = req.body as Record<string, unknown>;
  const update: Record<string, number> = {};
  for (const [key, value] of Object.entries({ perKmRate, gasPrice, kmPerLiter, bonus })) {
    if (typeof value === "number" && Number.isFinite(value)) {
      update[key] = value;
    }
  }
  const config = await ConfigModel.findOneAndUpdate(
    { key: DELIVERY_KEY },
    { $set: update },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  ).lean();
  res.status(200).json({
    data: {
      perKmRate: config.perKmRate,
      gasPrice: config.gasPrice,
      kmPerLiter: config.kmPerLiter,
      bonus: config.bonus,
    },
  });
}

