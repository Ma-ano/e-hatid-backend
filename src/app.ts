import express from "express";
import cookieParser from "cookie-parser";
// Express 4 does not catch rejected promises from async handlers — a thrown
// HttpError (e.g. failed login) becomes an unhandled rejection that kills the
// whole process (Node >=15 default). Importing this patches every router so
// rejections flow to errorHandler instead; one bad request can never take the
// backend down again.
import "express-async-errors";

import { apiRouter } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { env } from "./config/env.js";
import { rejectUnsafeBody } from "./middlewares/requestValidation.js";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("query parser", "simple");
  if (env.trustProxyHops > 0) {
    app.set("trust proxy", env.trustProxyHops);
  }
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  app.use(rejectUnsafeBody);

  // Allow the Vite dev server (and later the deployed web origin) to send cookies.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", env.clientOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-csrf-token",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
