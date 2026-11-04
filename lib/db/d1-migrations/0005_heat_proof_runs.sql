-- A logical battery is grouped by proof + displayed order. Category-specific
-- heat rows remain separate, so RX and SC can be shown together. Legacy heats
-- remain unassigned (proof_id NULL) until an operator explicitly links them.
ALTER TABLE zero3_heats
  ADD COLUMN proof_id TEXT REFERENCES zero3_proofs(id) ON DELETE CASCADE;

ALTER TABLE zero3_heats
  ADD COLUMN battery_order INTEGER;

UPDATE zero3_heats
  SET battery_order = "order"
  WHERE battery_order IS NULL;

CREATE UNIQUE INDEX zero3_heat_proof_category_order_unique
  ON zero3_heats(event_id, proof_id, category, battery_order)
  WHERE proof_id IS NOT NULL AND battery_order IS NOT NULL;

CREATE INDEX zero3_heat_event_proof_idx
  ON zero3_heats(event_id, proof_id, battery_order);

CREATE TABLE zero3_heat_runs (
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  proof_id TEXT NOT NULL REFERENCES zero3_proofs(id) ON DELETE CASCADE,
  battery_order INTEGER NOT NULL CHECK(battery_order > 0),
  state TEXT NOT NULL DEFAULT 'IDLE'
    CHECK(state IN ('IDLE','PREPARATION','RUNNING','PAUSED','FINISHED')),
  elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_ms >= 0),
  started_at TEXT,
  preparation_ends_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  last_command_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(event_id, proof_id, battery_order)
);
