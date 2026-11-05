import assert from "node:assert/strict";
import test from "node:test";
import { projectEventElapsedDelta } from "./battery-time-display.ts";

test("projects the delta of every running battery independently", () => {
  assert.equal(projectEventElapsedDelta([
    { state: "RUNNING", elapsedMs: 10_000, timeCapMs: 60_000 },
    { state: "RUNNING", elapsedMs: 20_000, timeCapMs: 90_000 },
    { state: "PAUSED", elapsedMs: 30_000, timeCapMs: 90_000 },
  ], 5_000), 10_000);
});

test("does not project any time beyond an individual battery cap", () => {
  assert.equal(projectEventElapsedDelta([
    { state: "RUNNING", elapsedMs: 58_000, timeCapMs: 60_000 },
    { state: "RUNNING", elapsedMs: 10_000, timeCapMs: 60_000 },
  ], 5_000), 7_000);
});

test("uses the active timer as a fallback when no battery snapshot list exists", () => {
  assert.equal(projectEventElapsedDelta(undefined, 10_000, {
    state: "RUNNING", elapsedMs: 55_000, timeCapMs: 60_000,
  }), 5_000);
});
