import { setServers } from "node:dns";

import mongoose from "mongoose";

import { env } from "./env.js";

export async function connectToDatabase(): Promise<void> {
  if (env.mongodbUri === "") {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and provide a MongoDB connection string.",
    );
  }

  if (env.mongodbDnsServers !== "") {
    const servers = env.mongodbDnsServers.split(",").map((s) => s.trim());
    setServers(servers);
    console.log(`[db] using custom DNS servers: ${servers.join(", ")}`);
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(env.mongodbUri, {
    dbName: env.mongodbDatabase,
    serverSelectionTimeoutMS: 10_000,
  });

  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
  });

  console.log(`[db] connected to ${env.mongodbDatabase}`);
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}