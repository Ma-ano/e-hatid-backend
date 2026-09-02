import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/db.js";
import { startOrderLifecycleSweep, stopOrderLifecycleSweep } from "./services/orderLifecycleService.js";
import { initSocket } from "./socket.js";

async function start(): Promise<void> {
  const app = createApp();

  await connectToDatabase();
  startOrderLifecycleSweep();

  const server = app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  initSocket(server);
  console.log(`[socket] initialized`);

  function shutdown(signal: string): void {
    console.log(`[server] received ${signal}, shutting down`);
    stopOrderLifecycleSweep();
    server.close(async () => {
      await disconnectFromDatabase();
      console.log("[server] closed");
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});