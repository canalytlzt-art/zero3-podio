import assert from "node:assert/strict";
import test from "node:test";
import {
  eventBatteryTimerActions,
  eventBatteryTimerControl,
  eventBatteryTimerStatusAction,
  eventBatteryTimerStatusChoices,
} from "./event-battery-timer-controls.ts";

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

test("exposes pause and stop as separate commands while running", () => {
  assert.deepEqual(eventBatteryTimerActions("RUNNING"), [
    { action: "pause", label: "Pausar" },
    { action: "finish", label: "Parar" },
    { action: "cancel", label: "Cancelar bateria" },
  ]);
});

test("exposes resume and stop separately after a pause", () => {
  assert.deepEqual(eventBatteryTimerActions("PAUSED"), [
    { action: "resume", label: "Retomar" },
    { action: "finish", label: "Parar" },
    { action: "reset", label: "Voltar para Não iniciada" },
    { action: "cancel", label: "Cancelar bateria" },
  ]);
});

test("finished and cancelled clocks can be explicitly reset without touching results", () => {
  assert.deepEqual(eventBatteryTimerActions("FINISHED"), [
    { action: "reset", label: "Voltar para Não iniciada" },
  ]);
  assert.deepEqual(eventBatteryTimerActions("CANCELLED"), [
    { action: "reset", label: "Voltar para Não iniciada" },
  ]);
  assert.deepEqual(eventBatteryTimerActions("UNKNOWN"), []);
});

test("status choices route operational finalization separately from stopping a timer", () => {
  assert.equal(eventBatteryTimerStatusAction("IDLE", "RUNNING"), "prepare");
  assert.equal(eventBatteryTimerStatusAction("IDLE", "FINISHED"), "finalize");
  assert.equal(eventBatteryTimerStatusAction("RUNNING", "PAUSED"), "pause");
  assert.equal(eventBatteryTimerStatusAction("PAUSED", "RUNNING"), "resume");
  assert.equal(eventBatteryTimerStatusAction("RUNNING", "FINISHED"), "finalize");
  assert.equal(eventBatteryTimerStatusAction("PAUSED", "FINISHED"), "finalize");
  assert.equal(eventBatteryTimerStatusAction("RUNNING", "CANCELLED"), "cancel");
  assert.equal(eventBatteryTimerStatusAction("FINISHED", "IDLE"), "reset");
  assert.equal(eventBatteryTimerStatusAction("RUNNING", "IDLE"), null);
  assert.deepEqual(
    eventBatteryTimerStatusChoices("RUNNING").map((choice) => choice.label),
    ["Em andamento", "Pausada", "Finalizada", "Cancelada"],
  );
});
