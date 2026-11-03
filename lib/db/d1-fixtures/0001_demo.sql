-- Fictional, non-official records for isolated D1 migration checks only.
INSERT INTO zero3_events
  (id,name,proof_name,status,preparation_seconds,created_at)
VALUES
  ('00000000-0000-4000-8000-000000000001',
   'FIXTURE D1 · NÃO OFICIAL','Quatro provas sintéticas','ACTIVE',10,
   '2026-01-01T12:00:00.000Z');

INSERT INTO zero3_proofs
  (id,event_id,proof_order,name,metric_type,unit,direction,created_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',1,'Fixture 1','TIME','ms','LOWER','2026-01-01T12:00:00.000Z','2026-01-01T12:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001',2,'Fixture 2','REPETITIONS','reps','HIGHER','2026-01-01T12:00:00.000Z','2026-01-01T12:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001',3,'Fixture 3','LOAD','kg','HIGHER','2026-01-01T12:00:00.000Z','2026-01-01T12:00:00.000Z'),
  ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001',4,'Fixture 4','CUSTOM','points','HIGHER','2026-01-01T12:00:00.000Z','2026-01-01T12:00:00.000Z');

INSERT INTO zero3_athletes(id,full_name,created_at)
VALUES ('00000000-0000-4000-8000-000000000021','Atleta Fixture Zero3','2026-01-01T12:00:00.000Z');

INSERT INTO zero3_registrations
  (id,event_id,category,team_name,athlete_ids,lane_label,confirmation_status,payment_status,created_at)
VALUES
  ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','RX','Equipe Fixture','["00000000-0000-4000-8000-000000000021"]','RX-01','CONFIRMED','PAID','2026-01-01T12:00:00.000Z');

INSERT INTO zero3_registration_members(registration_id,event_id,athlete_id,slot,created_at)
VALUES ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021',1,'2026-01-01T12:00:00.000Z');

INSERT INTO zero3_results
  (id,event_id,registration_id,proof_id,category,lane_label,athlete_ids_snapshot,athlete_names_snapshot,team_name_snapshot,elapsed_ms,raw_value,status,idempotency_key,captured_at,revision)
VALUES
  ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011','RX','RX-01','["00000000-0000-4000-8000-000000000021"]','["Atleta Fixture Zero3"]','Equipe Fixture',65500,'65.500','VALIDATED','fixture-result-proof-1','2026-01-01T12:05:00.000Z',1);

INSERT INTO zero3_timers
  (event_id,state,elapsed_ms,version,updated_at)
VALUES ('00000000-0000-4000-8000-000000000001','IDLE',0,0,'2026-01-01T12:00:00.000Z');

INSERT INTO zero3_podium_versions
  (event_id,category,registration_ids,published,published_by,published_at,publish_reason,version,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000001','RX','["00000000-0000-4000-8000-000000000031"]',1,'fixture-admin','2026-01-01T12:06:00.000Z','Fixture sintética, sem efeito oficial',1,'2026-01-01T12:06:00.000Z');
