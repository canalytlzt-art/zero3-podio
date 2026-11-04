-- The operational battery belongs to an event, not to one proof/category.
-- The approved staging mapping unions RX and SC rows with the same event/order.
-- Keep all legacy heat/result rows and IDs as history.

CREATE TABLE zero3_event_battery_migration_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO zero3_event_battery_migration_guard(ok)
SELECT CASE WHEN
  EXISTS (
    SELECT 1
    FROM zero3_heats h
    JOIN zero3_heat_entries he ON he.heat_id = h.id
    GROUP BY h.event_id, he.registration_id
    HAVING COUNT(DISTINCT COALESCE(h.battery_order, h."order")) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM zero3_heats h
    JOIN zero3_heat_entries he ON he.heat_id = h.id
    GROUP BY h.event_id, COALESCE(h.battery_order, h."order"), he.registration_id
    HAVING COUNT(DISTINCT COALESCE(he.lane_label, '')) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM zero3_heat_runs
    GROUP BY event_id, battery_order
    HAVING COUNT(*) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM zero3_active_heats ah
    JOIN zero3_heats h ON h.id = ah.heat_id
    GROUP BY ah.event_id
    HAVING COUNT(DISTINCT COALESCE(h.battery_order, h."order")) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM zero3_results r
    JOIN zero3_heats h ON h.id = r.heat_id
    WHERE r.event_id <> h.event_id
  )
  OR EXISTS (
    -- Different registration sets are expected across RX and SC rows. Do not
    -- infer a union between same-category rows or unsupported categories.
    SELECT 1
    FROM zero3_heats a
    JOIN zero3_heats b
      ON b.event_id = a.event_id
     AND COALESCE(b.battery_order, b."order") = COALESCE(a.battery_order, a."order")
     AND b.id > a.id
    WHERE
      (
        a.category = b.category
        OR a.category NOT IN ('RX','SC')
        OR b.category NOT IN ('RX','SC')
      )
      AND
      (
        EXISTS (
          SELECT he.registration_id
          FROM zero3_heat_entries he
          WHERE he.heat_id = a.id
          EXCEPT
          SELECT he.registration_id
          FROM zero3_heat_entries he
          WHERE he.heat_id = b.id
        )
        OR EXISTS (
          SELECT he.registration_id
          FROM zero3_heat_entries he
          WHERE he.heat_id = b.id
          EXCEPT
          SELECT he.registration_id
          FROM zero3_heat_entries he
          WHERE he.heat_id = a.id
        )
      )
  )
  OR EXISTS (
    -- A source row's category must agree with the event registration.
    SELECT 1
    FROM zero3_heats h
    JOIN zero3_heat_entries he ON he.heat_id = h.id
    JOIN zero3_registrations r ON r.id = he.registration_id
    WHERE r.event_id <> h.event_id OR r.category <> h.category
  )
  OR EXISTS (
    -- Results must retain their proof association. Proof-less source rows with
    -- results need an explicit review before they can be mapped.
    SELECT 1
    FROM zero3_results r
    JOIN zero3_heats h ON h.id = r.heat_id
    WHERE r.proof_id IS NOT h.proof_id
  )
  OR EXISTS (
    -- A registration/proof may not have results in multiple source rows for
    -- the same event battery; retaining both would make the cell ambiguous.
    SELECT 1
    FROM zero3_results r
    JOIN zero3_heats h ON h.id = r.heat_id
    GROUP BY h.event_id, COALESCE(h.battery_order, h."order"),
             r.registration_id, r.proof_id
    HAVING COUNT(DISTINCT r.heat_id) > 1
  )
THEN 0 ELSE 1 END;

DROP TABLE zero3_event_battery_migration_guard;

CREATE TABLE zero3_batteries (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  battery_order INTEGER NOT NULL CHECK (battery_order > 0),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_event_battery_order_unique UNIQUE (event_id, battery_order)
);

