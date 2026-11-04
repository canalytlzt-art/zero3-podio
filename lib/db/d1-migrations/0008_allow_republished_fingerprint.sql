-- A corrected result can be reverted to a previously published value.
-- Keep every publication version; only the per-battery version is unique.
CREATE TABLE zero3_battery_publications_rebuilt (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  battery_id TEXT NOT NULL REFERENCES zero3_batteries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  result_fingerprint TEXT NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count > 0),
  results_json TEXT NOT NULL CHECK (json_valid(results_json)),
  leaderboards_json TEXT NOT NULL CHECK (json_valid(leaderboards_json)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_battery_publication_version_unique UNIQUE (battery_id, version)
);

INSERT INTO zero3_battery_publications_rebuilt
  (id,event_id,battery_id,version,result_fingerprint,result_count,results_json,
   leaderboards_json,published_by,published_at)
SELECT id,event_id,battery_id,version,result_fingerprint,result_count,results_json,
       leaderboards_json,published_by,published_at
FROM zero3_battery_publications;

DROP TABLE zero3_battery_publications;
ALTER TABLE zero3_battery_publications_rebuilt RENAME TO zero3_battery_publications;

CREATE INDEX zero3_battery_publication_latest_idx
  ON zero3_battery_publications(battery_id, version DESC);
