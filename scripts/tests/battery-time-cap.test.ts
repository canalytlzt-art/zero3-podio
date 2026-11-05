import assert from "node:assert/strict";
import test from "node:test";
import { computeBatteryCapStop } from "../../artifacts/api-server/src/lib/battery-time-cap.ts";

const startedAt = "2026-11-05T12:00:00.000Z";
const startMs = Date.parse(startedAt);

test("does not freeze before the battery cap", () => {
  assert.equal(computeBatteryCapStop({
    state: "RUNNING", elapsedMs: 5_000, startedAt, timeCapMs: 60_000, nowMs: startMs + 54_999,
  }), null);
});

test("freezes at the exact cap instant, not at the later polling time", () => {
  assert.deepEqual(computeBatteryCapStop({
    state: "RUNNING", elapsedMs: 5_000, startedAt, timeCapMs: 60_000, nowMs: startMs + 90_000,
  }), { elapsedMs: 60_000, stoppedAt: "2026-11-05T12:00:55.000Z" });
});

test("does not apply an elapsed-time cap to preparation or paused timers", () => {
  assert.equal(computeBatteryCapStop({
    state: "PREPARATION", elapsedMs: 0, startedAt, timeCapMs: 60_000, nowMs: startMs + 120_000,
  }), null);
  assert.equal(computeBatteryCapStop({
    state: "PAUSED", elapsedMs: 20_000, startedAt, timeCapMs: 60_000, nowMs: startMs + 120_000,
  }), null);
});

test("does not freeze a running timer when its start timestamp is invalid", () => {
  assert.equal(computeBatteryCapStop({
    state: "RUNNING", elapsedMs: 0, startedAt: "not-a-date", timeCapMs: 60_000, nowMs: startMs + 90_000,
  }), null);
});
