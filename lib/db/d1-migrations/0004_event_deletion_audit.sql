CREATE TABLE zero3_event_deletion_audit (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  backup_digest TEXT NOT NULL,
  record_counts TEXT NOT NULL CHECK(json_valid(record_counts)),
  deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX zero3_event_deletion_audit_event_idx
  ON zero3_event_deletion_audit(event_id, deleted_at);
