#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$ROOT/lib/db/d1-migrations"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

command -v sqlite3 >/dev/null || {
  echo "sqlite3 is required for the D1 migration regression test." >&2
  exit 1
}

apply_base_migrations() {
  local db="$1"
  sqlite3 "$db" <<SQL
.bail on
PRAGMA foreign_keys = ON;
.read $MIGRATIONS/0001_zero3_initial.sql
.read $MIGRATIONS/0002_members_clerk_user_id.sql
.read $MIGRATIONS/0003_event_categories.sql
.read $MIGRATIONS/0004_event_deletion_audit.sql
.read $MIGRATIONS/0005_heat_proof_runs.sql
.read $MIGRATIONS/0006_heat_publications.sql
SQL
}

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
}

valid_db="$TMP_DIR/approved-rx-sc-union.db"
apply_base_migrations "$valid_db"
sqlite3 "$valid_db" <<'SQL'
.bail on
PRAGMA foreign_keys = ON;
INSERT INTO zero3_events(id,name,proof_name,categories)
VALUES('10000000-0000-4000-8000-000000000001','Fixture','Prova 1','["RX","SC"]');
INSERT INTO zero3_proofs(id,event_id,proof_order,name,metric_type,unit,direction) VALUES
  ('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Prova 1','TIME','s','LOWER'),
  ('11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',2,'Prova 2','TIME','s','LOWER'),
  ('11000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',3,'Prova 3','TIME','s','LOWER'),
  ('11000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',4,'Prova 4','TIME','s','LOWER');
INSERT INTO zero3_athletes(id,full_name) VALUES
  ('20000000-0000-4000-8000-000000000001','Fictício RX 1'),
  ('20000000-0000-4000-8000-000000000002','Fictício RX 2'),
  ('20000000-0000-4000-8000-000000000003','Fictício SC 1'),
  ('20000000-0000-4000-8000-000000000004','Fictício SC 2'),
  ('20000000-0000-4000-8000-000000000005','Fictício SC 3');
INSERT INTO zero3_registrations(id,event_id,category,team_name,athlete_ids,lane_label,confirmation_status) VALUES
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RX','Dupla RX 1','["20000000-0000-4000-8000-000000000001"]','RX-01','CONFIRMED'),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','RX','Dupla RX 2','["20000000-0000-4000-8000-000000000002"]','RX-02','CONFIRMED'),
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','SC','Dupla SC 1','["20000000-0000-4000-8000-000000000003"]','SC-01','CONFIRMED'),
  ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','SC','Dupla SC 2','["20000000-0000-4000-8000-000000000004"]','SC-02','CONFIRMED'),
  ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','SC','Dupla SC 3','["20000000-0000-4000-8000-000000000005"]','SC-03','CONFIRMED');
INSERT INTO zero3_registration_members(registration_id,event_id,athlete_id,slot) VALUES
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',1),
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',1),
  ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004',1),
  ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005',1);
INSERT INTO zero3_heats(id,event_id,category,name,"order",proof_id,battery_order) VALUES
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RX','RX source row',1,'11000000-0000-4000-8000-000000000001',1),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','SC','SC source row',1,'11000000-0000-4000-8000-000000000001',1),
  ('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','SC','Legacy no-proof row',2,NULL,2);
INSERT INTO zero3_heat_entries(heat_id,registration_id,lane_label) VALUES
  ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','RX-01'),
  ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','RX-02'),
  ('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','SC-01'),
  ('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000004','SC-02'),
  ('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000005','SC-03');
INSERT INTO zero3_active_heats(event_id,category,heat_id) VALUES
  ('10000000-0000-4000-8000-000000000001','RX','50000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000001','SC','50000000-0000-4000-8000-000000000002');
INSERT INTO zero3_heat_runs(event_id,proof_id,battery_order,state,elapsed_ms)
VALUES('10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',1,'PAUSED',12000);
INSERT INTO zero3_results(id,event_id,registration_id,proof_id,heat_id,category,lane_label,
  athlete_ids_snapshot,athlete_names_snapshot,raw_value,elapsed_ms,status,idempotency_key) VALUES
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','RX','RX-01','["20000000-0000-4000-8000-000000000001"]','["Fictício RX 1"]','50.000',50000,'VALIDATED','fixture-result-1'),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','RX','RX-02','["20000000-0000-4000-8000-000000000002"]','["Fictício RX 2"]','51.000',51000,'VALIDATED','fixture-result-2'),
  ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','SC','SC-01','["20000000-0000-4000-8000-000000000003"]','["Fictício SC 1"]','52.000',52000,'VALIDATED','fixture-result-3'),
  ('60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','SC','SC-02','["20000000-0000-4000-8000-000000000004"]','["Fictício SC 2"]','53.000',53000,'VALIDATED','fixture-result-4');
