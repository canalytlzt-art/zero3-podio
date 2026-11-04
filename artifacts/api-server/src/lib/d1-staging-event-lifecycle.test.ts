import assert from "node:assert/strict";
import test from "node:test";
import { validateD1EventTableSet } from "./d1-staging-event-lifecycle";

const coreTables = [
  "zero3_events",
  "zero3_athletes",
  "zero3_proofs",
  "zero3_registrations",
  "zero3_registration_members",
  "zero3_registration_audit",
  "zero3_import_batches",
  "zero3_import_people",
  "zero3_import_teams",
  "zero3_heats",
  "zero3_heat_entries",
  "zero3_active_heats",
  "zero3_results",
  "zero3_result_revisions",
  "zero3_timers",
  "zero3_podium_versions",
  "zero3_heat_runs",
  "zero3_heat_publications",
  "zero3_event_deletion_audit",
];

const batteryTables = [
  "zero3_batteries",
  "zero3_battery_entries",
  "zero3_active_batteries",
  "zero3_battery_runs",
  "zero3_battery_publications",
];

test("the current pre-battery staging schema remains supported", () => {
  assert.deepEqual(validateD1EventTableSet(new Set(coreTables)), {
    batteryTablesAvailable: false,
  });
});

test("a fully migrated event-battery schema is supported", () => {
  assert.deepEqual(validateD1EventTableSet(new Set([...coreTables, ...batteryTables])), {
    batteryTablesAvailable: true,
  });
});

test("a partially created battery schema fails explicitly", () => {
  assert.throws(
    () => validateD1EventTableSet(new Set([...coreTables, ...batteryTables.slice(0, 2)])),
    { message: "D1_EVENT_BATTERY_SCHEMA_INCOMPLETE" },
  );
});

test("a missing core migration fails explicitly", () => {
  assert.throws(
    () => validateD1EventTableSet(new Set(coreTables.filter((table) => table !== "zero3_heat_runs"))),
    { message: "D1_EVENT_SCHEMA_INCOMPLETE" },
  );
});
