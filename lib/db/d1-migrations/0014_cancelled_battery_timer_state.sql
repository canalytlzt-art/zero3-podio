-- Add an explicit cancelled timer state without changing any existing timer
-- rows, durations, versions, timestamps, or battery links.
CREATE TABLE zero3_battery_runs_next (
  battery_id TEXT PRIMARY KEY NOT NULL REFERENCES zero3_batteries(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'IDLE'
    CHECK (state IN ('IDLE','PREPARATION','RUNNING','PAUSED','FINISHED','CANCELLED')),
  elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
  started_at TEXT,
  preparation_ends_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_command_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  preparation_started_at TEXT,
  first_started_at TEXT,
  stopped_at TEXT
);

INSERT INTO zero3_battery_runs_next(
  battery_id,event_id,state,elapsed_ms,started_at,preparation_ends_at,version,
  last_command_id,updated_at,preparation_started_at,first_started_at,stopped_at
)
SELECT
  battery_id,event_id,state,elapsed_ms,started_at,preparation_ends_at,version,
  last_command_id,updated_at,preparation_started_at,first_started_at,stopped_at
FROM zero3_battery_runs;

DROP TABLE zero3_battery_runs;
ALTER TABLE zero3_battery_runs_next RENAME TO zero3_battery_runs;