INSERT INTO zero3_heat_publications(id,event_id,proof_id,battery_order,version,result_fingerprint,
  result_count,results_json,leaderboards_json,published_by)
VALUES('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',1,1,'legacy-fingerprint',4,'[]','[]','fixture-judge');
SQL

sqlite3 "$valid_db" <<SQL
.bail on
.read $MIGRATIONS/0007_event_scoped_batteries.sql
.read $MIGRATIONS/0008_allow_republished_fingerprint.sql
.read $MIGRATIONS/0009_battery_timer_audit_times.sql
SQL

scalar() { sqlite3 -batch -noheader "$valid_db" "$1"; }
assert_eq "$(scalar 'SELECT COUNT(*) FROM zero3_batteries;')" "2" "logical battery count"
assert_eq "$(scalar "SELECT COUNT(*) FROM zero3_battery_entries be JOIN zero3_batteries b ON b.id=be.battery_id WHERE b.battery_order=1;")" "4" "RX+SC union entry count"
assert_eq "$(scalar "SELECT COUNT(*) FROM zero3_battery_entries be JOIN zero3_batteries b ON b.id=be.battery_id WHERE b.battery_order=2;")" "1" "legacy no-proof entry count"
assert_eq "$(scalar 'SELECT COUNT(*) FROM zero3_heats;')" "3" "legacy heat history"
assert_eq "$(scalar 'SELECT COUNT(*) FROM zero3_heat_entries;')" "5" "legacy entry history"
assert_eq "$(scalar 'SELECT COUNT(*) FROM zero3_results;')" "4" "result row preservation"
assert_eq "$(scalar "SELECT COUNT(*) FROM zero3_results WHERE battery_id IS NOT NULL AND status='VALIDATED';")" "4" "result battery links and status"
assert_eq "$(scalar 'SELECT COUNT(*) FROM zero3_heat_publications;')" "1" "legacy publication preservation"
assert_eq "$(scalar "SELECT battery_order FROM zero3_batteries WHERE id=(SELECT battery_id FROM zero3_active_batteries WHERE event_id='10000000-0000-4000-8000-000000000001');")" "1" "active battery mapping"
assert_eq "$(scalar "SELECT elapsed_ms FROM zero3_battery_runs WHERE battery_id=(SELECT id FROM zero3_batteries WHERE battery_order=1) AND event_id='10000000-0000-4000-8000-000000000001';")" "12000" "timer duration preservation"
assert_eq "$(sqlite3 -batch -noheader "$valid_db" 'PRAGMA foreign_key_check;')" "" "foreign-key integrity"

ambiguous_db="$TMP_DIR/same-category-divergence.db"
apply_base_migrations "$ambiguous_db"
sqlite3 "$ambiguous_db" <<'SQL'
.bail on
INSERT INTO zero3_events(id,name,proof_name,categories)
VALUES('80000000-0000-4000-8000-000000000001','Ambiguous fixture','Prova 1','["RX","SC"]');
INSERT INTO zero3_proofs(id,event_id,proof_order,name,metric_type,direction) VALUES
  ('81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',1,'Prova 1','TIME','LOWER'),
  ('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001',2,'Prova 2','TIME','LOWER');
INSERT INTO zero3_athletes(id,full_name) VALUES
  ('82000000-0000-4000-8000-000000000001','Fixture A'),
  ('82000000-0000-4000-8000-000000000002','Fixture B');
INSERT INTO zero3_registrations(id,event_id,category,athlete_ids) VALUES
  ('83000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','RX','["82000000-0000-4000-8000-000000000001"]'),
  ('83000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','RX','["82000000-0000-4000-8000-000000000002"]');
INSERT INTO zero3_heats(id,event_id,category,name,"order",proof_id,battery_order) VALUES
  ('84000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','RX','RX proof 1',1,'81000000-0000-4000-8000-000000000001',1),
  ('84000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','RX','RX proof 2',2,'81000000-0000-4000-8000-000000000002',1);
INSERT INTO zero3_heat_entries(heat_id,registration_id) VALUES
  ('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001'),
  ('84000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002');
SQL

if sqlite3 -bail "$ambiguous_db" < "$MIGRATIONS/0007_event_scoped_batteries.sql" >/dev/null 2>&1; then
  echo "FAIL: same-category registration divergence should block migration" >&2
  exit 1
fi

echo "PASS: approved RX+SC union, no-proof legacy battery, result/timer/history preservation, and ambiguity guard"
