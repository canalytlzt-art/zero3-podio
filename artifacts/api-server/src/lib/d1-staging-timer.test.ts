import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceD1TimerPreparation,
  d1TimerDto,
  type D1HeatRunRow,
} from "./d1-staging-timer";

function fakeD1(initial: D1HeatRunRow) {
  let row = { ...initial };
  let updates = 0;
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async run() {
          if (sql.includes("UPDATE zero3_heat_runs")) {
            const [updatedAt,eventId,proofId,batteryOrder,version,preparationEnd] = values;
            if (row.event_id === eventId && row.proof_id === proofId &&
                row.battery_order === batteryOrder && row.version === version &&
                row.state === "PREPARATION" && row.preparation_ends_at === preparationEnd) {
              row = {
                ...row,
                state: "RUNNING",
                started_at: row.preparation_ends_at,
                preparation_ends_at: null,
                version: row.version + 1,
                updated_at: String(updatedAt),
              };
              updates += 1;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          throw new Error("Unexpected SQL in D1 timer test.");
        },
        async first<T>() {
          assert.match(sql, /SELECT \* FROM zero3_heat_runs/);
          return { ...row } as T;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { DB, getRow: () => ({ ...row }), getUpdates: () => updates };
}

const sampleRun = (overrides: Partial<D1HeatRunRow> = {}): D1HeatRunRow => ({
  event_id: "event-1",
  proof_id: "proof-1",
  battery_order: 2,
  state: "PREPARATION",
  elapsed_ms: 0,
  started_at: null,
  preparation_ends_at: "2026-11-03T12:00:10.000Z",
  version: 4,
  last_command_id: "command-1",
  updated_at: "2026-11-03T12:00:00.000Z",
  ...overrides,
});

test("keeps the shared timer in preparation until its persisted deadline", async () => {
  const run = sampleRun();
  const fake = fakeD1(run);
  const result = await advanceD1TimerPreparation(fake.DB, run, new Date("2026-11-03T12:00:09.999Z"));
  assert.equal(result, run);
  assert.equal(fake.getUpdates(), 0);
});

test("starts at the saved preparation deadline and advances the version once", async () => {
  const fake = fakeD1(sampleRun());
  const result = await advanceD1TimerPreparation(fake.DB, sampleRun(), new Date("2026-11-03T12:00:12.000Z"));
  assert.equal(result.state, "RUNNING");
  assert.equal(result.started_at, "2026-11-03T12:00:10.000Z");
  assert.equal(result.preparation_ends_at, null);
  assert.equal(result.version, 5);
  assert.equal(fake.getUpdates(), 1);
});

test("repeated reads do not reapply an already completed preparation transition", async () => {
  const fake = fakeD1(sampleRun());
  const now = new Date("2026-11-03T12:00:12.000Z");
  const first = await advanceD1TimerPreparation(fake.DB, sampleRun(), now);
  const second = await advanceD1TimerPreparation(fake.DB, first, now);
  assert.equal(second.state, "RUNNING");
  assert.equal(second.version, 5);
  assert.equal(fake.getUpdates(), 1);
});

test("concurrent board reads transition a preparation only once", async () => {
  const fake = fakeD1(sampleRun());
  const now = new Date("2026-11-03T12:00:12.000Z");
  const [first, second] = await Promise.all([
    advanceD1TimerPreparation(fake.DB, sampleRun(), now),
    advanceD1TimerPreparation(fake.DB, sampleRun(), now),
  ]);
  assert.equal(first.state, "RUNNING");
  assert.equal(second.state, "RUNNING");
  assert.equal(first.version, 5);
  assert.equal(second.version, 5);
  assert.equal(fake.getUpdates(), 1);
});

test("timer responses reconstruct the frozen and running duration from server timestamps", () => {
  const run = sampleRun({
    state: "RUNNING",
    started_at: "2026-11-03T12:00:10.000Z",
    preparation_ends_at: null,
  });
  const dto = d1TimerDto(run, "event-1", 10, new Date("2026-11-03T12:00:13.250Z"));
  assert.equal(dto.elapsedMs, 3250);
  assert.equal(dto.preparationRemainingMs, 0);
  assert.equal(dto.proofId, "proof-1");
  assert.equal(dto.batteryOrder, 2);
});
