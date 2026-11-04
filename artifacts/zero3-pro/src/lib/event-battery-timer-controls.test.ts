import assert from "node:assert/strict";
import test from "node:test";
import { eventBatteryTimerControl } from "./event-battery-timer-controls.ts";

test("starts an idle battery through its preparation countdown", () => {
  assert.deepEqual(eventBatteryTimerControl("IDLE"), {
    action: "prepare",
    label: "Iniciar cronômetro",
  });
});

test("cancels only a pending battery start", () => {
  assert.deepEqual(eventBatteryTimerControl("PREPARATION"), {
    action: "reset",
    label: "Cancelar largada",
  });
});

test("stops a running battery without finalizing it", () => {
  assert.deepEqual(eventBatteryTimerControl("RUNNING"), {
    action: "finish",
    label: "Parar cronômetro",
  });
});

test("allows a paused timer to resume and leaves a finished time frozen", () => {
  assert.deepEqual(eventBatteryTimerControl("PAUSED"), {
    action: "resume",
    label: "Retomar cronômetro",
  });
  assert.equal(eventBatteryTimerControl("FINISHED"), null);
  assert.equal(eventBatteryTimerControl("UNKNOWN"), null);
});
