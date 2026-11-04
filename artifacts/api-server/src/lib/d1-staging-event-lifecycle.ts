import {
  DeleteZero3EventBody,
  DeleteZero3EventResponse,
  GetZero3EventDeletionBackupParams,
  GetZero3EventDeletionBackupResponse,
  RestoreZero3EventBackupBody,
  RestoreZero3EventBackupResponse,
} from "@workspace/api-zod";
import type { Request, Response } from "express";
import {
  createZero3EventBackup,
  validateZero3EventBackup,
  type EventBackupRow,
  type Zero3EventBackup,
} from "./zero3-event-archive";
import { d1ApiError, newD1Id, requireD1Member } from "./d1-staging-shared";

type EventRow = EventBackupRow & { id: string; name: string };
type Rows = { results: EventBackupRow[] };

const adminOnly = ["ADMIN"] as const;

function isD1IntegrityConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint failed|constraint violation|foreign key|unique constraint/i.test(message);
}

const RESTORE_DEFINITIONS = [
  { collection: "proofs", table: "zero3_proofs", columns: ["id", "event_id", "proof_order", "name", "metric_type", "unit", "direction", "created_at", "updated_at"] },
  { collection: "registrations", table: "zero3_registrations", columns: ["id", "event_id", "category", "team_name", "athlete_ids", "lane_label", "confirmation_status", "payment_status", "created_at"] },
  { collection: "registrationMembers", table: "zero3_registration_members", columns: ["registration_id", "event_id", "athlete_id", "slot", "created_at"] },
  { collection: "registrationAudit", table: "zero3_registration_audit", columns: ["id", "event_id", "registration_id", "actor_id", "reason", "before_state", "after_state", "created_at"] },
  { collection: "importBatches", table: "zero3_import_batches", columns: ["id", "event_id", "dataset_key", "source_file", "source_sheet", "source_notes", "content_hash", "source_team_count", "source_people_count", "applied_by", "applied_at"] },
  { collection: "importPeople", table: "zero3_import_people", columns: ["id", "batch_id", "source_key", "source_name", "source_cell", "athlete_id", "created_at"] },
  { collection: "importTeams", table: "zero3_import_teams", columns: ["id", "batch_id", "source_code", "source_category", "source_row", "source_cells", "source_athlete_names", "target_category", "registration_id", "created_at"] },
  { collection: "heats", table: "zero3_heats", columns: ["id", "event_id", "category", "name", "order", "proof_id", "battery_order"] },
  { collection: "heatEntries", table: "zero3_heat_entries", columns: ["heat_id", "registration_id", "lane_label", "assigned_at"] },
  { collection: "activeHeats", table: "zero3_active_heats", columns: ["event_id", "category", "heat_id", "updated_at"] },
  { collection: "results", table: "zero3_results", columns: ["id", "event_id", "registration_id", "proof_id", "heat_id", "category", "lane_label", "athlete_ids_snapshot", "athlete_names_snapshot", "team_name_snapshot", "elapsed_ms", "raw_value", "sync_error_ms", "status", "idempotency_key", "captured_at", "revision"] },
  { collection: "resultRevisions", table: "zero3_result_revisions", columns: ["id", "result_id", "previous_status", "previous_elapsed_ms", "previous_raw_value", "reason", "actor_id", "created_at"] },
  { collection: "timers", table: "zero3_timers", columns: ["event_id", "state", "elapsed_ms", "started_at", "preparation_ends_at", "version", "last_command_id", "updated_at"] },
  { collection: "podiumVersions", table: "zero3_podium_versions", columns: ["event_id", "category", "registration_ids", "published", "published_by", "published_at", "publish_reason", "version", "updated_at"] },
  { collection: "heatRuns", table: "zero3_heat_runs", columns: ["event_id", "proof_id", "battery_order", "state", "elapsed_ms", "started_at", "preparation_ends_at", "version", "last_command_id", "updated_at"] },
  { collection: "heatPublications", table: "zero3_heat_publications", columns: ["id", "event_id", "proof_id", "battery_order", "version", "result_fingerprint", "result_count", "results_json", "leaderboards_json", "published_by", "published_at"] },
] as const;

