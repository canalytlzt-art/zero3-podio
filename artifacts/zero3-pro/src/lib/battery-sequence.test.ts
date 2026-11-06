import assert from "node:assert/strict";
import test from "node:test";
import { nextAvailableBatteryOrder } from "./battery-sequence.ts";

test("suggests the next sequence position without renumbering existing batteries", () => {
  assert.equal(nextAvailableBatteryOrder([]), 1);
  assert.equal(nextAvailableBatteryOrder([1, 2]), 3);
  assert.equal(nextAvailableBatteryOrder([1, 3]), 2);
  assert.equal(nextAvailableBatteryOrder([3, 1, 2]), 4);
});
