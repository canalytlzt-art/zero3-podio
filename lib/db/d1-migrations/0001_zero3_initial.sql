-- ZERO3 PostgreSQL -> Cloudflare D1 initial schema.
-- IDs remain canonical UUID text; callers/imports must supply IDs (no
-- PostgreSQL gen_random_uuid() equivalent is assumed on D1).
-- JSONB is valid JSON TEXT; booleans are INTEGER 0/1; NUMERIC(12,3) is
-- canonical decimal TEXT to avoid IEEE-754 loss; timestamps are UTC ISO-8601
-- TEXT. Milliseconds (elapsed_ms) remain INTEGER.
PRAGMA foreign_keys = ON;

CREATE TABLE zero3_events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  proof_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  preparation_seconds INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE zero3_proofs (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  proof_order INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  metric_type TEXT NOT NULL DEFAULT 'UNCONFIGURED',
  unit TEXT,
  direction TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_proof_order_unique UNIQUE(event_id, proof_order)
);

CREATE TABLE zero3_athletes (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE zero3_registrations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  team_name TEXT,
  athlete_ids TEXT NOT NULL CHECK(json_valid(athlete_ids)),
  lane_label TEXT,
  confirmation_status TEXT NOT NULL DEFAULT 'PENDING',
  payment_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_registration_id_event_unique UNIQUE(id,event_id),
  CONSTRAINT zero3_registration_lane_unique UNIQUE(event_id,category,lane_label)
);

CREATE TABLE zero3_registration_members (
  registration_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL REFERENCES zero3_athletes(id) ON DELETE RESTRICT,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 2),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(registration_id,slot),
  CONSTRAINT zero3_registration_member_event_fk
    FOREIGN KEY(registration_id,event_id)
    REFERENCES zero3_registrations(id,event_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX zero3_registration_member_unique ON zero3_registration_members(registration_id,athlete_id);
CREATE UNIQUE INDEX zero3_event_athlete_unique ON zero3_registration_members(event_id,athlete_id);

CREATE TABLE zero3_registration_audit (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE RESTRICT,
  registration_id TEXT NOT NULL REFERENCES zero3_registrations(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_state TEXT NOT NULL CHECK(json_valid(before_state)),
  after_state TEXT NOT NULL CHECK(json_valid(after_state)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE zero3_import_batches (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE RESTRICT,
  dataset_key TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_notes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_notes)),
  content_hash TEXT NOT NULL,
  source_team_count INTEGER NOT NULL,
  source_people_count INTEGER NOT NULL,
  applied_by TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX zero3_import_batch_event_dataset_unique ON zero3_import_batches(event_id,dataset_key);

CREATE TABLE zero3_import_people (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES zero3_import_batches(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_cell TEXT NOT NULL,
  athlete_id TEXT NOT NULL REFERENCES zero3_athletes(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX zero3_import_person_source_unique ON zero3_import_people(batch_id,source_key);

CREATE TABLE zero3_import_teams (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES zero3_import_batches(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  source_category TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  source_cells TEXT NOT NULL CHECK(json_valid(source_cells)),
  source_athlete_names TEXT NOT NULL CHECK(json_valid(source_athlete_names)),
  target_category TEXT NOT NULL,
  registration_id TEXT NOT NULL REFERENCES zero3_registrations(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX zero3_import_team_source_unique ON zero3_import_teams(batch_id,source_code);
CREATE UNIQUE INDEX zero3_import_registration_unique ON zero3_import_teams(batch_id,registration_id);

CREATE TABLE zero3_heats (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  CONSTRAINT zero3_heat_order_unique UNIQUE(event_id,category,"order")
);

CREATE TABLE zero3_heat_entries (
  heat_id TEXT NOT NULL REFERENCES zero3_heats(id) ON DELETE CASCADE,
  registration_id TEXT NOT NULL REFERENCES zero3_registrations(id) ON DELETE CASCADE,
  lane_label TEXT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(heat_id,registration_id)
);

CREATE TABLE zero3_active_heats (
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  heat_id TEXT REFERENCES zero3_heats(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(event_id,category)
);

CREATE TABLE zero3_results (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  registration_id TEXT NOT NULL REFERENCES zero3_registrations(id) ON DELETE CASCADE,
  proof_id TEXT REFERENCES zero3_proofs(id) ON DELETE SET NULL,
  heat_id TEXT REFERENCES zero3_heats(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  lane_label TEXT,
  athlete_ids_snapshot TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(athlete_ids_snapshot)),
  athlete_names_snapshot TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(athlete_names_snapshot)),
  team_name_snapshot TEXT,
  elapsed_ms INTEGER,
  raw_value TEXT,
  sync_error_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'PROVISIONAL',
  idempotency_key TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revision INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT zero3_result_proof_registration_unique UNIQUE(event_id,proof_id,registration_id)
);

CREATE TABLE zero3_result_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  result_id TEXT NOT NULL REFERENCES zero3_results(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  previous_elapsed_ms INTEGER,
  previous_raw_value TEXT,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE zero3_timers (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'IDLE',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  preparation_ends_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  last_command_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE zero3_podium_versions (
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  registration_ids TEXT NOT NULL CHECK(json_valid(registration_ids)),
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
  published_by TEXT,
  published_at TEXT,
  publish_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(event_id,category,version)
);

CREATE TABLE zero3_members (
  email TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
