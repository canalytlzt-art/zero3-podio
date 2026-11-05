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
  sqlite3 -bail "$DB" < "$migration"
done

sqlite3 -bail "$DB" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO zero3_events(id,name,proof_name,categories)
VALUES('10000000-0000-4000-8000-000000000001','Timer fixture','Prova 1','["RX","SC"]');
INSERT INTO zero3_batteries(id,event_id,battery_order,name)
VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Bateria de teste');
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

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
}

assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT time_cap_ms FROM zero3_batteries WHERE battery_order=1;")" "7200000" "existing batteries receive the 2-hour default"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_time_cap_audit WHERE event_id='10000000-0000-4000-8000-000000000001';")" "1" "CAP edit is auditable"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT elapsed_ms FROM zero3_battery_runs WHERE state='PAUSED';")" "12000" "existing timer duration is preserved"
assert_eq "$(sqlite3 -batch -noheader "$DB" 'PRAGMA foreign_key_check;')" "" "foreign-key integrity before delete"

sqlite3 -bail "$DB" "PRAGMA foreign_keys=ON; DELETE FROM zero3_batteries WHERE id='20000000-0000-4000-8000-000000000001';"
assert_eq "$(sqlite3 -batch -noheader "$DB" "SELECT COUNT(*) FROM zero3_battery_time_cap_audit WHERE battery_id IS NULL AND battery_id_snapshot='20000000-0000-4000-8000-000000000001';")" "1" "audit survives battery deletion"
assert_eq "$(sqlite3 -batch -noheader "$DB" 'PRAGMA foreign_key_check;')" "" "foreign-key integrity after delete"

sqlite3 -bail "$DB" "INSERT INTO zero3_batteries(id,event_id,battery_order,name) VALUES('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',2,'Cap validation');"
if sqlite3 -bail "$DB" "UPDATE zero3_batteries SET time_cap_ms=7200001 WHERE id='20000000-0000-4000-8000-000000000002';" >/dev/null 2>&1; then
  echo "FAIL: cap upper bound check unexpectedly accepted an out-of-range value" >&2
  exit 1
fi

echo "PASS: migration chain, two-hour default, time-cap audit, timer preservation, and audit retention after battery deletion"
