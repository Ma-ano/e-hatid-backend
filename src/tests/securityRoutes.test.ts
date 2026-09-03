import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

import { createApp } from "../app.js";
import { AUTH_COOKIE, signToken } from "../services/authService.js";
import { UserModel, type Role } from "../models/user.js";
import { estimateDeliveryWindow } from "../services/deliveryFeeService.js";
import { validateAndComposeStallAddress } from "../controllers/stallController.js";

let server: Server;
let baseUrl = "";

before(async () => {
  const app = createApp();
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("delivery ETA combines vendor preparation with route-based rider travel", () => {
  const estimate = estimateDeliveryWindow(5, { prepTimeMin: 15, prepTimeMax: 25 });
  assert.deepEqual(estimate, {
    preparationTimeMin: 15,
    preparationTimeMax: 25,
    travelTimeMin: 17,
    travelTimeMax: 30,
    totalTimeMin: 32,
    totalTimeMax: 55,
    estimatedDeliveryTime: "32-55 min",
  });
});

test("delivery ETA supports legacy stall preparation strings", () => {
  const estimate = estimateDeliveryWindow(0, { deliveryTime: "20 - 30" });
  assert.equal(estimate.preparationTimeMin, 20);
  assert.equal(estimate.preparationTimeMax, 30);
  assert.equal(estimate.estimatedDeliveryTime, "30-50 min");
});

test("structured building stall addresses compose in rider-friendly order", () => {
  const address = validateAndComposeStallAddress({
    addressType: "building",
    addressUnit: "3rd Floor, Stall 18",
    addressBuilding: "Kultura Mall",
    addressBlockLot: "",
    addressStreet: "Katipunan Avenue",
    addressBarangay: "Barangay Loyola Heights",
    addressCity: "Quezon City",
    addressProvince: "Metro Manila",
    addressPostalCode: "1108",
    addressLandmark: "Near the north entrance",
  });
  assert.equal(address, "3rd Floor, Stall 18, Kultura Mall, Katipunan Avenue, Barangay Loyola Heights, Quezon City, Metro Manila, 1108");
});

test("structured standalone stall addresses require a block, lot, house, or store number", () => {
  assert.throws(() => validateAndComposeStallAddress({
    addressType: "standalone",
    addressUnit: "",
    addressBuilding: "",
    addressBlockLot: "",
    addressStreet: "Rizal Street",
    addressBarangay: "Barangay San Jose",
    addressCity: "Quezon City",
    addressProvince: "Metro Manila",
    addressPostalCode: "1100",
    addressLandmark: "",
  }), /Block, lot, house, or store number is required/);
});

test("health remains public", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json() as { status?: string };
  assert.equal(body.status, "ok");
});

test("rider records and mutations require admin authentication", async () => {
  const listResponse = await fetch(`${baseUrl}/api/riders`);
  assert.equal(listResponse.status, 401);

  const createResponse = await fetch(`${baseUrl}/api/riders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Unauthorized", email: "unauthorized@example.com" }),
  });
  assert.equal(createResponse.status, 401);
  const body = await createResponse.json() as {
    success?: boolean;
    error?: { message?: string };
  };
  assert.equal(body.success, false);
  assert.equal(body.error?.message, "Authentication required");
});

test("Mongo operator keys are rejected before controllers", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Test",
      email: "test@example.com",
      password: "password123",
      profile: { $where: "unsafe" },
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error?: { message?: string } };
  assert.equal(body.error?.message, "Request body contains unsupported field names");
});

test("fresh database roles enforce customer/rider/vendor RBAC and session revocation", async () => {
  const model = UserModel as unknown as {
    findById: (id: string) => { lean: () => Promise<Record<string, unknown>> };
  };
  const originalFindById = model.findById;
  let roles: Role[] = ["customer"];
  let sessionVersion = 0;
  model.findById = (id: string) => ({
    lean: async () => ({
      _id: id,
      name: "Test User",
      email: "test@example.com",
      roles,
      activeRole: roles.at(-1) ?? "customer",
      sessionVersion,
    }),
  });

  const cookieFor = (activeRole: Role, ver = 0) => {
    const token = signToken({ sub: "507f1f77bcf86cd799439011", role: activeRole, activeRole, ver });
    return `${AUTH_COOKIE}=${token}`;
  };

  try {
    const customerToAdmin = await fetch(`${baseUrl}/api/users`, {
      headers: { cookie: cookieFor("customer") },
    });
    assert.equal(customerToAdmin.status, 403);

    roles = ["customer", "rider"];
    const riderToVendor = await fetch(`${baseUrl}/api/stalls/507f1f77bcf86cd799439012`, {
      method: "PUT",
      headers: { cookie: cookieFor("rider"), "content-type": "application/json" },
      body: JSON.stringify({ name: "Not allowed" }),
    });
    assert.equal(riderToVendor.status, 403);

    roles = ["customer", "vendor"];
    const vendorToAdmin = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { cookie: cookieFor("vendor") },
    });
    assert.equal(vendorToAdmin.status, 403);

    sessionVersion = 1;
    const revokedSession = await fetch(`${baseUrl}/api/users/me`, {
      headers: { cookie: cookieFor("customer", 0) },
    });
    assert.equal(revokedSession.status, 401);

    const revokedSessionBootstrap = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: cookieFor("customer", 0) },
    });
    assert.equal(revokedSessionBootstrap.status, 200);
    const revokedBody = await revokedSessionBootstrap.json() as { data?: unknown };
    assert.equal(revokedBody.data, null);
  } finally {
    model.findById = originalFindById;
  }
});
