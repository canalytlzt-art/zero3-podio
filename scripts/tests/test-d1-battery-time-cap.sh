#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$ROOT/lib/db/d1-migrations"
TMP_DIR="$(mktemp -d)"
DB="$TMP_DIR/battery-time-cap.db"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v sqlite3 >/dev/null || {
  echo "sqlite3 is required for the battery time-cap migration regression test." >&2
  exit 1
}

for migration in "$MIGRATIONS"/*.sql; do
  [[ "$(basename "$migration")" == "0014_cancelled_battery_timer_state.sql" ||
     "$(basename "$migration")" == "0015_battery_duration_correction_audit.sql" ]] && continue
  sqlite3 -bail "$DB" < "$migration"
done

sqlite3 -bail "$DB" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO zero3_events(id,name,proof_name,categories)
VALUES('10000000-0000-4000-8000-000000000001','Timer fixture','Prova 1','["RX","SC"]');
INSERT INTO zero3_batteries(id,event_id,battery_order,name,scheduled_start_at)
VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Bateria de teste','2026-11-05T15:30:00.000Z');
INSERT INTO zero3_battery_runs(battery_id,event_id,state,elapsed_ms,started_at,version)
VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','PAUSED',12000,NULL,2);
INSERT INTO zero3_battery_time_cap_audit(
  id,event_id,battery_id,battery_id_snapshot,command_id,clerk_user_id,role,
  old_time_cap_ms,new_time_cap_ms
) VALUES(
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'cap-change-1','clerk_test_user','ADMIN',7200000,3600000
);
SQL

# Apply the timer-state expansion after a real pre-0014 timer row exists so
# this regression proves the migration preserves state and accumulated time.
sqlite3 -bail "$DB" < "$MIGRATIONS/0014_cancelled_battery_timer_state.sql"
sqlite3 -bail "$DB" < "$MIGRATIONS/0015_battery_duration_correction_audit.sql"

# A corrected duration can exceed its CAP without changing the CAP or the
# finished state, and the original/new values remain in a separate audit row.
sqlite3 -bail "$DB" <<'SQL'
INSERT INTO zero3_batteries(id,event_id,battery_order,name)
VALUES('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',4,'Duração corrigida');
INSERT INTO zero3_battery_runs(battery_id,event_id,state,elapsed_ms,started_at,stopped_at,first_started_at,version)
VALUES('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','FINISHED',7200000,NULL,'2026-11-05T17:00:00.000Z','2026-11-05T15:00:00.000Z',4);
INSERT INTO zero3_proofs(id,event_id,proof_order,name,metric_type,unit,direction)
VALUES('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Prova de reset','TIME','s','LOWER');
INSERT INTO zero3_registrations(id,event_id,category,team_name,athlete_ids,confirmation_status)
VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RX','Dupla de teste','[]','CONFIRMED');
INSERT INTO zero3_results(id,event_id,registration_id,proof_id,battery_id,category,
    athlete_ids_snapshot,athlete_names_snapshot,elapsed_ms,status,idempotency_key,
    published_status,published_elapsed_ms,published_revision)
VALUES('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004','RX','[]','[]',43123,'VALIDATED',
    'timer-reset-result','VALIDATED',43123,1);
UPDATE zero3_battery_runs SET elapsed_ms=7522350,version=version+1
WHERE battery_id='20000000-0000-4000-8000-000000000004' AND state='FINISHED' AND elapsed_ms=7200000 AND version=4;
INSERT INTO zero3_battery_duration_audit(
  id,event_id,battery_id,battery_id_snapshot,command_id,clerk_user_id,role,
  change_type,additional_ms,old_elapsed_ms,new_elapsed_ms,changed_at
) VALUES(
  '30000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000004',
  'duration-correction-1','clerk_test_admin','ADMIN','SET',0,7200000,7522350,'2026-11-05T17:01:00.000Z'
);
SQL

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
}

assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT time_cap_ms FROM zero3_batteries WHERE battery_order=1;")" "7200000" "existing batteries receive the 2-hour default"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_time_cap_audit WHERE event_id='10000000-0000-4000-8000-000000000001';")" "1" "CAP edit is auditable"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms || ':' || version FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000004';")" "FINISHED:7522350:5" "duration correction preserves finished state and can exceed CAP"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT old_elapsed_ms || ':' || new_elapsed_ms FROM zero3_battery_duration_audit WHERE command_id='duration-correction-1';")" "7200000:7522350" "duration correction retains old and new values"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT time_cap_ms FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000004';")" "7200000" "duration correction does not alter CAP"
sqlite3 -bail "$DB" <<'SQL'
UPDATE zero3_battery_runs SET elapsed_ms=9022350,version=version+1,last_command_id='time-add-finished-1'
WHERE battery_id='20000000-0000-4000-8000-000000000004'
  AND state='FINISHED' AND elapsed_ms=7522350 AND version=5;
INSERT INTO zero3_battery_duration_audit(
  id,event_id,battery_id,battery_id_snapshot,command_id,clerk_user_id,role,
  change_type,additional_ms,old_elapsed_ms,new_elapsed_ms,changed_at
) VALUES(
  '30000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000004',
  'time-add-finished-1','clerk_test_admin','ADMIN','ADD',1500000,7522350,9022350,'2026-11-05T17:02:00.000Z'
);
SQL
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms || ':' || version FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000004';")" "FINISHED:9022350:6" "adding to a finished timer remains stopped and can remain above CAP"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT change_type || ':' || additional_ms || ':' || old_elapsed_ms || ':' || new_elapsed_ms FROM zero3_battery_duration_audit WHERE command_id='time-add-finished-1';")" "ADD:1500000:7522350:9022350" "time addition records delta and before/after values"
sqlite3 -bail "$DB" <<'SQL'
INSERT OR IGNORE INTO zero3_battery_duration_audit(
  id,event_id,battery_id,battery_id_snapshot,command_id,clerk_user_id,role,
  change_type,additional_ms,old_elapsed_ms,new_elapsed_ms,changed_at
) VALUES(
  '30000000-0000-4000-8000-000000000015',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000004',
  'time-add-finished-1','clerk_test_admin','ADMIN','ADD',1500000,9022350,10522350,'2026-11-05T17:03:00.000Z'
);
SQL
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_duration_audit WHERE command_id='time-add-finished-1';")" "1" "repeated add command cannot duplicate its audit entry"

# Resetting a finished clock must not touch the existing official result or its
# published snapshot, and a delayed preparation callback must not revive it.
sqlite3 -bail "$DB" <<'SQL'
UPDATE zero3_battery_runs
SET state='IDLE',elapsed_ms=0,started_at=NULL,preparation_ends_at=NULL,
    preparation_started_at=NULL,stopped_at='2026-11-05T17:04:00.000Z',
    version=version+1,last_command_id='reset-finished-1'
WHERE battery_id='20000000-0000-4000-8000-000000000004'
  AND state='FINISHED' AND version=6;
UPDATE zero3_battery_runs SET state='RUNNING',started_at='2026-11-05T17:04:10.000Z'
WHERE battery_id='20000000-0000-4000-8000-000000000004'
  AND state='PREPARATION' AND version=6;
SQL
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms || ':' || version || ':' || first_started_at FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000004';")" "IDLE:0:7:2026-11-05T15:00:00.000Z" "reset clears only the run and retains first-start history"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT status || ':' || published_status || ':' || published_elapsed_ms || ':' || published_revision FROM zero3_results WHERE id='60000000-0000-4000-8000-000000000001';")" "VALIDATED:VALIDATED:43123:1" "reset preserves reviewed and published result fields"
sqlite3 -bail "$DB" <<'SQL'
INSERT INTO zero3_batteries(id,event_id,battery_order,name)
VALUES
  ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',5,'P01'),
  ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001',6,'P02');
INSERT INTO zero3_battery_runs(
  battery_id,event_id,state,elapsed_ms,started_at,first_started_at,version
) VALUES
  ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','RUNNING',0,'2026-11-05T12:00:00.000Z','2026-11-05T12:00:00.000Z',1),
  ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','RUNNING',0,'2026-11-05T12:08:00.000Z','2026-11-05T12:08:00.000Z',1);
-- P01: 10 minutes have elapsed; add 25 minutes without resetting started_at.
UPDATE zero3_battery_runs
SET elapsed_ms=1500000,version=version+1,last_command_id='time-add-p01'
WHERE battery_id='20000000-0000-4000-8000-000000000005'
  AND state='RUNNING' AND version=1 AND elapsed_ms=0;
INSERT INTO zero3_battery_duration_audit(
  id,event_id,battery_id,battery_id_snapshot,command_id,clerk_user_id,role,
  change_type,additional_ms,old_elapsed_ms,new_elapsed_ms,changed_at
) VALUES(
  '30000000-0000-4000-8000-000000000025',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000005',
  'time-add-p01','clerk_test_admin','ADMIN','ADD',1500000,600000,2100000,'2026-11-05T12:10:00.000Z'
);
-- P02: 2 minutes have elapsed; adding 118:20 reaches CAP and stops only P02.
UPDATE zero3_battery_runs
SET state='FINISHED',elapsed_ms=7200000,started_at=NULL,
    stopped_at='2026-11-05T12:10:00.000Z',version=version+1,
    last_command_id='time-add-p02'
WHERE battery_id='20000000-0000-4000-8000-000000000006'
  AND state='RUNNING' AND version=1 AND elapsed_ms=0;
INSERT INTO zero3_battery_duration_audit(
  id,event_id,battery_id,battery_id_snapshot,command_id,clerk_user_id,role,
  change_type,additional_ms,old_elapsed_ms,new_elapsed_ms,changed_at
) VALUES(
  '30000000-0000-4000-8000-000000000026',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000006',
  'time-add-p02','clerk_test_admin','ADMIN','ADD',7100000,120000,7200000,'2026-11-05T12:10:00.000Z'
);
SQL
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms || ':' || started_at || ':' || version FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000005';")" "RUNNING:1500000:2026-11-05T12:00:00.000Z:2" "adding time to P01 preserves its live start"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms || ':' || COALESCE(started_at,'') || ':' || version FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000006';")" "FINISHED:7200000::2" "P02 stops at its own CAP"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000005';")" "RUNNING" "P02 CAP does not stop P01"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT additional_ms || ':' || old_elapsed_ms || ':' || new_elapsed_ms FROM zero3_battery_duration_audit WHERE command_id='time-add-p01';")" "1500000:600000:2100000" "active addition audits effective before and after values"
sqlite3 -bail "$DB" <<'SQL'
UPDATE zero3_battery_runs
SET state='IDLE',elapsed_ms=0,started_at=NULL,preparation_ends_at=NULL,
    preparation_started_at=NULL,stopped_at='2026-11-05T12:11:00.000Z',
    version=version+1,last_command_id='reset-running-p01'
WHERE battery_id='20000000-0000-4000-8000-000000000005'
  AND state='RUNNING' AND version=2;
-- An old delayed start/pause callback has the stale version and cannot revive
-- or stop the reset timer.
UPDATE zero3_battery_runs SET state='RUNNING',started_at='2026-11-05T12:11:01.000Z'
WHERE battery_id='20000000-0000-4000-8000-000000000005'
  AND state='IDLE' AND version=2;
-- A fresh start is accepted from the new idle version, retaining history.
UPDATE zero3_battery_runs
SET state='RUNNING',elapsed_ms=0,started_at='2026-11-05T12:12:00.000Z',
    first_started_at=COALESCE(first_started_at,'2026-11-05T12:12:00.000Z'),
    stopped_at=NULL,version=version+1,last_command_id='restart-p01'
WHERE battery_id='20000000-0000-4000-8000-000000000005'
  AND state='IDLE' AND version=3;
SQL
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms || ':' || version || ':' || first_started_at FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000005';")" "RUNNING:0:4:2026-11-05T12:00:00.000Z" "fresh P01 start works after reset, while stale callbacks are rejected"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000006';")" "FINISHED:7200000" "restarting P01 does not alter P02"

assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT elapsed_ms FROM zero3_battery_runs WHERE state='PAUSED';")" "12000" "existing timer duration is preserved"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT scheduled_start_at FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000001';")" "2026-11-05T15:30:00.000Z" "scheduled start persists as a UTC instant"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_runs WHERE state='CANCELLED';")" "0" "migration does not change existing states"
sqlite3 -bail "$DB" <<'SQL'
INSERT INTO zero3_batteries(id,event_id,battery_order,name)
VALUES('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',3,'Bateria simultânea');
INSERT INTO zero3_battery_runs(battery_id,event_id,state,elapsed_ms,started_at,version)
VALUES('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','RUNNING',4000,'2026-11-05T15:30:10.000Z',1);
SQL
sqlite3 -bail "$DB" "UPDATE zero3_battery_runs SET state='CANCELLED' WHERE battery_id='20000000-0000-4000-8000-000000000001';"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000001';")" "CANCELLED:12000" "cancelled state preserves the captured duration"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT state || ':' || elapsed_ms FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000003';")" "RUNNING:4000" "another battery retains its independent active timer"

sqlite3 -bail "$DB" "UPDATE zero3_batteries SET scheduled_start_at='2026-11-05T16:30:00.000Z' WHERE id='20000000-0000-4000-8000-000000000001';"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT scheduled_start_at FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000001';")" "2026-11-05T16:30:00.000Z" "schedule edits persist independently"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT time_cap_ms FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000001';")" "7200000" "schedule edits do not change the CAP"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT elapsed_ms FROM zero3_battery_runs WHERE battery_id='20000000-0000-4000-8000-000000000001';")" "12000" "schedule edits do not change elapsed time"
assert_eq "$(sqlite3 -batch -noheader "$DB" 'PRAGMA foreign_key_check;')" "" "foreign-key integrity before delete"

sqlite3 -bail "$DB" "PRAGMA foreign_keys=ON; DELETE FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000001';"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_time_cap_audit WHERE battery_id IS NULL AND battery_id_snapshot='20000000-0000-4000-8000-000000000001';")" "1" "audit survives battery deletion"
sqlite3 -bail "$DB" "PRAGMA foreign_keys=ON; DELETE FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000004';"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_duration_audit WHERE battery_id IS NULL AND battery_id_snapshot='20000000-0000-4000-8000-000000000004';")" "2" "duration adjustment audit survives battery deletion"
assert_eq "$(sqlite3 -batch -noheader "$DB" 'PRAGMA foreign_key_check;')" "" "foreign-key integrity after delete"

sqlite3 -bail "$DB" "INSERT INTO zero3_batteries(id,event_id,battery_order,name) VALUES('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',2,'Cap validation');"
if sqlite3 -bail "$DB" "UPDATE zero3_batteries SET time_cap_ms=7200001 WHERE id='20000000-0000-4000-8000-000000000002';" >/dev/null 2>&1; then
  echo "FAIL: cap upper bound check unexpectedly accepted an out-of-range value" >&2
  exit 1
fi

echo "PASS: migrations, per-battery CAP, independent timer preservation, duration correction above CAP, and audit retention"
