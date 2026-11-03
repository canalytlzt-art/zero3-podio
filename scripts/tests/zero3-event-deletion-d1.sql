-- Development-only, fictional D1 integration fixture.
-- Run only with wrangler d1 execute --local and a temporary --persist-to path.
INSERT INTO zero3_events(id,name,proof_name,status,categories)
VALUES
  ('10000000-0000-4000-8000-000000000001','TESTE EXCLUSÃO ZERO3','Prova fictícia','ACTIVE','["SC","RX"]'),
  ('10000000-0000-4000-8000-000000000002','TESTE EVENTO PRESERVADO','Prova','PLANNED','["SC"]');
INSERT INTO zero3_athletes(id,full_name) VALUES
  ('20000000-0000-4000-8000-000000000001','Atleta Teste Um'),
  ('20000000-0000-4000-8000-000000000002','Atleta Teste Dois'),
  ('20000000-0000-4000-8000-000000000003','Atleta Evento Preservado');
INSERT INTO zero3_proofs(id,event_id,proof_order,name,metric_type,unit,direction) VALUES
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Prova Teste','TIME','s','LOWER'),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',1,'Prova','TIME','s','LOWER');
INSERT INTO zero3_registrations(id,event_id,category,team_name,athlete_ids,lane_label)
VALUES
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RX','Dupla Teste','["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002"]','T01'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','SC','Dupla Preservada','["20000000-0000-4000-8000-000000000003"]','P01');
INSERT INTO zero3_registration_members(registration_id,event_id,athlete_id,slot) VALUES
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1),
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',2),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',1);
INSERT INTO zero3_registration_audit(id,event_id,registration_id,actor_id,reason,before_state,after_state)
VALUES ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','test-admin','teste','{}','{}');
INSERT INTO zero3_import_batches(id,event_id,dataset_key,source_file,source_sheet,content_hash,source_team_count,source_people_count,applied_by)
VALUES ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fixture','fixture.csv','Sheet1','hash',1,2,'test-admin');
INSERT INTO zero3_import_people(id,batch_id,source_key,source_name,source_cell,athlete_id)
VALUES ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','person-1','Atleta Teste Um','A1','20000000-0000-4000-8000-000000000001');
INSERT INTO zero3_import_teams(id,batch_id,source_code,source_category,source_row,source_cells,source_athlete_names,target_category,registration_id)
VALUES ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','team-1','RX',1,'["Um","Dois"]','["Atleta Teste Um","Atleta Teste Dois"]','RX','40000000-0000-4000-8000-000000000001');
INSERT INTO zero3_heats(id,event_id,category,name,"order")
VALUES ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RX','Bateria Teste',1);
INSERT INTO zero3_heat_entries(heat_id,registration_id,lane_label)
VALUES ('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','T01');
INSERT INTO zero3_active_heats(event_id,category,heat_id)
VALUES ('10000000-0000-4000-8000-000000000001','RX','80000000-0000-4000-8000-000000000001');
INSERT INTO zero3_results(id,event_id,registration_id,proof_id,heat_id,category,lane_label,athlete_ids_snapshot,athlete_names_snapshot,elapsed_ms,status,idempotency_key)
VALUES ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','RX','T01','["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002"]','["Atleta Teste Um","Atleta Teste Dois"]',123456,'PROVISIONAL','fixture-test-result');
INSERT INTO zero3_result_revisions(id,result_id,previous_status,reason,actor_id)
VALUES ('a0000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','PROVISIONAL','teste','test-admin');
INSERT INTO zero3_timers(event_id,state,elapsed_ms) VALUES ('10000000-0000-4000-8000-000000000001','PAUSED',123456);
INSERT INTO zero3_podium_versions(event_id,category,registration_ids,published,published_by,version)
VALUES ('10000000-0000-4000-8000-000000000001','RX','["40000000-0000-4000-8000-000000000001"]',1,'test-admin',1);

-- Same dependent-first order used by the Worker endpoint; the audit row is minimal.
INSERT INTO zero3_event_deletion_audit(id,event_id,event_name,actor_id,backup_digest,record_counts)
VALUES ('b0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','TESTE EXCLUSÃO ZERO3','test-admin','fixture-digest','{"event":1}');
DELETE FROM zero3_registration_audit WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_import_batches WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_active_heats WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_timers WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_results WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_heats WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_proofs WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_registrations WHERE event_id='10000000-0000-4000-8000-000000000001';
DELETE FROM zero3_events WHERE id='10000000-0000-4000-8000-000000000001';

SELECT
  (SELECT COUNT(*) FROM zero3_events WHERE id='10000000-0000-4000-8000-000000000001') AS deleted_event_count,
  (SELECT COUNT(*) FROM zero3_events WHERE id='10000000-0000-4000-8000-000000000002') AS preserved_event_count,
  (SELECT COUNT(*) FROM zero3_athletes) AS preserved_global_athlete_count,
  (SELECT COUNT(*) FROM zero3_registrations WHERE event_id='10000000-0000-4000-8000-000000000001') AS deleted_registration_count,
  (SELECT COUNT(*) FROM zero3_registration_audit WHERE event_id='10000000-0000-4000-8000-000000000001') AS deleted_registration_audit_count,
  (SELECT COUNT(*) FROM zero3_import_batches WHERE event_id='10000000-0000-4000-8000-000000000001') AS deleted_import_batch_count,
  (SELECT COUNT(*) FROM zero3_import_people) AS deleted_import_person_count,
  (SELECT COUNT(*) FROM zero3_import_teams) AS deleted_import_team_count,
  (SELECT COUNT(*) FROM zero3_heats WHERE event_id='10000000-0000-4000-8000-000000000001') AS deleted_heat_count,
  (SELECT COUNT(*) FROM zero3_heat_entries) AS deleted_heat_entry_count,
  (SELECT COUNT(*) FROM zero3_results) AS deleted_result_count,
  (SELECT COUNT(*) FROM zero3_result_revisions) AS deleted_result_revision_count,
  (SELECT COUNT(*) FROM zero3_timers WHERE event_id='10000000-0000-4000-8000-000000000001') AS deleted_timer_count,
  (SELECT COUNT(*) FROM zero3_podium_versions WHERE event_id='10000000-0000-4000-8000-000000000001') AS deleted_podium_count,
  (SELECT COUNT(*) FROM zero3_event_deletion_audit WHERE event_id='10000000-0000-4000-8000-000000000001') AS retained_minimal_audit_count;