const COUNT_GUARDS: Array<{ key: string; query: string }> = [
  { key: "proofs", query: "SELECT COUNT(*) FROM zero3_proofs WHERE event_id=?" },
  { key: "registrations", query: "SELECT COUNT(*) FROM zero3_registrations WHERE event_id=?" },
  { key: "registrationMembers", query: "SELECT COUNT(*) FROM zero3_registration_members WHERE event_id=?" },
  { key: "registrationAudit", query: "SELECT COUNT(*) FROM zero3_registration_audit WHERE event_id=?" },
  { key: "importBatches", query: "SELECT COUNT(*) FROM zero3_import_batches WHERE event_id=?" },
  { key: "importPeople", query: "SELECT COUNT(*) FROM zero3_import_people p JOIN zero3_import_batches b ON b.id=p.batch_id WHERE b.event_id=?" },
  { key: "importTeams", query: "SELECT COUNT(*) FROM zero3_import_teams t JOIN zero3_import_batches b ON b.id=t.batch_id WHERE b.event_id=?" },
  { key: "heats", query: "SELECT COUNT(*) FROM zero3_heats WHERE event_id=?" },
  { key: "heatEntries", query: "SELECT COUNT(DISTINCT h.heat_id || ':' || h.registration_id) FROM zero3_heat_entries h JOIN zero3_heats x ON x.id=h.heat_id WHERE x.event_id=?" },
  { key: "activeHeats", query: "SELECT COUNT(*) FROM zero3_active_heats WHERE event_id=?" },
  { key: "results", query: "SELECT COUNT(*) FROM zero3_results WHERE event_id=?" },
  { key: "resultRevisions", query: "SELECT COUNT(*) FROM zero3_result_revisions v JOIN zero3_results r ON r.id=v.result_id WHERE r.event_id=?" },
  { key: "timers", query: "SELECT COUNT(*) FROM zero3_timers WHERE event_id=?" },
  { key: "podiumVersions", query: "SELECT COUNT(*) FROM zero3_podium_versions WHERE event_id=?" },
  { key: "heatRuns", query: "SELECT COUNT(*) FROM zero3_heat_runs WHERE event_id=?" },
  { key: "heatPublications", query: "SELECT COUNT(*) FROM zero3_heat_publications WHERE event_id=?" },
];

async function fetchD1EventBackupData(
  DB: D1Database,
  eventId: string,
): Promise<{ event: EventRow; data: Zero3EventBackup["data"] } | null> {
  const event = await DB.prepare("SELECT * FROM zero3_events WHERE id=?")
    .bind(eventId).first<EventRow>();
  if (!event) return null;

  const [
    proofs, registrations, registrationMembers, registrationAudit, importBatches,
    heats, activeHeats, results, timers, podiumVersions, heatRuns, heatPublications,
  ] = await Promise.all([
    DB.prepare("SELECT * FROM zero3_proofs WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_registrations WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_registration_members WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_registration_audit WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_import_batches WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_heats WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_active_heats WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_results WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_timers WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_podium_versions WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_heat_runs WHERE event_id=?").bind(eventId).all(),
    DB.prepare("SELECT * FROM zero3_heat_publications WHERE event_id=? ORDER BY proof_id,battery_order,version").bind(eventId).all(),
  ]) as Rows[];

  const [
    importPeople, importTeams, heatEntries, resultRevisions, athletes,
  ] = await Promise.all([
    DB.prepare(`SELECT p.* FROM zero3_import_people p
      JOIN zero3_import_batches b ON b.id=p.batch_id WHERE b.event_id=?`).bind(eventId).all(),
    DB.prepare(`SELECT t.* FROM zero3_import_teams t
      JOIN zero3_import_batches b ON b.id=t.batch_id WHERE b.event_id=?`).bind(eventId).all(),
    DB.prepare(`SELECT DISTINCT h.* FROM zero3_heat_entries h
      LEFT JOIN zero3_heats x ON x.id=h.heat_id
      LEFT JOIN zero3_registrations r ON r.id=h.registration_id
      WHERE x.event_id=? OR r.event_id=?`).bind(eventId, eventId).all(),
    DB.prepare(`SELECT v.* FROM zero3_result_revisions v
      JOIN zero3_results r ON r.id=v.result_id WHERE r.event_id=?`).bind(eventId).all(),
    DB.prepare(`SELECT DISTINCT a.* FROM zero3_athletes a
      WHERE EXISTS (SELECT 1 FROM zero3_registration_members m WHERE m.event_id=? AND m.athlete_id=a.id)
      OR EXISTS (SELECT 1 FROM zero3_import_people p JOIN zero3_import_batches b ON b.id=p.batch_id WHERE b.event_id=? AND p.athlete_id=a.id)
      OR EXISTS (SELECT 1 FROM zero3_registrations r, json_each(r.athlete_ids) j WHERE r.event_id=? AND j.value=a.id)`)
      .bind(eventId, eventId, eventId).all(),
  ]) as Rows[];

  const data = {
    event,
    athletes: athletes.results,
    proofs: proofs.results,
    registrations: registrations.results,
    registrationMembers: registrationMembers.results,
    registrationAudit: registrationAudit.results,
    importBatches: importBatches.results,
    importPeople: importPeople.results,
    importTeams: importTeams.results,
    heats: heats.results,
    heatEntries: heatEntries.results,
    activeHeats: activeHeats.results,
    results: results.results,
    resultRevisions: resultRevisions.results,
    timers: timers.results,
    podiumVersions: podiumVersions.results,
    heatRuns: heatRuns.results,
    heatPublications: heatPublications.results,
  };
  return { event, data };
}

