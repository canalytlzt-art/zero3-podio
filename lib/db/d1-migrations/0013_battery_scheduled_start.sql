-- Scheduled start is a Brasília civil time stored as a UTC instant.
-- It is independent from the actual timer start stored in zero3_battery_runs.
ALTER TABLE zero3_batteries ADD COLUMN scheduled_start_at TEXT;

CREATE INDEX zero3_battery_scheduled_start_idx
  ON zero3_batteries(event_id, scheduled_start_at);
