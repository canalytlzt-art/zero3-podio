ALTER TABLE zero3_batteries ADD COLUMN operational_finalized_at TEXT;
ALTER TABLE zero3_batteries ADD COLUMN operational_finalized_by TEXT;

-- Preserve the existing operational state of batteries that had already
-- been published before finalization and ranking publication were separated.
UPDATE zero3_batteries
SET operational_finalized_at = (
      SELECT published_at
      FROM zero3_battery_publications
      WHERE battery_id = zero3_batteries.id
      ORDER BY version DESC
      LIMIT 1
    ),
    operational_finalized_by = (
      SELECT published_by
      FROM zero3_battery_publications
      WHERE battery_id = zero3_batteries.id
      ORDER BY version DESC
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1 FROM zero3_battery_publications
  WHERE battery_id = zero3_batteries.id
)
AND EXISTS (
  SELECT 1 FROM zero3_battery_runs
  WHERE battery_id = zero3_batteries.id AND state = 'FINISHED'
);
