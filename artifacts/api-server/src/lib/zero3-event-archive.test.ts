import assert from "node:assert/strict";
import test from "node:test";
import {
  createZero3EventBackup,
  stableZero3Json,
  validateZero3EventBackup,
  ZERO3_EVENT_BACKUP_VERSION,
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
  heatRuns: [],
  heatPublications: [],
  batteries: [],
  batteryEntries: [],
  activeBatteries: [],
  batteryRuns: [],
  batteryPublications: [],
  batteryDurationAudit: [],
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
    heatPublications: [{
      id: "publication-1",
      event_id: "event-roundtrip",
      results_json: '[{"id":"result-1"}]',
      leaderboards_json: '[{"category":"RX"}]',
    }],
    batteryPublications: [{
      id: "battery-publication-1",
      event_id: "event-roundtrip",
      results_json: '[{"id":"event-result-1"}]',
      leaderboards_json: '[{"category":"SC"}]',
    }],
    registrations: [{
      id: "registration-1",
      event_id: "event-roundtrip",
      athlete_ids: '["athlete-1","athlete-2"]',
    }],
    athletes: [{ id: "athlete-1", full_name: "Atleta Fictício" }],
    podiumVersions: [{
      event_id: "event-roundtrip",
      published: 1,
      arbitration_note: "Observação de teste preservada.",
    }],
  } as unknown as Zero3EventBackupData;

  const backup = await createZero3EventBackup(data.event, data);
  const checked = await validateZero3EventBackup(JSON.parse(JSON.stringify(backup)));

  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.deepEqual(checked.backup.data.registrations[0].athlete_ids, ["athlete-1", "athlete-2"]);
    assert.equal(checked.backup.data.podiumVersions[0].published, 1);
    assert.equal(checked.backup.data.podiumVersions[0].arbitration_note, "Observação de teste preservada.");
    assert.deepEqual(checked.backup.data.heatPublications[0].results_json, [{ id: "result-1" }]);
    assert.deepEqual(checked.backup.data.heatPublications[0].leaderboards_json, [{ category: "RX" }]);
    assert.deepEqual(checked.backup.data.batteryPublications[0].results_json, [{ id: "event-result-1" }]);
    assert.deepEqual(checked.backup.data.batteryPublications[0].leaderboards_json, [{ category: "SC" }]);
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

test("legacy backup versions remain restorable after adding ranking publication history",async()=>{
  const data={event:{id:"old-event",name:"Legacy"},...emptyCollections} as unknown as Zero3EventBackupData;
  const current=await createZero3EventBackup(data.event,data);
  for(const version of [1,2,3,4,5]){
    const legacy=structuredClone(current) as unknown as Record<string,any>;
    legacy.version=version;
    if(version<3){
      delete legacy.data.heatPublications;
      delete legacy.counts.heatPublications;
    }
    if(version===1){
      delete legacy.data.heatRuns;
      delete legacy.counts.heatRuns;
    }
    if(version<4){
      for(const collection of ["batteries","batteryEntries","activeBatteries","batteryRuns","batteryPublications"]){
        delete legacy.data[collection];
        delete legacy.counts[collection];
      }
    }
    if(version<5){
      delete legacy.data.rankingPublications;
      delete legacy.counts.rankingPublications;
    }
    if(version<6){
      delete legacy.data.batteryTimeCapAudit;
      delete legacy.counts.batteryTimeCapAudit;
    }
    if(version<8){
      delete legacy.data.batteryDurationAudit;
      delete legacy.counts.batteryDurationAudit;
    }
    const payload={
      format:legacy.format,version:legacy.version,eventId:legacy.eventId,eventName:legacy.eventName,
      counts:legacy.counts,data:legacy.data,
    };
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stableZero3Json(payload)));
    legacy.digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
    const checked=await validateZero3EventBackup(legacy);
    assert.equal(checked.ok,true);
    if(checked.ok){
      assert.equal(checked.backup.version,ZERO3_EVENT_BACKUP_VERSION);
      assert.deepEqual(checked.backup.data.heatRuns,[]);
      if(version<3) assert.deepEqual(checked.backup.data.heatPublications,[]);
      assert.deepEqual(checked.backup.data.batteries,[]);
      assert.deepEqual(checked.backup.data.batteryEntries,[]);
      assert.deepEqual(checked.backup.data.activeBatteries,[]);
      assert.deepEqual(checked.backup.data.batteryRuns,[]);
      assert.deepEqual(checked.backup.data.batteryPublications,[]);
      assert.deepEqual(checked.backup.data.rankingPublications,[]);
    }
  }
});

