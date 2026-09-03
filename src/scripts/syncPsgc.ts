import path from "node:path";
import { fileURLToPath } from "node:url";

import mongoose from "mongoose";

import { connectToDatabase } from "../config/db.js";
import { importPsgc } from "../services/psgcImportService.js";
import { seedPriorityRecruitmentPages } from "../services/recruitmentSeedService.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const sourceArg = args.find((arg) => arg.startsWith("--source="));
const sourceFile = sourceArg
  ? path.resolve(sourceArg.slice("--source=".length))
  : path.join(backendRoot, "data", "psgc", "psgc-luzon-2026-06-30.csv");
const dryRun = args.includes("--dry-run");
const skipRecruitment = args.includes("--skip-recruitment");

async function main(): Promise<void> {
  if (!dryRun) await connectToDatabase();
  const result = await importPsgc({ sourceFile, dryRun });
  let recruitment: { createdOrPreserved: number } | undefined;
  if (!dryRun && !skipRecruitment) recruitment = await seedPriorityRecruitmentPages();
  console.log(JSON.stringify({ sourceFile, dryRun, ...result, recruitment }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
