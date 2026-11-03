CREATE TABLE zero3_event_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  event_id uuid NOT NULL,
  event_name text NOT NULL,
  actor_id text NOT NULL,
  backup_digest text NOT NULL,
  record_counts jsonb NOT NULL,
  deleted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX zero3_event_deletion_audit_event_idx
  ON zero3_event_deletion_audit(event_id, deleted_at);
