import { Router } from "express";
import type { Request, Response } from "express";
import { rateLimit } from "../middlewares/rateLimit.js";

export const geocodingRouter = Router();

const GOOGLE_GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Per-client limits on the geocoding proxy. Google allows higher throughput
 * but we keep conservative limits to control costs. Limits are generous for
 * real users (debounced searches make >20 lookups/min unlikely) but stop
 * hammering.
 */
const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: "Address search is temporarily busy. Please wait a moment or enter your address manually.",
});
const reverseLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  message: "Location lookup is temporarily busy. Please enter your address manually.",
});

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;

function cacheGet(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

/** Collapse whitespace/case so near-identical queries share one cache entry. */
function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Round coordinates to ~3 decimal places (~110m) so nearby pins share cache entries. */
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function getApiKey(): string {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_GEOCODING_API_KEY is not configured");
  }
  return key;
}

/**
 * Transform Google Geocoding response into the format expected by the frontend.
 * Frontend expects: { display_name, lat, lon, address? }
 */
interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeometryLocation {
  lat: number;
  lng: number;
}

interface GoogleResult {
  formatted_address: string;
  geometry: { location: GoogleGeometryLocation };
  place_id: string;
  address_components: GoogleAddressComponent[];
  types: string[];
}

interface GoogleGeocodeResponse {
  status: string;
  results: GoogleResult[];
}

function googleToNominatimFormat(googleResult: GoogleResult) {
  const components: Record<string, string> = {};
  for (const comp of googleResult.address_components) {
    // Map Google component types to Nominatim-style keys
    const type = comp.types[0];
    if (type === "street_number") components["house_number"] = comp.long_name;
    else if (type === "route") components["road"] = comp.long_name;
    else if (type === "sublocality" || type === "sublocality_level_1") components["neighbourhood"] = comp.long_name;
    else if (type === "locality") components["city"] = comp.long_name;
    else if (type === "administrative_area_level_2") components["county"] = comp.long_name;
    else if (type === "administrative_area_level_1") components["state"] = comp.long_name;
    else if (type === "country") components["country"] = comp.long_name;
    else if (type === "postal_code") components["postcode"] = comp.long_name;
  }

  return {
    display_name: googleResult.formatted_address,
    lat: String(googleResult.geometry.location.lat),
    lon: String(googleResult.geometry.location.lng),
    place_id: googleResult.place_id,
    address: components,
  };
}

geocodingRouter.get("/search", searchLimiter, async (req: Request, res: Response) => {
  try {
    const qRaw = String(req.query.q || "");
    const q = normalizeQuery(qRaw);
    if (q.length < 2) {
      res.json([]);
      return;
    }

    const cached = cacheGet(`search:${q}`);
    if (cached) {
      res.json(cached);
      return;
    }

    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch {
      res.status(500).json({ error: { message: "Geocoding service is not configured." } });
      return;
    }

    const params = new URLSearchParams({
      address: q,
      key: apiKey,
      region: "ph",
      components: "country:PH",
    });

    const upstream = await fetch(`${GOOGLE_GEOCODE_BASE}?${params}`);
    if (!upstream.ok) {
      console.warn(`Geocoding upstream ${upstream.status} for search`);
      res.status(502).json({ error: { message: "Address search failed. Please try again." } });
      return;
    }

    const data = (await upstream.json()) as GoogleGeocodeResponse;

    if (data.status === "OVER_QUERY_LIMIT") {
      res.setHeader("Retry-After", "2");
      res.status(429).json({
        error: { message: "Address search is temporarily busy. Please try again shortly." },
      });
      return;
    }

    if (data.status !== "OK" || !data.results) {
      res.json([]);
      return;
    }

    // Transform Google results to Nominatim-compatible format
    const results = data.results.slice(0, 5).map(googleToNominatimFormat);
    cacheSet(`search:${q}`, results);
    res.json(results);
  } catch (err) {
    console.error("Geocoding search error:", err);
    res.status(502).json({ error: { message: "Address search failed. Please try again." } });
  }
});

geocodingRouter.get("/reverse", reverseLimiter, async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lon ?? req.query.lng);
    // Validate ranges up front — malformed input never reaches the provider.
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: { message: "Invalid coordinates" } });
      return;
    }

    const key = `rev:${coordKey(lat, lng)}`;
    const cached = cacheGet(key);
    if (cached) {
      res.json(cached);
      return;
    }

    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch {
      res.status(500).json({ error: { message: "Geocoding service is not configured." } });
      return;
    }

    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: apiKey,
    });

    const upstream = await fetch(`${GOOGLE_GEOCODE_BASE}?${params}`);
    if (!upstream.ok) {
      console.warn(`Geocoding upstream ${upstream.status} for reverse`);
      res.status(502).json({ error: { message: "Location lookup failed. Please try again." } });
      return;
    }

    const data = (await upstream.json()) as GoogleGeocodeResponse;

    if (data.status === "OVER_QUERY_LIMIT") {
      res.setHeader("Retry-After", "2");
      res.status(429).json({
        error: { message: "Location lookup is temporarily busy. Please try again shortly." },
      });
      return;
    }

    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      res.json({ display_name: null });
      return;
    }

    // Return the first (most specific) result in Nominatim-compatible format
    const firstResult = data.results[0];
    if (!firstResult) {
      res.json({ display_name: null });
      return;
    }
    const result = googleToNominatimFormat(firstResult);
    cacheSet(key, result);
    res.json(result);
  } catch (err) {
    console.error("Geocoding reverse error:", err);
    res.status(502).json({ error: { message: "Location lookup failed. Please try again." } });
  }
});
