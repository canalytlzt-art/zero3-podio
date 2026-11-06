import assert from "node:assert/strict";
import test from "node:test";
import { ControlZero3TimerBody } from "@workspace/api-zod";
import { eventBatteryFinalizedRun, isRepeatedBatteryTimerCommand } from "./d1-staging-event-batteries";
import { isD1SchemaNotReady } from "./d1-staging-shared";

function run(overrides: Record<string, unknown> = {}) {
  return {
    battery_id: "battery-demo",
    event_id: "event-demo",
    state: "IDLE",
    elapsed_ms: 0,
    started_at: null,
    preparation_ends_at: null,
    version: 4,
    last_command_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    preparation_started_at: null,
    first_started_at: null,
    stopped_at: null,
    ...overrides,
  };
}

test("operational finalization freezes only the elapsed time of a running battery", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const result = eventBatteryFinalizedRun(run({
    state: "RUNNING",
    elapsed_ms: 7_000,
    started_at: "2026-01-01T00:00:08.250Z",
  }), now);

  assert.deepEqual(result, {
    state: "FINISHED",
    elapsedMs: 8_750,
    stoppedAt: now.toISOString(),
  });
});

test("operational finalization preserves paused and preparation durations", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  assert.equal(eventBatteryFinalizedRun(run({
    state: "PAUSED",
    elapsed_ms: 12_345,
    stopped_at: "2026-01-01T00:00:05.000Z",
  }), now).elapsedMs, 12_345);
  assert.equal(eventBatteryFinalizedRun(run({
    state: "PREPARATION",
    elapsed_ms: 0,
    preparation_ends_at: "2026-01-01T00:00:15.000Z",
  }), now).elapsedMs, 0);
});

test("finalizing a stopped battery does not change its saved duration", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const result = eventBatteryFinalizedRun(run({
    state: "FINISHED",
    elapsed_ms: 91_234,
    stopped_at: "2026-01-01T00:00:05.000Z",
  }), now);

  assert.equal(result.elapsedMs, 91_234);
  assert.equal(result.state, "FINISHED");
  assert.equal(result.stoppedAt, now.toISOString());
});

test("operational finalization preserves a previously cancelled timer state and elapsed time", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const result = eventBatteryFinalizedRun(run({
    state: "CANCELLED",
    elapsed_ms: 12_345,
    started_at: null,
    stopped_at: "2026-01-01T00:00:05.000Z",
  }), now);

  assert.deepEqual(result, {
    state: "CANCELLED",
    elapsedMs: 12_345,
    stoppedAt: now.toISOString(),
  });
});

test("timer command validation accepts cancel alongside every existing action", () => {
  for (const action of ["start", "finish", "prepare", "pause", "resume", "reset", "cancel"] as const) {
    const parsed = ControlZero3TimerBody.safeParse({
      action,
      expectedVersion: 1,
      commandId: `test-${action}`,
      expectedBatteryId: "battery-demo",
    });
    assert.equal(parsed.success, true, `expected ${action} to pass timer validation`);
  }
});

test("a repeated battery command is recognized for replay without a second mutation", () => {
  assert.equal(isRepeatedBatteryTimerCommand("cancel-command-1", "cancel-command-1"), true);
  assert.equal(isRepeatedBatteryTimerCommand("cancel-command-1", "cancel-command-2"), false);
  assert.equal(isRepeatedBatteryTimerCommand(null, "cancel-command-1"), false);
});

test("missing D1 migration errors are classified separately from runtime failures", () => {
  assert.equal(isD1SchemaNotReady(new Error("no such column: operational_finalized_at")), true);
  assert.equal(isD1SchemaNotReady(new Error("no such table: zero3_ranking_publications")), true);
  assert.equal(isD1SchemaNotReady(new Error("database is locked")), false);
});
