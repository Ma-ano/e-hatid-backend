import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectRoot = path.resolve(backendRoot, "..");

dotenv.config({
  path: [
    path.join(backendRoot, ".env"),
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "atlas-credentials.env"),
  ],
});

function readString(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name} value: ${raw}`);
  }
  return port;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${name} value: ${raw}`);
  }
  return value;
}

export const env = {
  nodeEnv: readString("NODE_ENV", "development"),
  port: readPort("PORT", 3000),
  mongodbUri: readString("MONGODB_URI", ""),
  mongodbDatabase: readString("MONGODB_DATABASE", "rider_app"),
  mongodbDnsServers: readString("MONGODB_DNS_SERVERS", ""),

  // Auth
  jwtSecret: readString("JWT_SECRET", "dev-insecure-secret-change-me"),
  jwtExpiresIn: readString("JWT_EXPIRES_IN", "7d"),
  clientOrigin: readString("CLIENT_ORIGIN", "http://localhost:5173"),
  isProduction: readString("NODE_ENV", "development") === "production",

  // Master admin
  masterAdminEmail: readString("MASTER_ADMIN_EMAIL", "admin@ehatid.com"),

  // Geo service (delivery distance / fee)
  geoServiceUrl: readString("GEO_SERVICE_URL", "http://localhost:8000"),
  geoDistanceTimeoutMs: readNumber("GEO_DISTANCE_TIMEOUT_MS", 3000),

  // SMTP (email OTP). When unset, mailer falls back to console logging.
  smtpHost: readString("SMTP_HOST", ""),
  smtpPort: readNumber("SMTP_PORT", 587),
  smtpUser: readString("SMTP_USER", ""),
  smtpPass: readString("SMTP_PASS", ""),
  smtpFrom: readString("SMTP_FROM", "E-Hatid <no-reply@ehatid.com>"),

  // OTP
  otpTtlSeconds: readNumber("OTP_TTL_SECONDS", 300),
  otpMaxAttempts: readNumber("OTP_MAX_ATTEMPTS", 5),
  otpMaxPerEmailPerWindow: readNumber("OTP_MAX_PER_EMAIL_WINDOW", 5),
  otpRateWindowMs: readNumber("OTP_RATE_WINDOW_MS", 10 * 60 * 1000),

  // Order lifecycle
  orderAutoCancelMinutes: readNumber("ORDER_AUTO_CANCEL_MINUTES", 30),
} as const;