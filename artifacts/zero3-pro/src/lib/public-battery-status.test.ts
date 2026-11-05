import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBrasiliaDateTime,
  publicBatteryOperationalLabel,
  publicBatteryOperationalState,
} from "./public-battery-status";

test("public operational status follows the timer and explicit operational finalization", () => {
  const status = (state: string, operationalFinalized = false, elapsedMs = 0, timeCapMs = 7_200_000) =>
    publicBatteryOperationalState({ state, operationalFinalized, elapsedMs, timeCapMs });

  assert.equal(publicBatteryOperationalLabel(status("IDLE")), "Não iniciada");
  assert.equal(publicBatteryOperationalLabel(status("PREPARATION")), "Em preparação");
  assert.equal(publicBatteryOperationalLabel(status("RUNNING")), "Em andamento");
  assert.equal(publicBatteryOperationalLabel(status("PAUSED")), "Pausada");
  assert.equal(publicBatteryOperationalLabel(status("FINISHED", false, 90_000)), "Em apuração");
  assert.equal(publicBatteryOperationalLabel(status("FINISHED", false, 7_200_000)), "CAP atingido · em apuração");
  assert.equal(publicBatteryOperationalLabel(status("FINISHED", true, 7_200_000)), "Finalizada");
});

test("battery start times are rendered in the explicit Brasília timezone", () => {
  assert.equal(formatBrasiliaDateTime("2026-11-05T15:30:00.000Z"), "05/11/2026, 12:30 BRT");
  assert.equal(formatBrasiliaDateTime(null), "Não informado");
  assert.equal(formatBrasiliaDateTime("not-a-date"), "Não informado");
});
