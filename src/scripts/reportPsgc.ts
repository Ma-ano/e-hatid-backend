import mongoose from "mongoose";

import { connectToDatabase } from "../config/db.js";
import { GeographicLocationModel } from "../models/geographicLocation.js";
import { RiderRecruitmentLocationModel } from "../models/riderRecruitmentLocation.js";

const NUEVA_ECIJA = "0304900000";
const NCR = "1300000000";

async function main(): Promise<void> {
  await connectToDatabase();
  const [levelCounts, nuevaEcijaLgus, nuevaEcijaBarangays, ncrLgus, ncrBarangays, recruitmentCounts] = await Promise.all([
    GeographicLocationModel.aggregate<{ _id: string; count: number }>([
      { $match: { islandGroup: "Luzon", isActive: true } },
      { $group: { _id: "$geographicLevel", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    GeographicLocationModel.find({ provincePsgcCode: NUEVA_ECIJA, geographicLevel: { $in: ["city", "municipality"] }, isActive: true }, { _id: 0, psgcCode: 1, displayName: 1, geographicLevel: 1, slug: 1 }).sort({ geographicLevel: 1, displayName: 1 }).lean(),
    GeographicLocationModel.countDocuments({ provincePsgcCode: NUEVA_ECIJA, geographicLevel: "barangay", isActive: true }),
    GeographicLocationModel.find({ regionPsgcCode: NCR, geographicLevel: { $in: ["city", "municipality"] }, isActive: true }, { _id: 0, psgcCode: 1, displayName: 1, geographicLevel: 1, slug: 1 }).sort({ geographicLevel: 1, displayName: 1 }).lean(),
    GeographicLocationModel.countDocuments({ regionPsgcCode: NCR, geographicLevel: "barangay", isActive: true }),
    RiderRecruitmentLocationModel.aggregate<{ _id: { status: string; published: boolean; indexable: boolean }; count: number }>([
      { $group: { _id: { status: "$recruitmentStatus", published: "$isPublished", indexable: "$isIndexable" }, count: { $sum: 1 } } },
    ]),
  ]);
  const counts = Object.fromEntries(levelCounts.map((item) => [item._id, item.count]));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    geographicLocations: { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) },
    nuevaEcija: { barangays: nuevaEcijaBarangays, localGovernmentUnits: nuevaEcijaLgus },
    ncr: { barangays: ncrBarangays, localGovernmentUnits: ncrLgus },
    recruitmentRecords: recruitmentCounts,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