async function createD1EventBackup(DB: D1Database, eventId: string) {
  const loaded = await fetchD1EventBackupData(DB, eventId);
  return loaded ? createZero3EventBackup(loaded.event, loaded.data) : null;
}

function restoreStatements(DB: D1Database, backup: Zero3EventBackup): D1PreparedStatement[] {
  const athleteInsert = DB.prepare(`INSERT INTO zero3_athletes(id,full_name,created_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.full_name'),json_extract(value,'$.created_at')
    FROM json_each(?) WHERE 1 ON CONFLICT(id) DO NOTHING`).bind(JSON.stringify(backup.data.athletes));
  const eventInsert = DB.prepare(`INSERT INTO zero3_events(id,name,proof_name,status,preparation_seconds,categories,created_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.proof_name'),
      json_extract(value,'$.status'),json_extract(value,'$.preparation_seconds'),
      json_extract(value,'$.categories'),json_extract(value,'$.created_at') FROM json_each(?) WHERE 1`)
    .bind(JSON.stringify([backup.data.event]));
  const inserts = RESTORE_DEFINITIONS.map(({ collection, table, columns }) => {
    const fields = columns.map((column) => `json_extract(value,'$.${column}')`).join(",");
    return DB.prepare(`INSERT INTO ${table}(${columns.join(",")}) SELECT ${fields} FROM json_each(?) WHERE 1`)
      .bind(JSON.stringify(backup.data[collection]));
  });
  return [athleteInsert, eventInsert, ...inserts];
}

function eventIdFromRoute(route: string): string | null {
  const match = route.match(/^\/events\/([^/]+)$/);
  return match?.[1] ?? null;
}

