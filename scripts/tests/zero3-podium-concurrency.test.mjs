import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("isolated podium publication CAS remains idempotent under concurrent reads and publish attempts", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE zero3_podium_versions (
      event_id TEXT NOT NULL,
      category TEXT NOT NULL,
      version INTEGER NOT NULL,
      registration_ids TEXT NOT NULL,
      arbitration_note TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      published_by TEXT,
      published_at TEXT,
      publish_reason TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (event_id, category, version)
    );
    INSERT INTO zero3_podium_versions
      (event_id, category, version, registration_ids, arbitration_note, published, updated_at)
    VALUES
      ('fixture-event', 'RX', 1, '["r1","r2","r3"]',
        'Observação geral publicada anteriormente', 1, '2026-11-06T11:00:00.000Z'),
      ('fixture-event', 'RX', 2, '["r1","r2","r3"]',
        'ZERO3_PODIUM_OBSERVATIONS_V1:[{"place":1,"registrationId":"r1","note":"Nota 1"},{"place":2,"registrationId":"r2","note":"Nota 2"},{"place":3,"registrationId":"r3","note":"Nota 3"}]',
        0, '2026-11-06T12:00:00.000Z');
  `);
  assert.equal(db.prepare(`
    SELECT version FROM zero3_podium_versions
    WHERE event_id=? AND category=? AND published=1
    ORDER BY version DESC LIMIT 1
  `).get("fixture-event", "RX").version, 1);

  const start = performance.now();
  const readLatencies = [];
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const reads = Array.from({ length: 24 }, async () => {
    await gate;
    const queryStart = performance.now();
    const result = db.prepare(`
      SELECT version, registration_ids, arbitration_note, published
      FROM zero3_podium_versions
      WHERE event_id=? AND category=? AND published=1
      ORDER BY version DESC LIMIT 1
    `).get("fixture-event", "RX");
    readLatencies.push(performance.now() - queryStart);
    return result;
  });
  const publishAttempts = Array.from({ length: 8 }, async (_, index) => {
    await gate;
    const result = db.prepare(`
      UPDATE zero3_podium_versions
      SET published=1, published_by=?, published_at=?, publish_reason=?, updated_at=?
      WHERE event_id=? AND category=? AND version=? AND published=0
    `).run(
      `judge-${index}`,
      "2026-11-06T12:00:01.000Z",
      `reason-${index}`,
      "2026-11-06T12:00:01.000Z",
      "fixture-event",
      "RX",
      2,
    );
    if (Number(result.changes) === 1) {
      return { changed: 1, row: db.prepare(`
        SELECT version, published, publish_reason FROM zero3_podium_versions
        WHERE event_id=? AND category=? AND version=?
      `).get("fixture-event", "RX", 2) };
    }
    return { changed: 0, row: db.prepare(`
      SELECT version, published, publish_reason FROM zero3_podium_versions
      WHERE event_id=? AND category=? AND version=? AND published=1
    `).get("fixture-event", "RX", 2) };
  });

  release();
  const settled = await Promise.allSettled([...reads, ...publishAttempts]);
  const elapsedMs = performance.now() - start;
  const readResults = settled.slice(0, reads.length);
  const publishResults = settled.slice(reads.length);
  const errors = settled.filter((item) => item.status === "rejected");

  assert.equal(errors.length, 0);
  assert.equal(publishResults.filter((item) => item.status === "fulfilled").length, 8);
  assert.ok(readResults.every((item) =>
    item.status === "fulfilled" && [1, 2].includes(item.value?.version),
  ));
  assert.equal(publishResults.filter((item) => item.status === "fulfilled" && item.value.changed === 1).length, 1);
  assert.ok(publishResults.every((item) =>
    item.status === "fulfilled" && item.value.row?.version === 2 && item.value.row?.published === 1,
  ));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM zero3_podium_versions WHERE published=1 AND version=2").get().count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM zero3_podium_versions WHERE published=1").get().count,
    2,
  );
  const published = db.prepare(`
    SELECT version, arbitration_note, publish_reason, published
    FROM zero3_podium_versions WHERE event_id=? AND category=? AND version=?
  `).get("fixture-event", "RX", 2);
  assert.equal(published.published, 1);
  assert.equal(published.arbitration_note.includes("Nota 1"), true);
  assert.equal(published.arbitration_note.includes("Nota 2"), true);
  assert.equal(published.arbitration_note.includes("Nota 3"), true);
  assert.equal(db.prepare(`
    SELECT version FROM zero3_podium_versions
    WHERE event_id=? AND category=? AND published=1
    ORDER BY version DESC LIMIT 1
  `).get("fixture-event", "RX").version, 2);
  const latencyMin = Math.min(...readLatencies);
  const latencyMax = Math.max(...readLatencies);
  const latencyAverage = readLatencies.reduce((sum, value) => sum + value, 0) / readLatencies.length;

  t.diagnostic(
    `fixture SQLite only: ${reads.length} simultaneous ranking reads; ${publishAttempts.length} publication attempts; 0 errors; 1 new published version; prior publication retained; total ${elapsedMs.toFixed(2)} ms; read latency min/avg/max ${latencyMin.toFixed(3)}/${latencyAverage.toFixed(3)}/${latencyMax.toFixed(3)} ms`,
  );
  db.close();
});
