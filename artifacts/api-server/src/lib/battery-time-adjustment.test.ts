import assert from "node:assert/strict";
import test from "node:test";
import { computeBatteryTimeAdjustment } from "./battery-time-adjustment";

const startedAt = "2026-11-05T12:00:00.000Z";
const startMs = Date.parse(startedAt);
const stoppedAt = "2026-11-05T12:10:00.000Z";

test("adds requested minutes to a live timer using the server's current elapsed time", () => {
  assert.deepEqual(computeBatteryTimeAdjustment({
    state: "RUNNING", elapsedMs: 0, startedAt, stoppedAt: null,
    timeCapMs: 7_200_000, nowMs: startMs + 600_000, additionalMs: 1_500_000,
  }), {
    state: "RUNNING", elapsedMs: 1_500_000, startedAt, stoppedAt: null,
    previousElapsedMs: 600_000, newElapsedMs: 2_100_000, reachedCap: false,
  });
});

test("adds time while paused and remains paused", () => {
  assert.deepEqual(computeBatteryTimeAdjustment({
    state: "PAUSED", elapsedMs: 600_000, startedAt: null, stoppedAt,
    timeCapMs: 7_200_000, nowMs: startMs + 900_000, additionalMs: 1_500_000,
  }), {
    state: "PAUSED", elapsedMs: 2_100_000, startedAt: null, stoppedAt,
    previousElapsedMs: 600_000, newElapsedMs: 2_100_000, reachedCap: false,
  });
});

test("adds time to a finished duration above CAP without restarting", () => {
  assert.deepEqual(computeBatteryTimeAdjustment({
    state: "FINISHED", elapsedMs: 7_200_000, startedAt: null, stoppedAt,
    timeCapMs: 7_200_000, nowMs: startMs + 900_000, additionalMs: 1_500_000,
  }), {
    state: "FINISHED", elapsedMs: 8_700_000, startedAt: null, stoppedAt,
    previousElapsedMs: 7_200_000, newElapsedMs: 8_700_000, reachedCap: false,
  });
});

test("a live addition reaching CAP stops only that battery at the exact CAP", () => {
  assert.deepEqual(computeBatteryTimeAdjustment({
    state: "RUNNING", elapsedMs: 0, startedAt, stoppedAt: null,
    timeCapMs: 7_200_000, nowMs: startMs + 6_000_000, additionalMs: 1_500_000,
  }), {
    state: "FINISHED", elapsedMs: 7_200_000, startedAt: null,
    stoppedAt: "2026-11-05T13:40:00.000Z",
    previousElapsedMs: 6_000_000, newElapsedMs: 7_200_000, reachedCap: true,
  });
});

test("uses a battery's configured CAP rather than a fixed event-wide duration", () => {
  assert.deepEqual(computeBatteryTimeAdjustment({
    state: "RUNNING", elapsedMs: 0, startedAt, stoppedAt: null,
    timeCapMs: 1_800_000, nowMs: startMs + 1_200_000, additionalMs: 900_000,
  }), {
    state: "FINISHED", elapsedMs: 1_800_000, startedAt: null,
    stoppedAt: "2026-11-05T12:20:00.000Z",
    previousElapsedMs: 1_200_000, newElapsedMs: 1_800_000, reachedCap: true,
  });
});

test("a battery already at CAP is frozen there and is not resumed", () => {
  assert.deepEqual(computeBatteryTimeAdjustment({
    state: "RUNNING", elapsedMs: 0, startedAt, stoppedAt: null,
    timeCapMs: 7_200_000, nowMs: startMs + 7_200_000, additionalMs: 1_500_000,
  }), {
    state: "FINISHED", elapsedMs: 7_200_000, startedAt: null,
    stoppedAt: "2026-11-05T14:00:00.000Z",
    previousElapsedMs: 7_200_000, newElapsedMs: 7_200_000, reachedCap: true,
  });
});

test("rejects pre-start, cancelled, malformed, zero and unsafe adjustments", () => {
  const base = {
    state: "IDLE", elapsedMs: 0, startedAt: null, stoppedAt: null,
    timeCapMs: 7_200_000, nowMs: startMs, additionalMs: 1_000,
  };
  assert.equal(computeBatteryTimeAdjustment(base), null);
  assert.equal(computeBatteryTimeAdjustment({ ...base, state: "CANCELLED" }), null);
  assert.equal(computeBatteryTimeAdjustment({ ...base, state: "PAUSED", additionalMs: 0 }), null);
  assert.equal(computeBatteryTimeAdjustment({
    ...base, state: "PAUSED", elapsedMs: Number.MAX_SAFE_INTEGER, additionalMs: 1000,
  }), null);
});
