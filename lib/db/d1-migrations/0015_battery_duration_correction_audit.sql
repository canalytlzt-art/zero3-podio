CREATE TABLE IF NOT EXISTS zero3_battery_duration_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  battery_id TEXT REFERENCES zero3_batteries(id) ON DELETE SET NULL,
  battery_id_snapshot TEXT NOT NULL,
  command_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'ADMIN'),
  change_type TEXT NOT NULL DEFAULT 'SET' CHECK (change_type IN ('SET', 'ADD')),
  additional_ms INTEGER NOT NULL DEFAULT 0 CHECK (additional_ms >= 0),
  old_elapsed_ms INTEGER NOT NULL CHECK (old_elapsed_ms >= 0),
  new_elapsed_ms INTEGER NOT NULL CHECK (new_elapsed_ms >= 0),
  changed_at TEXT NOT NULL,
  UNIQUE (event_id, command_id)
);

CREATE INDEX IF NOT EXISTS zero3_battery_duration_audit_event_idx
  ON zero3_battery_duration_audit(event_id, changed_at);

CREATE INDEX IF NOT EXISTS zero3_battery_duration_audit_battery_idx
  ON zero3_battery_duration_audit(battery_id_snapshot, changed_at);
