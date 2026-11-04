ALTER TABLE zero3_battery_runs ADD COLUMN preparation_started_at TEXT;
ALTER TABLE zero3_battery_runs ADD COLUMN first_started_at TEXT;
ALTER TABLE zero3_battery_runs ADD COLUMN stopped_at TEXT;

UPDATE zero3_battery_runs
SET first_started_at = started_at
WHERE started_at IS NOT NULL;

UPDATE zero3_battery_runs
SET stopped_at = updated_at
WHERE state IN ('PAUSED','FINISHED')
  AND updated_at IS NOT NULL;
