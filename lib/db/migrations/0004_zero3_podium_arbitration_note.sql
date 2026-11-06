BEGIN;

ALTER TABLE zero3_podium_versions
  ADD COLUMN IF NOT EXISTS arbitration_note text;

COMMIT;