test("version 5 battery backups restore with nullable operational finalization fields",async()=>{
  const data={
    event:{id:"old-battery-event",name:"Bateria antiga"},
    ...emptyCollections,
    batteries:[{id:"battery-1",event_id:"old-battery-event",battery_order:1,name:"Bateria 01",created_at:"2026-01-01T00:00:00.000Z"}],
  } as unknown as Zero3EventBackupData;
  const current=await createZero3EventBackup(data.event,data);
  const legacy=structuredClone(current) as unknown as Record<string,any>;
  legacy.version=5;
  delete legacy.data.batteryTimeCapAudit;
  delete legacy.counts.batteryTimeCapAudit;
  delete legacy.data.batteryDurationAudit;
  delete legacy.counts.batteryDurationAudit;
  for(const row of legacy.data.batteries) {
    delete row.operational_finalized_at;
    delete row.operational_finalized_by;
  }
  const payload={
    format:legacy.format,version:legacy.version,eventId:legacy.eventId,eventName:legacy.eventName,
    counts:legacy.counts,data:legacy.data,
  };
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stableZero3Json(payload)));
  legacy.digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
  const checked=await validateZero3EventBackup(legacy);
  assert.equal(checked.ok,true);
  if(checked.ok) {
    assert.equal(checked.backup.version,ZERO3_EVENT_BACKUP_VERSION);
    assert.equal(checked.backup.data.batteries[0].operational_finalized_at,null);
    assert.equal(checked.backup.data.batteries[0].operational_finalized_by,null);
  }
});

test("version 8 duration audit backups preserve add metadata and default old correction rows",async()=>{
  const data={
    event:{id:"duration-audit-event",name:"Auditoria de duração"},
    ...emptyCollections,
    batteryDurationAudit:[{
      id:"audit-add",event_id:"duration-audit-event",battery_id:"battery-1",
      battery_id_snapshot:"battery-1",command_id:"add-1",clerk_user_id:"clerk-admin",
      role:"ADMIN",change_type:"ADD",additional_ms:1500000,
      old_elapsed_ms:600000,new_elapsed_ms:2100000,changed_at:"2026-11-05T12:10:00.000Z",
    }],
  } as unknown as Zero3EventBackupData;
  const current=await createZero3EventBackup(data.event,data);
  assert.equal(current.data.batteryDurationAudit[0]?.change_type,"ADD");
  assert.equal(current.data.batteryDurationAudit[0]?.additional_ms,1500000);

  const legacy=structuredClone(current) as unknown as Record<string,any>;
  delete legacy.data.batteryDurationAudit[0].change_type;
  delete legacy.data.batteryDurationAudit[0].additional_ms;
  const payload={
    format:legacy.format,version:legacy.version,eventId:legacy.eventId,eventName:legacy.eventName,
    counts:legacy.counts,data:legacy.data,
  };
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stableZero3Json(payload)));
  legacy.digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
  const checked=await validateZero3EventBackup(legacy);
  assert.equal(checked.ok,true);
  if(checked.ok) {
    assert.equal(checked.backup.data.batteryDurationAudit[0]?.change_type,"SET");
    assert.equal(checked.backup.data.batteryDurationAudit[0]?.additional_ms,0);
  }
});
