import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildBatteryPublicationInsert } from "./d1-staging-finalization";

function seededDatabase() {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = resolve(process.cwd(), "../../lib/db/d1-migrations");
  for (const file of readdirSync(migrationDirectory).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrationDirectory, file), "utf8"));
  }
  db.exec(`
    INSERT INTO zero3_events(id,name,proof_name,status,preparation_seconds,created_at,categories)
      VALUES('event-1','Evento fictício','Prova 1','ACTIVE',10,'2026-11-03T12:00:00.000Z','["RX"]');
    INSERT INTO zero3_proofs(id,event_id,proof_order,name,metric_type,unit,direction,created_at,updated_at)
      VALUES('proof-1','event-1',1,'Prova 1','TIME','s','LOWER','2026-11-03T12:00:00.000Z','2026-11-03T12:00:00.000Z');
    INSERT INTO zero3_athletes(id,full_name,created_at)
      VALUES('athlete-1','Atleta Fictício','2026-11-03T12:00:00.000Z');
    INSERT INTO zero3_registrations(id,event_id,category,team_name,athlete_ids,lane_label,confirmation_status,payment_status,created_at)
      VALUES('registration-1','event-1','RX','Equipe Fictícia','["athlete-1"]','P01','CONFIRMED','PAID','2026-11-03T12:00:00.000Z');
    INSERT INTO zero3_heats(id,event_id,category,name,"order",proof_id,battery_order)
      VALUES('heat-1','event-1','RX','Bateria 01',1,'proof-1',1);
    INSERT INTO zero3_heat_entries(heat_id,registration_id,lane_label,assigned_at)
      VALUES('heat-1','registration-1','P01','2026-11-03T12:00:00.000Z');
    INSERT INTO zero3_results(id,event_id,registration_id,proof_id,heat_id,category,lane_label,
      athlete_ids_snapshot,athlete_names_snapshot,team_name_snapshot,elapsed_ms,raw_value,
      sync_error_ms,status,idempotency_key,captured_at,revision)
      VALUES('result-1','event-1','registration-1','proof-1','heat-1','RX','P01','["athlete-1"]',
      '["Atleta Fictício"]','Equipe Fictícia',NULL,'62.3',NULL,'VALIDATED','capture-1',
      '2026-11-03T12:01:00.000Z',1);
  `);
  return db;
}

function insertInput(overrides: Record<string, unknown> = {}) {
  return {
    publicationId: "publication-1",
    eventId: "event-1",
    proofId: "proof-1",
    batteryOrder: 1,
    version: 1,
    fingerprint: "a".repeat(64),
    resultCount: 1,
    resultsJson: JSON.stringify([{ id: "result-1", status: "VALIDATED" }]),
    leaderboardsJson: JSON.stringify([{ category: "RX", entries: [] }]),
    publishedBy: "clerk-user-1",
    publishedAt: "2026-11-03T12:02:00.000Z",
    expectedCount: 1,
    guardEntries: [{
      heatId: "heat-1",
      registrationId: "registration-1",
      category: "RX",
      laneLabel: "P01",
      teamName: "Equipe Fictícia",
      athleteIds: '["athlete-1"]',
    }],
    guardResults: [{
      id: "result-1",
      registrationId: "registration-1",
      heatId: "heat-1",
      proofId: "proof-1",
      status: "VALIDATED",
      rawValue: "62.3",
      elapsedMs: null,
      revision: 1,
      capturedAt: "2026-11-03T12:01:00.000Z",
    }],
    ...overrides,
  };
}

function executeInsert(db: DatabaseSync, overrides: Record<string, unknown> = {}) {
  const statement = buildBatteryPublicationInsert(
    insertInput(overrides) as Parameters<typeof buildBatteryPublicationInsert>[0],
  );
  return db.prepare(statement.sql).get(...statement.bindings as (string | number | null)[]);
}

test("battery publication statement inserts one atomic full result and podium snapshot", () => {
  const db = seededDatabase();
  assert.ok(executeInsert(db));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM zero3_heat_publications").get()?.count, 1);
  const row = db.prepare("SELECT result_count,results_json,leaderboards_json,published_by FROM zero3_heat_publications").get() as Record<string, unknown>;
  assert.equal(row.result_count, 1);
  assert.deepEqual(JSON.parse(String(row.results_json)), [{ id: "result-1", status: "VALIDATED" }]);
  assert.deepEqual(JSON.parse(String(row.leaderboards_json)), [{ category: "RX", entries: [] }]);
  assert.equal(row.published_by, "clerk-user-1");
  db.close();
});

test("duplicate finalization is idempotent and corrections require a new reviewed publication", () => {
  const db = seededDatabase();
  assert.ok(executeInsert(db));
  assert.equal(executeInsert(db, { publicationId: "publication-duplicate", version: 2 }), undefined);
  db.prepare("UPDATE zero3_results SET revision=2 WHERE id='result-1'").run();
  assert.equal(executeInsert(db, {
    publicationId: "publication-stale",
    version: 2,
    fingerprint: "b".repeat(64),
  }), undefined);
  db.prepare("UPDATE zero3_results SET raw_value='61.8',revision=2 WHERE id='result-1'").run();
  const corrected=executeInsert(db,{
    publicationId:"publication-corrected",
    version:2,
    fingerprint:"c".repeat(64),
    resultsJson:JSON.stringify([{id:"result-1",status:"VALIDATED",rawValue:61.8}]),
    guardResults:[{
      id:"result-1",registrationId:"registration-1",heatId:"heat-1",proofId:"proof-1",
      status:"VALIDATED",rawValue:"61.8",elapsedMs:null,revision:2,
      capturedAt:"2026-11-03T12:01:00.000Z",
    }],
  });
  assert.ok(corrected);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM zero3_heat_publications").get()?.count, 2);
  db.close();
});
