BEGIN;

-- Additive roster migration. Existing registration and result IDs are retained.
ALTER TABLE zero3_registrations
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'UNVERIFIED';

ALTER TABLE zero3_results
  ADD COLUMN IF NOT EXISTS athlete_ids_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS athlete_names_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS team_name_snapshot text;

UPDATE zero3_results AS result
SET athlete_ids_snapshot = registration.athlete_ids,
    athlete_names_snapshot = COALESCE((
      SELECT jsonb_agg(athlete.full_name ORDER BY member.ordinality)
      FROM jsonb_array_elements_text(registration.athlete_ids)
        WITH ORDINALITY AS member(athlete_id, ordinality)
      JOIN zero3_athletes AS athlete ON athlete.id = member.athlete_id::uuid
    ), '[]'::jsonb),
    team_name_snapshot = registration.team_name
FROM zero3_registrations AS registration
WHERE result.registration_id = registration.id
  AND (
    result.athlete_ids_snapshot = '[]'::jsonb
    OR result.athlete_names_snapshot = '[]'::jsonb
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'zero3_registrations'::regclass
      AND conname = 'zero3_registration_id_event_unique'
  ) THEN
    IF to_regclass('zero3_registration_id_event_unique') IS NOT NULL THEN
      ALTER TABLE zero3_registrations
        ADD CONSTRAINT zero3_registration_id_event_unique
        UNIQUE USING INDEX zero3_registration_id_event_unique;
    ELSE
      ALTER TABLE zero3_registrations
        ADD CONSTRAINT zero3_registration_id_event_unique UNIQUE (id, event_id);
    END IF;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS zero3_registration_members (
  registration_id uuid NOT NULL,
  event_id uuid NOT NULL,
  athlete_id uuid NOT NULL REFERENCES zero3_athletes(id) ON DELETE RESTRICT,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registration_id, slot),
  CONSTRAINT zero3_registration_member_event_fk
    FOREIGN KEY (registration_id, event_id)
    REFERENCES zero3_registrations(id, event_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS zero3_registration_member_unique
  ON zero3_registration_members (registration_id, athlete_id);
CREATE UNIQUE INDEX IF NOT EXISTS zero3_event_athlete_unique
  ON zero3_registration_members (event_id, athlete_id);

INSERT INTO zero3_registration_members (registration_id, event_id, athlete_id, slot)
SELECT registration.id, registration.event_id, member.athlete_id::uuid, member.ordinality::integer
FROM zero3_registrations AS registration
CROSS JOIN LATERAL jsonb_array_elements_text(registration.athlete_ids)
  WITH ORDINALITY AS member(athlete_id, ordinality)
ON CONFLICT (registration_id, slot) DO NOTHING;

CREATE TABLE IF NOT EXISTS zero3_registration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES zero3_events(id) ON DELETE RESTRICT,
  registration_id uuid NOT NULL REFERENCES zero3_registrations(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  reason text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zero3_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES zero3_events(id) ON DELETE RESTRICT,
  dataset_key text NOT NULL,
  source_file text NOT NULL,
  source_sheet text NOT NULL,
  source_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  source_team_count integer NOT NULL,
  source_people_count integer NOT NULL,
  applied_by text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zero3_import_batch_event_dataset_unique
  ON zero3_import_batches (event_id, dataset_key);

CREATE TABLE IF NOT EXISTS zero3_import_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES zero3_import_batches(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_name text NOT NULL,
  source_cell text NOT NULL,
  athlete_id uuid NOT NULL REFERENCES zero3_athletes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zero3_import_person_source_unique
  ON zero3_import_people (batch_id, source_key);

CREATE TABLE IF NOT EXISTS zero3_import_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES zero3_import_batches(id) ON DELETE CASCADE,
  source_code text NOT NULL,
  source_category text NOT NULL,
  source_row integer NOT NULL,
  source_cells jsonb NOT NULL,
  source_athlete_names jsonb NOT NULL,
  target_category text NOT NULL,
  registration_id uuid NOT NULL REFERENCES zero3_registrations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zero3_import_team_source_unique
  ON zero3_import_teams (batch_id, source_code);
CREATE UNIQUE INDEX IF NOT EXISTS zero3_import_registration_unique
  ON zero3_import_teams (batch_id, registration_id);

COMMIT;
