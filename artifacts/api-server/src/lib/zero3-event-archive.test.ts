import assert from "node:assert/strict";
import test from "node:test";
import {
  createZero3EventBackup,
  validateZero3EventBackup,
  type Zero3EventBackupData,
} from "./zero3-event-archive";

const emptyCollections = {
  athletes: [],
  proofs: [],
  registrations: [],
  registrationMembers: [],
  registrationAudit: [],
  importBatches: [],
  importPeople: [],
  importTeams: [],
  heats: [],
  heatEntries: [],
  activeHeats: [],
  results: [],
  resultRevisions: [],
  timers: [],
  podiumVersions: [],
};

test("event backup digest is stable across object keys and row ordering", async () => {
  const firstData = {
    event: { id: "event-1", name: "Demo", createdAt: new Date("2026-01-01T00:00:00Z") },
    ...emptyCollections,
    proofs: [{ id: "p2", order: 2 }, { id: "p1", order: 1 }],
  } as unknown as Zero3EventBackupData;
  const secondData = {
    ...emptyCollections,
    proofs: [{ order: 1, id: "p1" }, { order: 2, id: "p2" }],
    event: { name: "Demo", createdAt: "2026-01-01T00:00:00.000Z", id: "event-1" },
  } as unknown as Zero3EventBackupData;

  const first = await createZero3EventBackup(firstData.event, firstData, "2026-02-01T00:00:00.000Z");
  const second = await createZero3EventBackup(secondData.event, secondData, "2026-03-01T00:00:00.000Z");

  assert.equal(first.digest, second.digest);
  assert.equal((await validateZero3EventBackup(first)).ok, true);
});

test("event backup normalizes PostgreSQL and D1 JSON/date values for restore", async () => {
  const data = {
    event: { id: "event-roundtrip", name: "Evento fictício", created_at: "2026-01-01T00:00:00.000Z" },
    ...emptyCollections,
    registrations: [{
      id: "registration-1",
      event_id: "event-roundtrip",
      athlete_ids: '["athlete-1","athlete-2"]',
    }],
    athletes: [{ id: "athlete-1", full_name: "Atleta Fictício" }],
    podiumVersions: [{ event_id: "event-roundtrip", published: 1 }],
  } as unknown as Zero3EventBackupData;

  const backup = await createZero3EventBackup(data.event, data);
  const checked = await validateZero3EventBackup(JSON.parse(JSON.stringify(backup)));

  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.deepEqual(checked.backup.data.registrations[0].athlete_ids, ["athlete-1", "athlete-2"]);
    assert.equal(checked.backup.data.podiumVersions[0].published, 1);
  }
});

test("event backup validation rejects changed records and count mismatches", async () => {
  const data = {
    event: { id: "event-2", name: "Fictício" },
    ...emptyCollections,
    athletes: [{ id: "athlete-1", fullName: "Atleta Demo" }],
  } as unknown as Zero3EventBackupData;
  const backup = await createZero3EventBackup(data.event, data, "2026-02-01T00:00:00.000Z");

  const changed = structuredClone(backup);
  changed.data.athletes[0].full_name = "Nome alterado";
  assert.equal((await validateZero3EventBackup(changed)).ok, false);

  const wrongCounts = structuredClone(backup);
  wrongCounts.counts.athletes = 2;
  assert.equal((await validateZero3EventBackup(wrongCounts)).ok, false);
});
