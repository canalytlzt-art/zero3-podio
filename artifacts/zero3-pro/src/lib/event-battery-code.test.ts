import assert from "node:assert/strict";
import test from "node:test";
import { eventBatteryCode } from "./event-battery-code.ts";

test("formats battery display codes independently of lane labels", () => {
  assert.equal(eventBatteryCode(1), "P01");
  assert.equal(eventBatteryCode(2), "P02");
  assert.equal(eventBatteryCode(14), "P14");
  assert.equal(eventBatteryCode(100), "P100");
});
