-- Versioned, complete battery snapshots. A single row atomically records both
-- the reviewed result list and the category leaderboards published to the TV.
CREATE TABLE zero3_heat_publications (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  proof_id TEXT NOT NULL REFERENCES zero3_proofs(id) ON DELETE CASCADE,
  battery_order INTEGER NOT NULL CHECK(battery_order > 0),
  version INTEGER NOT NULL CHECK(version > 0),
  result_fingerprint TEXT NOT NULL,
  result_count INTEGER NOT NULL CHECK(result_count > 0),
  results_json TEXT NOT NULL CHECK(json_valid(results_json)),
  leaderboards_json TEXT NOT NULL CHECK(json_valid(leaderboards_json)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_heat_publication_version_unique
    UNIQUE(event_id,proof_id,battery_order,version),
  CONSTRAINT zero3_heat_publication_fingerprint_unique
    UNIQUE(event_id,proof_id,battery_order,result_fingerprint)
);

CREATE INDEX zero3_heat_publication_latest_idx
  ON zero3_heat_publications(event_id,proof_id,battery_order,version DESC);
