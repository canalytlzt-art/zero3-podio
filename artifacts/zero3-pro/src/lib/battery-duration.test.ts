import assert from "node:assert/strict";
import test from "node:test";
import { formatBatteryDuration, parseBatteryDuration } from "./battery-duration.ts";

test("parses and formats the timer display precision", () => {
  assert.equal(parseBatteryDuration("01:23.45"), 83_450);
  assert.equal(parseBatteryDuration("12:34.5"), 754_500);
  assert.equal(formatBatteryDuration(7_522_350), "125:22.35");
});

test("allows a legitimate duration above the per-battery CAP", () => {
  assert.equal(parseBatteryDuration("125:22.35"), 7_522_350);
});

test("rejects malformed, negative, unsafe and out-of-range seconds", () => {
  for (const value of ["-01:00.00", "1:60.00", "00:12.123", "x", "99999999999999999999:00.00"]) {
    assert.equal(parseBatteryDuration(value), null, value);
  }
});
