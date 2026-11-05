import assert from "node:assert/strict";
import test from "node:test";
import {
  zero3EventBatteryCode,
  zero3EventBatteryDeleteConfirmation,
} from "../../../../lib/api-zod/src/zero3-event-battery.ts";

test("formats battery display codes independently of lane labels", () => {
  assert.equal(zero3EventBatteryCode(1), "P01");
  assert.equal(zero3EventBatteryCode(2), "P02");
  assert.equal(zero3EventBatteryCode(14), "P14");
  assert.equal(zero3EventBatteryCode(100), "P100");
});

test("battery deletion confirmation uses the current P-code and battery name", () => {
  assert.equal(
    zero3EventBatteryDeleteConfirmation(1, "Bateria 1 - Teste"),
    "EXCLUIR BATERIA P01: Bateria 1 - Teste",
  );
  assert.equal(
    zero3EventBatteryDeleteConfirmation(2, "Bateria renomeada"),
    "EXCLUIR BATERIA P02: Bateria renomeada",
  );
  assert.notEqual(
    zero3EventBatteryDeleteConfirmation(1, "Bateria 1 - Teste"),
    "EXCLUIR BATERIA 1: Bateria 1 - Teste",
  );
});
