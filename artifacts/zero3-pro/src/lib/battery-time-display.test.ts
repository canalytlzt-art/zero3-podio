import assert from "node:assert/strict";
import test from "node:test";
import { projectEventElapsedDelta } from "./battery-time-display.ts";

test("projects event wall-clock once when multiple battery timers run concurrently", () => {
  assert.equal(projectEventElapsedDelta([
    { state: "RUNNING", elapsedMs: 10_000, firstStartedAt: "2026-11-06T12:00:00.000Z" },
    { state: "RUNNING", elapsedMs: 20_000, firstStartedAt: "2026-11-06T12:02:23.000Z" },
  ], 5_000), 5_000);
});

test("event wall-clock continues while started battery timers are paused", () => {
  assert.equal(projectEventElapsedDelta([
    { state: "PAUSED", elapsedMs: 58_000, firstStartedAt: "2026-11-06T12:00:00.000Z" },
    { state: "FINISHED", elapsedMs: 60_000, firstStartedAt: "2026-11-06T12:00:03.000Z" },
  ], 5_000), 5_000);
});

test("does not show event duration until any battery has started", () => {
  assert.equal(projectEventElapsedDelta(undefined, 10_000, {
    state: "RUNNING", elapsedMs: 55_000, firstStartedAt: null,
  }), 0);
  assert.equal(projectEventElapsedDelta(undefined, 10_000, {
    state: "RUNNING", elapsedMs: 55_000, firstStartedAt: "2026-11-06T12:00:00.000Z",
  }), 10_000);
});
