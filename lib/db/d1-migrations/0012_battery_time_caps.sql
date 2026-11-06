ALTER TABLE zero3_batteries
  ADD COLUMN time_cap_ms INTEGER NOT NULL DEFAULT 7200000
  CHECK (time_cap_ms > 0 AND time_cap_ms <= 7200000);

CREATE TABLE zero3_battery_time_cap_audit (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  battery_id TEXT REFERENCES zero3_batteries(id) ON DELETE SET NULL,
  battery_id_snapshot TEXT NOT NULL,
  command_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','JUIZ_CHEFE')),
  old_time_cap_ms INTEGER NOT NULL CHECK (old_time_cap_ms > 0),
  new_time_cap_ms INTEGER NOT NULL CHECK (new_time_cap_ms > 0),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_battery_time_cap_command_unique UNIQUE (event_id, command_id)
);

CREATE INDEX zero3_battery_time_cap_audit_latest_idx
  ON zero3_battery_time_cap_audit(event_id, battery_id_snapshot, changed_at DESC);
