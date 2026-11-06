import assert from "node:assert/strict";
import test from "node:test";
import { batteryEventDurationMs } from "./battery-event-duration";

test("uses elapsed wall clock from the earliest battery start, not concurrent totals", () => {
  const now = Date.parse("2026-11-06T12:10:00.000Z");
  assert.equal(batteryEventDurationMs([
    "2026-11-06T12:00:00.000Z",
    "2026-11-06T12:07:37.000Z",
  ], now), 10 * 60_000);
});

test("keeps the event timeline while battery clocks are paused or finished", () => {
  assert.equal(batteryEventDurationMs([
    null,
    "2026-11-06T12:00:00.000Z",
  ], Date.parse("2026-11-06T12:05:00.000Z")), 5 * 60_000);
});

test("returns zero before any battery has started", () => {
  assert.equal(batteryEventDurationMs([null, undefined], Date.now()), 0);
});
