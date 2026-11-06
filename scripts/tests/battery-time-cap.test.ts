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

test("one of four simultaneous batteries reaches only its own CAP", () => {
  const caps = [600_000, 720_000, 480_000, 900_000];
  const transitions = caps.map((timeCapMs) => computeBatteryCapStop({
    state: "RUNNING",
    elapsedMs: 0,
    startedAt,
    timeCapMs,
    nowMs: startMs + 500_000,
  }));
  assert.deepEqual(transitions.map(Boolean), [false, false, true, false]);
  assert.deepEqual(transitions[2], {
    elapsedMs: 480_000,
    stoppedAt: "2026-11-05T12:08:00.000Z",
  });
});

test("P01 freezes at its CAP while a later-started P02 keeps counting", () => {
  const nowMs = startMs + 90_000;
  const p01 = computeBatteryCapStop({
    state: "RUNNING", elapsedMs: 0, startedAt, timeCapMs: 60_000, nowMs,
  });
  const p02 = computeBatteryCapStop({
    state: "RUNNING",
    elapsedMs: 0,
    startedAt: new Date(startMs + 80_000).toISOString(),
    timeCapMs: 60_000,
    nowMs,
  });
  assert.deepEqual(p01, {
    elapsedMs: 60_000,
    stoppedAt: "2026-11-05T12:01:00.000Z",
  });
  assert.equal(p02, null);
});
