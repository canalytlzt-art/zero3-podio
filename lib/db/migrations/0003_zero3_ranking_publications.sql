BEGIN;

-- Keep the currently published value independent from the mutable review row.
ALTER TABLE zero3_results
  ADD COLUMN IF NOT EXISTS published_status text,
  ADD COLUMN IF NOT EXISTS published_elapsed_ms integer,
  ADD COLUMN IF NOT EXISTS published_raw_value numeric(12, 3),
  ADD COLUMN IF NOT EXISTS published_revision integer;

-- Before event-wide publication existed, validated/official exception rows
-- were the public ranking source in the PostgreSQL Preview path. Preserve that
-- visible baseline; new revisions remain unpublished until an ADMIN confirms.
UPDATE zero3_results
SET published_status = status,
    published_elapsed_ms = elapsed_ms,
    published_raw_value = raw_value,
    published_revision = revision
WHERE published_status IS NULL
  AND status IN ('VALIDATED', 'DNS', 'DNF');

CREATE TABLE IF NOT EXISTS zero3_ranking_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  fingerprint text NOT NULL,
  result_count integer NOT NULL CHECK (result_count > 0),
  results_json jsonb NOT NULL,
  leaderboards_json jsonb NOT NULL,
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zero3_ranking_publication_version_unique UNIQUE (event_id, version),
  CONSTRAINT zero3_ranking_publication_fingerprint_unique UNIQUE (event_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS zero3_ranking_publication_latest_idx
  ON zero3_ranking_publications(event_id, version DESC);

COMMIT;