export async function handleD1StagingEventLifecycle(
  req: Request,
  res: Response,
  DB: D1Database,
): Promise<boolean> {
  const route = req.path.slice("/api/zero3".length);

  if (route === "/events/restore" && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, adminOnly)) return true;
    const parsed = RestoreZero3EventBackupBody.safeParse(req.body);
    const checked = await validateZero3EventBackup((req.body as { backup?: unknown } | undefined)?.backup);
    if (!parsed.success || !checked.ok) {
      d1ApiError(req, res, 400, "EVENT_BACKUP_INVALID",
        checked.ok ? "O arquivo de backup é inválido." : checked.reason);
      return true;
    }
    try {
      const backup = checked.backup;
      if (await DB.prepare("SELECT id FROM zero3_events WHERE id=?").bind(backup.eventId).first()) {
        d1ApiError(req, res, 409, "EVENT_RESTORE_CONFLICT", "Já existe um evento com esse ID.");
        return true;
      }
      const existingAthletes = await DB.prepare(`SELECT id,full_name FROM zero3_athletes
        WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`)
        .bind(JSON.stringify(backup.data.athletes)).all<{id:string; full_name:string}>();
      const names = new Map(existingAthletes.results.map((row) => [row.id, row.full_name]));
      if (backup.data.athletes.some((athlete) =>
        names.has(String(athlete.id)) && names.get(String(athlete.id)) !== athlete.full_name)) {
        d1ApiError(req, res, 409, "ATHLETE_RESTORE_CONFLICT",
          "Um atleta global com o mesmo ID tem dados diferentes. Nenhum registro foi restaurado.");
        return true;
      }
      await DB.batch(restoreStatements(DB, backup));
      res.status(201).json(RestoreZero3EventBackupResponse.parse({
        eventId: backup.eventId, restored: true,
      }));
    } catch (error) {
      if (isD1IntegrityConflict(error)) {
        d1ApiError(req, res, 409, "EVENT_RESTORE_CONFLICT",
          "A restauração encontrou um conflito de integridade; nenhum registro foi sobrescrito.");
      } else {
        d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE",
          "Não foi possível restaurar o backup por indisponibilidade do banco.");
      }
    }
    return true;
  }

  const backupMatch = route.match(/^\/events\/([^/]+)\/deletion-backup$/);
  if (backupMatch && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, adminOnly)) return true;
    const params = GetZero3EventDeletionBackupParams.safeParse({ eventId: backupMatch[1] });
    if (!params.success) {
      d1ApiError(req, res, 400, "EVENT_ID_INVALID", "ID de evento inválido.");
      return true;
    }
    try {
      const backup = await createD1EventBackup(DB, params.data.eventId);
      if (!backup) { d1ApiError(req, res, 404, "EVENT_NOT_FOUND", "Evento não encontrado."); return true; }
      res.json(GetZero3EventDeletionBackupResponse.parse(backup));
    } catch {
      d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível gerar o backup do evento.");
    }
    return true;
  }

  const eventId = eventIdFromRoute(route);
  if (eventId && req.method === "DELETE") {
    const member = await requireD1Member(req, res, DB, adminOnly);
    if (!member) return true;
    const params = DeleteZero3EventBody.safeParse(req.body);
    if (!params.success) {
      d1ApiError(req, res, 400, "EVENT_DELETE_CONFIRMATION_INVALID", "Informe a confirmação e o digest do backup.");
      return true;
    }
    try {
      const backup = await createD1EventBackup(DB, eventId);
      if (!backup) { d1ApiError(req, res, 404, "EVENT_NOT_FOUND", "Evento não encontrado."); return true; }
      if (params.data.confirmation !== `EXCLUIR ${backup.eventName}`) {
        d1ApiError(req, res, 409, "EVENT_DELETE_CONFIRMATION_MISMATCH",
          `Digite exatamente EXCLUIR ${backup.eventName} para confirmar.`);
        return true;
      }
      if (params.data.backupDigest !== backup.digest) {
        d1ApiError(req, res, 409, "EVENT_BACKUP_STALE",
          "Os dados mudaram desde o backup. Baixe um novo JSON antes de excluir.");
        return true;
      }
      const auditId = newD1Id();
      const predicates = COUNT_GUARDS.map(({ query }) =>
        `(${query})=?`).join(" AND ");
      const guardBindings = COUNT_GUARDS.flatMap(({ key }) => [
        eventId,
        backup.counts[key] ?? 0,
      ]);
      const audit = DB.prepare(`INSERT INTO zero3_event_deletion_audit
        (id,event_id,event_name,actor_id,backup_digest,record_counts,deleted_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM zero3_events WHERE id=? AND ${predicates}
        )`).bind(
        auditId, eventId, backup.eventName, member.clerk_user_id, backup.digest,
        JSON.stringify(backup.counts), new Date().toISOString(), eventId, ...guardBindings,
      );
      const guard = "EXISTS (SELECT 1 FROM zero3_event_deletion_audit WHERE id=?)";
      const statements = [
        audit,
        DB.prepare(`DELETE FROM zero3_registration_audit WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_import_batches WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_active_heats WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_timers WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_results WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_heats WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_proofs WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_registrations WHERE event_id=? AND ${guard}`).bind(eventId, auditId),
        DB.prepare(`DELETE FROM zero3_events WHERE id=? AND ${guard}`).bind(eventId, auditId),
      ];
      const results = await DB.batch(statements);
      if ((results.at(-1)?.meta.changes ?? 0) !== 1) {
        d1ApiError(req, res, 409, "EVENT_DELETE_CONFLICT",
          "O evento mudou durante a exclusão. Nenhum dado foi removido; gere um novo backup.");
        return true;
      }
      res.json(DeleteZero3EventResponse.parse({ eventId, deleted: true }));
    } catch {
      d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE",
        "Não foi possível excluir o evento. Nenhuma exclusão parcial foi confirmada.");
    }
    return true;
  }

  return false;
}
