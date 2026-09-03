import { OrderModel } from "../models/order.js";
import { env } from "../config/env.js";
import { pushNotification } from "./notificationService.js";

/**
 * Auto-cancel orders that have stayed in `pending` beyond the configured TTL.
 * Returns the number of orders cancelled this sweep.
 */
export async function sweepExpiredPendingOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - env.orderAutoCancelMinutes * 60 * 1000);
  let cancelled = 0;

  // Claim one pending order at a time with a conditional update. This makes
  // multiple app instances safe and gives us the exact records to notify.
  while (cancelled < 500) {
    const order = await OrderModel.findOneAndUpdate(
      { status: "pending", createdAt: { $lt: cutoff } },
      {
        $set: {
          status: "cancelled",
          cancelledReason: `Auto-cancelled: not accepted within ${env.orderAutoCancelMinutes} minutes`,
        },
      },
      { new: true, sort: { createdAt: 1 } },
    )
      .select("_id userId")
      .lean();
    if (!order) break;

    cancelled += 1;
    try {
      await pushNotification(
        { userId: order.userId },
        "Your order was auto-cancelled because the vendor did not accept it in time.",
        "warning",
        String(order._id),
      );
    } catch (err) {
      console.warn("[orders] auto-cancel notification failed:", err);
    }
  }

  return cancelled;
}

let _sweepHandle: NodeJS.Timeout | null = null;
let _sweepRunning = false;

/**
 * Start the background sweep. Idempotent. Runs every N ms (default 60s).
 */
export function startOrderLifecycleSweep(intervalMs = 60_000): void {
  if (_sweepHandle) return;
  const run = async (): Promise<void> => {
    if (_sweepRunning) return;
    _sweepRunning = true;
    try {
      const cancelled = await sweepExpiredPendingOrders();
      if (cancelled > 0) {
        console.log(`[orders] auto-cancel sweep cancelled ${cancelled} pending order(s)`);
      }
    } catch (err) {
      console.error("[orders] auto-cancel sweep error:", err);
    } finally {
      _sweepRunning = false;
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
