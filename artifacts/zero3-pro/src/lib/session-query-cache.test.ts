import assert from "node:assert/strict";
import test from "node:test";
import { isSessionScopedZero3QueryKey } from "./session-query-cache.ts";

test("selects private ZERO3 queries for session cache cleanup", () => {
  assert.equal(isSessionScopedZero3QueryKey(["/api/zero3/me"]), true);
  assert.equal(
    isSessionScopedZero3QueryKey(["/api/zero3/events", { eventId: "demo" }]),
    true,
  );
});

test("preserves public board and unrelated query caches", () => {
  assert.equal(
    isSessionScopedZero3QueryKey(["/api/zero3/public-board"]),
    false,
  );
  assert.equal(isSessionScopedZero3QueryKey(["/api/healthz"]), false);
  assert.equal(isSessionScopedZero3QueryKey([{ url: "/api/zero3/me" }]), false);
});
