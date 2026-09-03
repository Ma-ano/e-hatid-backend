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

function readNonNegativeInteger(name: string, fallback: number): number {
  const value = readNumber(name, fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} value: expected a non-negative integer`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid ${name} value: expected true or false`);
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
  publicSiteUrl: readString("PUBLIC_SITE_URL", readString("CLIENT_ORIGIN", "http://localhost:5173")).replace(/\/$/, ""),
  isProduction: readString("NODE_ENV", "development") === "production",
  trustProxyHops: readNonNegativeInteger("TRUST_PROXY_HOPS", 0),

  // Master admin
  masterAdminEmail: readString("MASTER_ADMIN_EMAIL", "admin@ehatid.com"),

  // Geo service (delivery distance / fee)
  geoServiceUrl: readString("GEO_SERVICE_URL", "http://localhost:8000"),
  geoDistanceTimeoutMs: readNumber("GEO_DISTANCE_TIMEOUT_MS", 3000),
  googleGeocodingApiKey: readString("GOOGLE_GEOCODING_API_KEY", ""),
  geocodingTimeoutMs: readNumber("GEOCODING_TIMEOUT_MS", 5000),

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
  allowInsecureDemoOtp: readBoolean("ALLOW_INSECURE_DEMO_OTP", false),

  // Order lifecycle
  orderAutoCancelMinutes: readNumber("ORDER_AUTO_CANCEL_MINUTES", 30),
} as const;

if (env.isProduction) {
  if (env.mongodbUri === "") {
    throw new Error("Missing required production environment variable: MONGODB_URI");
  }
  if (env.jwtSecret === "dev-insecure-secret-change-me" || env.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be a unique production secret of at least 32 characters");
  }
  let origin: URL;
  try {
    origin = new URL(env.clientOrigin);
  } catch {
    throw new Error("CLIENT_ORIGIN must be a valid absolute URL in production");
  }
  if (origin.protocol !== "https:") {
    throw new Error("CLIENT_ORIGIN must use HTTPS in production");
  }
  let publicSiteUrl: URL;
  try {
    publicSiteUrl = new URL(env.publicSiteUrl);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be a valid absolute URL in production");
  }
  if (publicSiteUrl.protocol !== "https:") {
    throw new Error("PUBLIC_SITE_URL must use HTTPS in production");
  }
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !env.smtpFrom) {
    throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM are required in production");
  }
}

if (env.otpTtlSeconds <= 0 || env.otpMaxAttempts <= 0 || env.otpRateWindowMs <= 0) {
  throw new Error("OTP timing and attempt limits must be positive");
}
if (env.orderAutoCancelMinutes <= 0 || env.geoDistanceTimeoutMs <= 0 || env.geocodingTimeoutMs <= 0) {
  throw new Error("Order and geo timeouts must be positive");
}
