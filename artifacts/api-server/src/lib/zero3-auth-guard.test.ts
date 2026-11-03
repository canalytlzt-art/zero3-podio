import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { requireZero3Roles } from "./zero3-auth";
import { state } from "./test-support/auth-dependencies";

test("real role guard distinguishes authorized, absent, insufficient, inactive and unavailable states with mocked dependencies", async (context) => {
  context.mock.method(console, "error", () => {});
  const run = () => new Promise<{ status: number; code?: string }>((resolve) => {
    let status = 200;
    const req = { headers: {}, originalUrl: "/api/zero3/events" } as Request;
    const res = {
      status(value: number) { status = value; return this; },
      json(body: { code: string }) { resolve({ status, code: body.code }); },
    } as unknown as Response;
    requireZero3Roles(["ADMIN"])(req, res, () => resolve({ status: 200 }));
  });
  assert.equal((await run()).status, 200);
  state.auth.isAuthenticated = false;
  assert.deepEqual(await run(), { status: 401, code: "SESSION_INVALID" });
  state.auth.isAuthenticated = true;
  state.member!.role = "JUIZ";
  assert.deepEqual(await run(), { status: 403, code: "ZERO3_ROLE_INSUFFICIENT" });
  state.member!.active = false;
  assert.deepEqual(await run(), { status: 403, code: "ZERO3_ROLE_INACTIVE" });
  state.providerError = new Error("provider unavailable");
  assert.deepEqual(await run(), { status: 503, code: "AUTH_PROVIDER_UNAVAILABLE" });
  state.providerError = undefined;
  state.databaseError = Object.assign(new Error("DB unavailable"), { code: "ECONNREFUSED" });
  assert.deepEqual(await run(), { status: 503, code: "DATABASE_UNAVAILABLE" });
  state.databaseError = new Error("unexpected failure");
  assert.deepEqual(await run(), { status: 500, code: "API_INTERNAL_ERROR" });
});
