-- Event-wide ranking publication is separate from per-battery review and
-- publication. The published_* columns retain the previous official value
-- while a later correction is being reviewed.
ALTER TABLE zero3_results ADD COLUMN published_status TEXT;
ALTER TABLE zero3_results ADD COLUMN published_elapsed_ms INTEGER;
ALTER TABLE zero3_results ADD COLUMN published_raw_value TEXT;
ALTER TABLE zero3_results ADD COLUMN published_revision INTEGER;

-- Preserve the latest legacy proof-scoped publications as the official baseline.
UPDATE zero3_results
SET published_status = (
      SELECT json_extract(item.value, '$.status')
      FROM zero3_heat_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    ),
    published_elapsed_ms = (
      SELECT json_extract(item.value, '$.elapsedMs')
      FROM zero3_heat_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    ),
    published_raw_value = (
      SELECT CAST(json_extract(item.value, '$.rawValue') AS TEXT)
      FROM zero3_heat_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    ),
    published_revision = (
      SELECT COALESCE(json_extract(item.value, '$.revision'), zero3_results.revision)
      FROM zero3_heat_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1
  FROM zero3_heat_publications p, json_each(p.results_json) item
  WHERE json_extract(item.value, '$.id') = zero3_results.id
);

-- Event-scoped battery snapshots take precedence if a result was later
-- republished after the legacy model was retired.
UPDATE zero3_results
SET published_status = (
      SELECT json_extract(item.value, '$.status')
      FROM zero3_battery_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    ),
    published_elapsed_ms = (
      SELECT json_extract(item.value, '$.elapsedMs')
      FROM zero3_battery_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    ),
    published_raw_value = (
      SELECT CAST(json_extract(item.value, '$.rawValue') AS TEXT)
      FROM zero3_battery_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    ),
    published_revision = (
      SELECT COALESCE(json_extract(item.value, '$.revision'), zero3_results.revision)
      FROM zero3_battery_publications p, json_each(p.results_json) item
      WHERE json_extract(item.value, '$.id') = zero3_results.id
      ORDER BY p.version DESC
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1
  FROM zero3_battery_publications p, json_each(p.results_json) item
  WHERE json_extract(item.value, '$.id') = zero3_results.id
);

CREATE TABLE zero3_ranking_publications (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  fingerprint TEXT NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count > 0),
  results_json TEXT NOT NULL CHECK (json_valid(results_json)),
  leaderboards_json TEXT NOT NULL CHECK (json_valid(leaderboards_json)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_ranking_publication_version_unique UNIQUE (event_id, version),
  CONSTRAINT zero3_ranking_publication_fingerprint_unique UNIQUE (event_id, fingerprint)
);

CREATE INDEX zero3_ranking_publication_latest_idx
  ON zero3_ranking_publications(event_id, version DESC);
