import { OrderModel } from "../models/order.js";
import { env } from "../config/env.js";
import { pushNotification } from "./notificationService.js";

/**
 * Auto-cancel orders that have stayed in `pending` beyond the configured TTL.
 * Returns the number of orders cancelled this sweep.
 */
export async function sweepExpiredPendingOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - env.orderAutoCancelMinutes * 60 * 1000);
  const result = await OrderModel.updateMany(
    {
      status: "pending",
      createdAt: { $lt: cutoff },
    },
    {
      status: "cancelled",
      cancelledReason: `Auto-cancelled: not accepted within ${env.orderAutoCancelMinutes} minutes`,
    },
  );

  if (result.modifiedCount > 0) {
    // Notify affected customers.
    const affected = await OrderModel.find({
      status: "cancelled",
      createdAt: { $lt: cutoff },
    } as never)
      .select("userId")
      .lean();
    const userIds = [...new Set((affected as { userId: string }[]).map((o) => o.userId))];
    for (const uid of userIds) {
      await pushNotification(
        { userId: uid },
        `An order was auto-cancelled because the vendor did not accept it in time.`,
        "warning",
      );
    }
  }

  return result.modifiedCount;
}

let _sweepHandle: NodeJS.Timeout | null = null;

/**
 * Start the background sweep. Idempotent. Runs every N ms (default 60s).
 */
export function startOrderLifecycleSweep(intervalMs = 60_000): void {
  if (_sweepHandle) return;
  const run = async (): Promise<void> => {
    try {
      const cancelled = await sweepExpiredPendingOrders();
      if (cancelled > 0) {
        console.log(`[orders] auto-cancel sweep cancelled ${cancelled} pending order(s)`);
      }
    } catch (err) {
      console.error("[orders] auto-cancel sweep error:", err);
    }
  };
  run();
  _sweepHandle = setInterval(run, intervalMs);
}

export function stopOrderLifecycleSweep(): void {
  if (_sweepHandle) {
    clearInterval(_sweepHandle);
    _sweepHandle = null;
  }
}