INSERT INTO zero3_batteries(id, event_id, battery_order, name)
SELECT MIN(id), event_id, COALESCE(battery_order, "order"),
       'Bateria ' || printf('%02d', COALESCE(battery_order, "order"))
FROM zero3_heats
GROUP BY event_id, COALESCE(battery_order, "order");

CREATE TABLE zero3_battery_entries (
  battery_id TEXT NOT NULL REFERENCES zero3_batteries(id) ON DELETE CASCADE,
  registration_id TEXT NOT NULL UNIQUE REFERENCES zero3_registrations(id) ON DELETE CASCADE,
  lane_label TEXT,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (battery_id, registration_id)
);

INSERT INTO zero3_battery_entries(battery_id, registration_id, lane_label, assigned_at)
SELECT b.id, he.registration_id, MIN(he.lane_label), MIN(he.assigned_at)
FROM zero3_heats h
JOIN zero3_batteries b
  ON b.event_id = h.event_id
 AND b.battery_order = COALESCE(h.battery_order, h."order")
JOIN zero3_heat_entries he ON he.heat_id = h.id
GROUP BY b.id, he.registration_id;

CREATE INDEX zero3_battery_entry_registration_idx
  ON zero3_battery_entries(registration_id);

CREATE TABLE zero3_active_batteries (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  battery_id TEXT REFERENCES zero3_batteries(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO zero3_active_batteries(event_id, battery_id, updated_at)
SELECT ah.event_id, MIN(b.id), MAX(ah.updated_at)
FROM zero3_active_heats ah
JOIN zero3_heats h ON h.id = ah.heat_id
JOIN zero3_batteries b
  ON b.event_id = h.event_id
 AND b.battery_order = COALESCE(h.battery_order, h."order")
GROUP BY ah.event_id;

CREATE TABLE zero3_battery_runs (
  battery_id TEXT PRIMARY KEY NOT NULL REFERENCES zero3_batteries(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'IDLE'
    CHECK (state IN ('IDLE','PREPARATION','RUNNING','PAUSED','FINISHED')),
  elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
  started_at TEXT,
  preparation_ends_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_command_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO zero3_battery_runs(
  battery_id,event_id,state,elapsed_ms,started_at,preparation_ends_at,version,last_command_id,updated_at
)
SELECT b.id,r.event_id,r.state,r.elapsed_ms,r.started_at,r.preparation_ends_at,
       r.version,r.last_command_id,r.updated_at
FROM zero3_heat_runs r
JOIN zero3_batteries b
  ON b.event_id = r.event_id
 AND b.battery_order = r.battery_order;

CREATE TABLE zero3_battery_publications (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES zero3_events(id) ON DELETE CASCADE,
  battery_id TEXT NOT NULL REFERENCES zero3_batteries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  result_fingerprint TEXT NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count > 0),
  results_json TEXT NOT NULL CHECK (json_valid(results_json)),
  leaderboards_json TEXT NOT NULL CHECK (json_valid(leaderboards_json)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT zero3_battery_publication_version_unique UNIQUE (battery_id, version),
  CONSTRAINT zero3_battery_publication_fingerprint_unique UNIQUE (battery_id, result_fingerprint)
);

CREATE INDEX zero3_battery_publication_latest_idx
  ON zero3_battery_publications(battery_id, version DESC);

ALTER TABLE zero3_results ADD COLUMN battery_id TEXT
  REFERENCES zero3_batteries(id) ON DELETE SET NULL;

UPDATE zero3_results
SET battery_id = (
  SELECT b.id
  FROM zero3_heats h
  JOIN zero3_batteries b
    ON b.event_id = h.event_id
   AND b.battery_order = COALESCE(h.battery_order, h."order")
  WHERE h.id = zero3_results.heat_id
)
WHERE heat_id IS NOT NULL;

CREATE INDEX zero3_result_battery_proof_idx
  ON zero3_results(battery_id, proof_id, registration_id);
