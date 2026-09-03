import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { env } from "./config/env.js";
import { UserModel } from "./models/user.js";
import { OrderModel } from "./models/order.js";
import { verifyToken } from "./services/authService.js";

interface AuthUser {
  sub: string;
  role: string;
  activeRole: string;
  ver?: number;
}

let io: Server;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: env.clientOrigin,
      credentials: true,
    },
  });

  io.use(async (socket: Socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const tokenMatch = cookieHeader.match(/ehatid_token=([^;]+)/);
      if (!tokenMatch) {
        return next(new Error("Authentication required"));
      }
      const token = tokenMatch[1];
      if (!token) {
        return next(new Error("Authentication required"));
      }
      const payload = verifyToken(token) as AuthUser;

      const user = await UserModel.findById(payload.sub).lean();
      if (!user) {
        return next(new Error("User not found"));
      }
      if ((payload.ver ?? 0) !== (user.sessionVersion ?? 0)) {
        return next(new Error("Session expired"));
      }

      socket.data.userId = String(user._id);
      socket.data.roles = user.roles ?? [];
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket: Socket) => {
    // Rider tracking rooms: rider:track / rider:untrack
    socket.on("rider:track", async (riderId: string) => {
      if (!riderId || typeof riderId !== "string") return;
      try {
        const userId = socket.data.userId;
        const roles: string[] = socket.data.roles ?? [];
        const isAdmin = roles.includes("admin");

        // Authorization: user must be the rider, or have an order assigned to this rider, or be admin
        if (!isAdmin) {
          const isRider = roles.includes("rider") && userId === riderId;
          if (!isRider) {
            const hasOrder = await OrderModel.findOne({
              riderId,
              status: "delivering",
              $or: [{ userId }, { vendorId: userId }],
            }).lean();
            if (!hasOrder) return;
          }
        }

        socket.join(`rider_${riderId}`);
      } catch {
        // silently ignore — room not joined
      }
    });

    socket.on("rider:untrack", (riderId: string) => {
      if (!riderId || typeof riderId !== "string") return;
      socket.leave(`rider_${riderId}`);
    });

    // Legacy order rooms (kept for order status events)
    socket.on("order:join", async (orderId: string) => {
      if (!orderId || typeof orderId !== "string") return;
      try {
        const order = await OrderModel.findById(orderId).lean();
        if (!order) return;
        const userId = socket.data.userId;
        const roles: string[] = socket.data.roles ?? [];
        const isAdmin = roles.includes("admin");
        const isParty =
          order.userId === userId ||
          order.vendorId === userId ||
          order.riderId === userId;
        if (!isAdmin && !isParty) return;
        socket.join(`order:${orderId}`);
      } catch {
        // silently ignore — room not joined
      }
    });

    socket.on("order:leave", (orderId: string) => {
      if (!orderId || typeof orderId !== "string") return;
      socket.leave(`order:${orderId}`);
    });

    socket.on("disconnect", () => {
      // rooms are cleaned up automatically
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocket first.");
  }
  return io;
}
