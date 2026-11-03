import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import {
  ApplyZero3RosterImportBody,
  ApplyZero3RosterImportParams,
  ApplyZero3RosterImportResponse,
  GetZero3RosterManagementParams,
  GetZero3RosterManagementResponse,
  PreviewZero3RosterImportBody,
  PreviewZero3RosterImportParams,
  PreviewZero3RosterImportResponse,
  UpdateZero3RosterManagementBody,
  UpdateZero3RosterManagementParams,
  UpdateZero3RosterManagementResponse,
} from "@workspace/api-zod";
import {
  buildRosterImportPlan,
  rosterSourceContentHash,
  validateRosterManagementEdit,
  type RosterImportRegistration,
} from "./zero3-roster-import";
import { rosterSourcePeople, ZERO3_ROSTER_SOURCE } from "./zero3-roster-source";
import {
  d1ApiError,
  d1Date,
  d1IsoNow,
  d1JsonArray,
  newD1Id,
  requireD1Member,
} from "./d1-staging-shared";

type EventRow = {
  id: string; name: string; proof_name: string; status: string;
  preparation_seconds: number; created_at: string;
};
type AthleteRow = { id: string; full_name: string; created_at: string };
type RegistrationRow = {
  id: string; event_id: string; category: string; team_name: string | null;
  athlete_ids: string; lane_label: string | null; confirmation_status: string;
  payment_status: string; created_at: string;
};
type BatchRow = { id: string; content_hash: string };
type ImportPersonRow = { source_key: string; athlete_id: string };
type ImportTeamRow = { source_code: string; registration_id: string };

const ADMIN = ["ADMIN"] as const;
const parseJsonRecord = (value: string) => {
  try { return JSON.parse(value) as Record<string, unknown>; }
  catch { return {}; }
};
const eventDto = (row: EventRow) => ({
  id: row.id, name: row.name, proofName: row.proof_name,
  status: row.status, preparationSeconds: row.preparation_seconds,
  createdAt: d1Date(row.created_at),
});

function environmentLabel(req: Request) {
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").toLowerCase();
  if (host.includes("workers.dev")) return "Cloudflare Worker / D1";
  if (host.includes("replit.dev")) return "Replit Development";
  return "D1 local / Development";
}

async function rosterPlan(
  DB: D1Database,
  req: Request,
  eventId: string,
  scaleTargetCategory: "SC" | "SCALE",
  resolutions: Array<{ sourceKey: string; action: "CREATE" | "REUSE"; athleteId: string | null }>,
) {
  const event = await DB.prepare("SELECT * FROM zero3_events WHERE id=?").bind(eventId).first<EventRow>();
  if (!event) throw new Error("ROSTER_EVENT_NOT_FOUND");
  const [athletesResult, registrationsResult, batch] = await Promise.all([
    DB.prepare("SELECT id,full_name AS fullName FROM zero3_athletes").all<{ id: string; fullName: string }>(),
    DB.prepare("SELECT * FROM zero3_registrations WHERE event_id=?").bind(eventId).all<RegistrationRow>(),
    DB.prepare("SELECT id,content_hash FROM zero3_import_batches WHERE event_id=? AND dataset_key=? LIMIT 1")
      .bind(eventId, ZERO3_ROSTER_SOURCE.datasetKey).first<BatchRow>(),
  ]);
  const contentHash = await rosterSourceContentHash();
  if (batch && batch.content_hash !== contentHash) throw new Error("ROSTER_BATCH_SOURCE_CONFLICT");
  const [appliedPeople, appliedTeams] = batch
    ? await Promise.all([
        DB.prepare("SELECT source_key,athlete_id FROM zero3_import_people WHERE batch_id=?")
          .bind(batch.id).all<ImportPersonRow>(),
        DB.prepare("SELECT source_code,registration_id FROM zero3_import_teams WHERE batch_id=?")
          .bind(batch.id).all<ImportTeamRow>(),
      ])
    : [{ results: [] as ImportPersonRow[] }, { results: [] as ImportTeamRow[] }];
  const athleteRows = athletesResult.results.map((row) => ({ id: row.id, fullName: row.fullName }));
  const registrations: RosterImportRegistration[] = registrationsResult.results.map((row) => ({
    id: row.id, category: row.category, athleteIds: d1JsonArray(row.athlete_ids),
    confirmationStatus: row.confirmation_status, paymentStatus: row.payment_status,
  }));
  return buildRosterImportPlan({
    event: {
      id: event.id, name: event.name, proofName: event.proof_name,
      status: event.status as "PLANNED" | "ACTIVE" | "FINISHED",
      preparationSeconds: event.preparation_seconds, createdAt: new Date(event.created_at),
    },
    environment: environmentLabel(req),
    existingAthletes: athleteRows,
    existingRegistrations: registrations,
    resolutions,
    scaleTargetCategory,
    contentHash,
    alreadyApplied: Boolean(batch),
    appliedPeople: new Map(appliedPeople.results.map((row) => [row.source_key, row.athlete_id])),
    appliedRegistrations: new Map(appliedTeams.results.map((row) => [row.source_code, row.registration_id])),
  });
}

function insertMany(
  DB: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
  maxBindings = 80,
): D1PreparedStatement[] {
  if (!rows.length) return [];
  const chunkSize = Math.max(1, Math.floor(maxBindings / columns.length));
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const valuesSql = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    statements.push(DB.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES ${valuesSql}`)
      .bind(...chunk.flat()));
  }
  return statements;
}

function afterStateGuard(
  eventId: string,
  edits: Array<{
    registrationId: string; teamName: string | null; category: string;
    athleteIds: string[]; confirmationStatus: string; paymentStatus: string;
  }>,
): { sql: string; values: unknown[] } {
  const terms = edits.map(() =>
    "(id=? AND team_name IS ? AND category=? AND athlete_ids=? AND confirmation_status=? AND payment_status=?)",
  ).join(" OR ");
  const values = edits.flatMap((edit) => [
    edit.registrationId, edit.teamName, edit.category, JSON.stringify(edit.athleteIds),
    edit.confirmationStatus, edit.paymentStatus,
  ]);
  return {
    sql: `(SELECT COUNT(*) FROM zero3_registrations WHERE event_id=? AND (${terms}))=?`,
    values: [eventId, ...values, edits.length],
  };
}

function beforeStateGuard(
  eventId: string,
  rows: RegistrationRow[],
): { sql: string; values: unknown[] } {
  const terms = rows.map(() =>
    "(id=? AND team_name IS ? AND category=? AND athlete_ids=? AND confirmation_status=? AND payment_status=?)",
  ).join(" OR ");
  const values = rows.flatMap((row) => [
    row.id, row.team_name, row.category, row.athlete_ids, row.confirmation_status, row.payment_status,
  ]);
  return {
    sql: `(SELECT COUNT(*) FROM zero3_registrations WHERE event_id=? AND (${terms}))=?`,
    values: [eventId, ...values, rows.length],
  };
}

async function managedRows(DB: D1Database, eventId: string) {
  const registrations = await DB.prepare("SELECT * FROM zero3_registrations WHERE event_id=? ORDER BY created_at")
    .bind(eventId).all<RegistrationRow>();
  if (!registrations.results.length) return [];
  const registrationIds = registrations.results.map((row) => row.id);
  const athletes = await DB.prepare("SELECT id,full_name FROM zero3_athletes").all<{ id: string; full_name: string }>();
  const names = new Map(athletes.results.map((row) => [row.id, row.full_name]));
  const [resultCounts, sourceRows, auditRows] = await Promise.all([
    DB.prepare(`SELECT registration_id,COUNT(*) AS count FROM zero3_results
      WHERE registration_id IN (${registrationIds.map(() => "?").join(",")}) GROUP BY registration_id`)
      .bind(...registrationIds).all<{ registration_id: string; count: number }>(),
    DB.prepare(`SELECT registration_id,source_code FROM zero3_import_teams
      WHERE registration_id IN (${registrationIds.map(() => "?").join(",")})`)
      .bind(...registrationIds).all<{ registration_id: string; source_code: string }>(),
    DB.prepare(`SELECT * FROM zero3_registration_audit
      WHERE registration_id IN (${registrationIds.map(() => "?").join(",")})`)
      .bind(...registrationIds).all<{
        id: string; registration_id: string; actor_id: string; reason: string;
        before_state: string; after_state: string; created_at: string;
      }>(),
  ]);
  const resultCount = new Map(resultCounts.results.map((row) => [row.registration_id, row.count]));
  const sourceCodes = new Map<string, string[]>();
  for (const row of sourceRows.results) sourceCodes.set(row.registration_id, [...(sourceCodes.get(row.registration_id) ?? []), row.source_code]);
  const audit = new Map<string, typeof auditRows.results>();
  for (const row of auditRows.results) audit.set(row.registration_id, [...(audit.get(row.registration_id) ?? []), row]);
  return registrations.results.map((row) => {
    const athleteIds = d1JsonArray(row.athlete_ids);
    return {
      id: row.id, eventId: row.event_id, category: row.category,
      teamName: row.team_name, athleteIds,
      athleteNames: athleteIds.map((athleteId) => names.get(athleteId) ?? "Atleta não encontrado"),
      confirmationStatus: row.confirmation_status, paymentStatus: row.payment_status,
      resultCount: resultCount.get(row.id) ?? 0,
      sourceCodes: sourceCodes.get(row.id) ?? [], createdAt: d1Date(row.created_at),
      audit: (audit.get(row.id) ?? [])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((entry) => ({
          id: entry.id, actorId: entry.actor_id, reason: entry.reason,
          beforeState: parseJsonRecord(entry.before_state),
          afterState: parseJsonRecord(entry.after_state),
          createdAt: d1Date(entry.created_at),
        })),
    };
  });
}

export async function handleD1StagingRoster(
  req: Request,
  res: Response,
  DB: D1Database,
  allowRosterApply = false,
): Promise<boolean> {
  const route = req.path.slice("/api/zero3".length);

  const managementMatch = route.match(/^\/events\/([^/]+)\/roster-management$/);
  if (managementMatch && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, ADMIN)) return true;
    const params = GetZero3RosterManagementParams.safeParse({ eventId: managementMatch[1] });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return true; }
    try {
      const entries = await managedRows(DB, params.data.eventId);
      res.json(GetZero3RosterManagementResponse.parse(entries));
    } catch { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar as equipes."); }
    return true;
  }

  if (managementMatch && req.method === "PUT") {
    const member = await requireD1Member(req, res, DB, ADMIN);
    if (!member) return true;
    const params = UpdateZero3RosterManagementParams.safeParse({ eventId: managementMatch[1] });
    const body = UpdateZero3RosterManagementBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos." });
      return true;
    }
    const edits = body.data.edits;
    if (edits.length < 1 || edits.length > 2) {
      res.status(400).json({ error: "A operação deve conter uma ou duas equipes." }); return true;
    }
    const ids = edits.map((edit) => edit.registrationId);
    if (new Set(ids).size !== ids.length) { res.status(400).json({ error: "A mesma equipe não pode aparecer duas vezes na alteração." }); return true; }
    try {
      const event = await DB.prepare("SELECT id,categories FROM zero3_events WHERE id=?")
        .bind(params.data.eventId).first<{ id: string; categories: string }>();
      if (!event) { res.status(404).json({ error: "A edição selecionada não existe." }); return true; }
      const enabledCategories = new Set(d1JsonArray(event.categories));
      if (edits.some((edit) => !enabledCategories.has(edit.category))) {
        res.status(400).json({ error: "A categoria não está habilitada para este evento." });
        return true;
      }
      const currentResult = await DB.prepare(`SELECT * FROM zero3_registrations WHERE event_id=?
        AND id IN (${ids.map(() => "?").join(",")})`).bind(params.data.eventId, ...ids).all<RegistrationRow>();
      if (currentResult.results.length !== ids.length) { res.status(400).json({ error: "Uma equipe não pertence à edição selecionada." }); return true; }
      const currentById = new Map(currentResult.results.map((row) => [row.id, row]));
      const allCurrent = await DB.prepare("SELECT id,athlete_ids FROM zero3_registrations WHERE event_id=?")
        .bind(params.data.eventId).all<{ id: string; athlete_ids: string }>();
      const editedSet = new Set(ids);
      const occupiedElsewhere = allCurrent.results.filter((row) => !editedSet.has(row.id)).flatMap((row) => d1JsonArray(row.athlete_ids));
      const chosenAthletes = edits.flatMap((edit) => edit.athleteIds);
      if (new Set(chosenAthletes).size !== chosenAthletes.length || chosenAthletes.some((id) => occupiedElsewhere.includes(id))) {
        res.status(409).json({ error: "Um atleta não pode ocupar duas vagas nesta edição." }); return true;
      }
      const athleteRows = chosenAthletes.length
        ? await DB.prepare(`SELECT id FROM zero3_athletes WHERE id IN (${chosenAthletes.map(() => "?").join(",")})`).bind(...chosenAthletes).all<{ id: string }>()
        : { results: [] };
      const athleteSet = new Set(athleteRows.results.map((row) => row.id));
      for (const edit of edits) {
        const validation = validateRosterManagementEdit({ athleteIds: edit.athleteIds, existingAthleteIds: athleteSet });
        if (validation) { res.status(400).json({ error: validation }); return true; }
      }
      const resultRows = await DB.prepare(`SELECT registration_id,COUNT(*) AS count FROM zero3_results
        WHERE registration_id IN (${ids.map(() => "?").join(",")}) GROUP BY registration_id`)
        .bind(...ids).all<{ registration_id: string; count: number }>();
      const counts = new Map(resultRows.results.map((row) => [row.registration_id, row.count]));
      const planned = edits.map((edit) => {
        const row = currentById.get(edit.registrationId)!;
        const teamName = edit.teamName === undefined ? row.team_name : edit.teamName;
        const changed = edit.category !== row.category ||
          edit.athleteIds.join("|") !== d1JsonArray(row.athlete_ids).join("|");
        return { edit, row, teamName, changed, resultCount: counts.get(row.id) ?? 0 };
      });
      const withHistory = planned.filter((item) => item.changed && item.resultCount > 0);
      if (withHistory.length && !body.data.confirmHistoryImpact) {
        const total = withHistory.reduce((sum, item) => sum + item.resultCount, 0);
        res.status(409).json({ error: `Há ${total} resultado(s) ligado(s) à composição. Confirme explicitamente o impacto; o histórico anterior será preservado.` });
        return true;
      }
      const beforeGuard = beforeStateGuard(params.data.eventId, planned.map((item) => item.row));
      const updateAssignments = [
        ["team_name", planned.map((item) => [item.edit.registrationId, item.teamName])],
        ["category", planned.map((item) => [item.edit.registrationId, item.edit.category])],
        ["athlete_ids", planned.map((item) => [item.edit.registrationId, JSON.stringify(item.edit.athleteIds)])],
        ["confirmation_status", planned.map((item) => [item.edit.registrationId, item.edit.confirmationStatus])],
        ["payment_status", planned.map((item) => [item.edit.registrationId, item.edit.paymentStatus])],
      ] as Array<[string, unknown[][]]>;
      const setSql = updateAssignments.map(([column, pairs]) =>
        `${column}=CASE id ${pairs.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${column} END`,
      ).join(",");
      const setValues = updateAssignments.flatMap(([, pairs]) => pairs.flat());
      const idList = ids.map(() => "?").join(",");
      const updateSql = `UPDATE zero3_registrations SET ${setSql}
        WHERE event_id=? AND id IN (${idList})
        AND ${beforeGuard.sql}`;
      const updateValues = [
        ...setValues, params.data.eventId, ...ids,
        ...beforeGuard.values,
      ];
      const after = planned.map((item) => ({
        registrationId: item.edit.registrationId, teamName: item.teamName,
        category: item.edit.category, athleteIds: item.edit.athleteIds,
        confirmationStatus: item.edit.confirmationStatus, paymentStatus: item.edit.paymentStatus,
      }));
      const afterGuard = afterStateGuard(params.data.eventId, after);
      const stamp = d1IsoNow();
      const statements: D1PreparedStatement[] = [
        DB.prepare(updateSql).bind(...updateValues),
        DB.prepare(`DELETE FROM zero3_registration_members WHERE registration_id IN (${idList})
          AND ${afterGuard.sql}`).bind(...ids, ...afterGuard.values),
      ];
      for (const item of planned) {
        for (const [slot, athleteId] of item.edit.athleteIds.entries()) {
          statements.push(DB.prepare(`INSERT INTO zero3_registration_members(registration_id,event_id,athlete_id,slot)
            SELECT ?,?,?,? WHERE ${afterGuard.sql} ON CONFLICT DO NOTHING`)
            .bind(item.edit.registrationId, params.data.eventId, athleteId, slot + 1, ...afterGuard.values));
        }
        const before = {
          teamName: item.row.team_name, category: item.row.category,
          athleteIds: d1JsonArray(item.row.athlete_ids),
          confirmationStatus: item.row.confirmation_status, paymentStatus: item.row.payment_status,
        };
        const afterState = {
          teamName: item.teamName, category: item.edit.category, athleteIds: item.edit.athleteIds,
          confirmationStatus: item.edit.confirmationStatus, paymentStatus: item.edit.paymentStatus,
        };
        statements.push(DB.prepare(`INSERT INTO zero3_registration_audit
          (id,event_id,registration_id,actor_id,reason,before_state,after_state,created_at)
          SELECT ?,?,?,?,?,?,?,? WHERE ${afterGuard.sql}`)
          .bind(newD1Id(), params.data.eventId, item.edit.registrationId, getAuth(req).userId ?? member.clerk_user_id,
            item.edit.reason, JSON.stringify(before), JSON.stringify(afterState), stamp, ...afterGuard.values));
      }
      try { await DB.batch(statements); }
      catch {
        d1ApiError(req, res, 409, "ROSTER_CONFLICT", "A atualização conflitou com outra operação. Recarregue as equipes e tente novamente.");
        return true;
      }
      const verified = await DB.prepare(`SELECT * FROM zero3_registrations WHERE event_id=?
        AND id IN (${idList})`).bind(params.data.eventId, ...ids).all<RegistrationRow>();
      const afterById = new Map(after.map((row) => [row.registrationId, row]));
      const allApplied = verified.results.length === after.length && verified.results.every((row) => {
        const target = afterById.get(row.id)!;
        return row.category === target.category && row.team_name === target.teamName &&
          row.athlete_ids === JSON.stringify(target.athleteIds) &&
          row.confirmation_status === target.confirmationStatus &&
          row.payment_status === target.paymentStatus;
      });
      if (!allApplied) { d1ApiError(req, res, 409, "ROSTER_CONFLICT", "Uma equipe foi alterada por outra operação. Recarregue e tente novamente."); return true; }
      res.json(UpdateZero3RosterManagementResponse.parse({ registrations: await managedRows(DB, params.data.eventId) }));
    } catch { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível salvar as alterações das equipes."); }
    return true;
  }

  const previewMatch = route.match(/^\/events\/([^/]+)\/roster-import\/preview$/);
  if (previewMatch && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, ADMIN)) return true;
    const params = PreviewZero3RosterImportParams.safeParse({ eventId: previewMatch[1] });
    const body = PreviewZero3RosterImportBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos." });
      return true;
    }
    try {
      const plan = await rosterPlan(DB, req, params.data.eventId, body.data.scaleTargetCategory, body.data.resolutions);
      res.json(PreviewZero3RosterImportResponse.parse(plan));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message === "ROSTER_EVENT_NOT_FOUND") res.status(404).json({ error: "A edição selecionada não existe." });
      else if (message === "ROSTER_BATCH_SOURCE_CONFLICT") d1ApiError(req, res, 409, "ROSTER_SOURCE_CONFLICT", "O lote já aplicado tem conteúdo de origem diferente.");
      else res.status(400).json({ error: message || "Não foi possível gerar a prévia da importação." });
    }
    return true;
  }

  const applyMatch = route.match(/^\/events\/([^/]+)\/roster-import\/apply$/);
  if (applyMatch && req.method === "POST") {
    const member = await requireD1Member(req, res, DB, ADMIN);
    if (!member) return true;
    const params = ApplyZero3RosterImportParams.safeParse({ eventId: applyMatch[1] });
    const body = ApplyZero3RosterImportBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos." });
      return true;
    }
    if (!allowRosterApply && process.env.ZERO3_ROSTER_IMPORT_ENV !== "test") {
      d1ApiError(req, res, 403, "ROSTER_IMPORT_BLOCKED", "A aplicação da importação está desativada neste ambiente.");
      return true;
    }
    try {
      const expectedHash = await rosterSourceContentHash();
      if (body.data.contentHash !== expectedHash) {
        d1ApiError(req, res, 409, "ROSTER_SOURCE_CHANGED", "A planilha de origem mudou após a prévia. Gere uma nova prévia.");
        return true;
      }
      const event = await DB.prepare("SELECT * FROM zero3_events WHERE id=?").bind(params.data.eventId).first<EventRow>();
      if (!event) { res.status(404).json({ error: "A edição selecionada não existe." }); return true; }
      const isDemo = /demonstra|demo|teste|preview|homologa/i.test(event.name.toLocaleLowerCase("pt-BR"));
      if (isDemo && !body.data.confirmDemoEvent) {
        d1ApiError(req, res, 409, "ROSTER_DEMO_CONFIRMATION_REQUIRED", "Confirme explicitamente a inclusão no evento de demonstração.");
        return true;
      }
      const existingBatch = await DB.prepare("SELECT * FROM zero3_import_batches WHERE event_id=? AND dataset_key=? LIMIT 1")
        .bind(event.id, ZERO3_ROSTER_SOURCE.datasetKey).first<{
          id: string; content_hash: string; source_team_count: number; source_people_count: number;
        }>();
      if (existingBatch) {
        if (existingBatch.content_hash !== expectedHash) {
          d1ApiError(req, res, 409, "ROSTER_SOURCE_CONFLICT", "O lote aplicado contém outro conteúdo de origem. Nenhum dado foi alterado.");
          return true;
        }
        const [people, teams] = await Promise.all([
          DB.prepare("SELECT COUNT(*) AS count FROM zero3_import_people WHERE batch_id=?").bind(existingBatch.id).first<{ count: number }>(),
          DB.prepare("SELECT COUNT(*) AS count FROM zero3_import_teams WHERE batch_id=?").bind(existingBatch.id).first<{ count: number }>(),
        ]);
        const importedTeams = await DB.prepare("SELECT registration_id FROM zero3_import_teams WHERE batch_id=? ORDER BY source_row")
          .bind(existingBatch.id).all<{ registration_id: string }>();
        res.json(ApplyZero3RosterImportResponse.parse({
          batchId: existingBatch.id, alreadyApplied: true,
          createdPeople: 0, reusedPeople: people?.count ?? 0,
          createdTeams: 0, reusedTeams: teams?.count ?? 0,
          registrationIds: importedTeams.results.map((row) => row.registration_id),
        }));
        return true;
      }
      const plan = await rosterPlan(DB, req, event.id, body.data.scaleTargetCategory, body.data.resolutions);
      if (plan.counts.unresolvedPeople > 0 || plan.counts.conflicts > 0) {
        d1ApiError(req, res, 409, "ROSTER_REVIEW_REQUIRED", "A prévia contém conflitos ou identidades sem resolução. Revise antes de aplicar.");
        return true;
      }
      const sourcePeople = rosterSourcePeople();
      const resolutionByKey = new Map(body.data.resolutions.map((item) => [item.sourceKey, item]));
      const athleteIdBySourceKey = new Map<string, string>();
      const peopleToCreate: Array<{ id: string; fullName: string }> = [];
      let reusedPeople = 0;
      for (const person of sourcePeople) {
        const resolution = resolutionByKey.get(person.sourceKey);
        if (resolution?.action === "REUSE" && resolution.athleteId) {
          athleteIdBySourceKey.set(person.sourceKey, resolution.athleteId);
          reusedPeople += 1;
        } else {
          const athleteId = newD1Id();
          athleteIdBySourceKey.set(person.sourceKey, athleteId);
          peopleToCreate.push({ id: athleteId, fullName: person.fullName });
        }
      }
      const teamByCode = new Map(ZERO3_ROSTER_SOURCE.teams.map((team) => [team.code, team]));
      const registrationIdByCode = new Map<string, string>();
      const registrationsToCreate: Array<{
        id: string; code: string; category: string; athleteIds: string[];
      }> = [];
      let reusedTeams = 0;
      for (const team of plan.teams) {
        if (team.existingRegistrationId) {
          registrationIdByCode.set(team.sourceCode, team.existingRegistrationId);
          reusedTeams += 1;
          continue;
        }
        const source = teamByCode.get(team.sourceCode)!;
        const registrationId = newD1Id();
        const athleteIds = [
          athleteIdBySourceKey.get(`${source.code}:1`)!,
          athleteIdBySourceKey.get(`${source.code}:2`)!,
        ];
        registrationIdByCode.set(team.sourceCode, registrationId);
        registrationsToCreate.push({ id: registrationId, code: source.code, category: team.targetCategory, athleteIds });
      }
      const batchId = newD1Id();
      const stamp = d1IsoNow();
      const statements: D1PreparedStatement[] = [
        DB.prepare(`INSERT INTO zero3_import_batches
          (id,event_id,dataset_key,source_file,source_sheet,source_notes,content_hash,source_team_count,source_people_count,applied_by,applied_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(batchId, event.id, ZERO3_ROSTER_SOURCE.datasetKey, ZERO3_ROSTER_SOURCE.fileName,
            ZERO3_ROSTER_SOURCE.sheetName, JSON.stringify(ZERO3_ROSTER_SOURCE.excludedSourceNotes),
            expectedHash, ZERO3_ROSTER_SOURCE.teams.length, sourcePeople.length, member.clerk_user_id, stamp),
        ...insertMany(DB, "zero3_athletes", ["id", "full_name"], peopleToCreate.map((person) => [person.id, person.fullName])),
        ...insertMany(DB, "zero3_import_people",
          ["id", "batch_id", "source_key", "source_name", "source_cell", "athlete_id"],
          sourcePeople.map((person) => [newD1Id(), batchId, person.sourceKey, person.fullName, person.sourceCell, athleteIdBySourceKey.get(person.sourceKey)!])),
        ...insertMany(DB, "zero3_registrations",
          ["id", "event_id", "category", "team_name", "athlete_ids", "lane_label", "confirmation_status", "payment_status", "created_at"],
          registrationsToCreate.map((registration) => [
            registration.id, event.id, registration.category, null, JSON.stringify(registration.athleteIds),
            registration.code, "CONFIRMED", "PAID", stamp,
          ])),
        ...insertMany(DB, "zero3_registration_members",
          ["registration_id", "event_id", "athlete_id", "slot"],
          registrationsToCreate.flatMap((registration) => registration.athleteIds.map((athleteId, index) =>
            [registration.id, event.id, athleteId, index + 1])),
          80),
        ...insertMany(DB, "zero3_import_teams",
          ["id", "batch_id", "source_code", "source_category", "source_row", "source_cells", "source_athlete_names", "target_category", "registration_id"],
          plan.teams.map((team) => {
            const source = teamByCode.get(team.sourceCode)!;
            return [newD1Id(), batchId, team.sourceCode, team.sourceCategory, team.sourceRow,
              JSON.stringify(team.sourceCells), JSON.stringify(team.athleteNames), team.targetCategory,
              registrationIdByCode.get(team.sourceCode)!];
          })),
      ];
      try {
        await DB.batch(statements);
      } catch {
        const raced = await DB.prepare("SELECT content_hash FROM zero3_import_batches WHERE event_id=? AND dataset_key=? LIMIT 1")
          .bind(event.id, ZERO3_ROSTER_SOURCE.datasetKey).first<{ content_hash: string }>();
        if (raced?.content_hash === expectedHash) {
          d1ApiError(req, res, 409, "ROSTER_IMPORT_ALREADY_APPLIED", "A importação foi aplicada por outra operação. Atualize a prévia para confirmar o estado.");
        } else {
          d1ApiError(req, res, 409, "ROSTER_IMPORT_CONFLICT", "A importação conflitou com dados existentes; nenhuma gravação parcial foi mantida.");
        }
        return true;
      }
      res.json(ApplyZero3RosterImportResponse.parse({
        batchId, alreadyApplied: false,
        createdPeople: peopleToCreate.length, reusedPeople,
        createdTeams: registrationsToCreate.length, reusedTeams,
        registrationIds: plan.teams.map((team) => registrationIdByCode.get(team.sourceCode)!),
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message === "ROSTER_EVENT_NOT_FOUND") res.status(404).json({ error: "A edição selecionada não existe." });
      else if (message === "ROSTER_BATCH_SOURCE_CONFLICT") d1ApiError(req, res, 409, "ROSTER_SOURCE_CONFLICT", "O lote aplicado contém outra origem. Nenhum dado foi alterado.");
      else if (message.includes("resolução") || message.includes("mapeamento")) {
        d1ApiError(req, res, 400, "ROSTER_RESOLUTION_INVALID", "Revise as resoluções de pessoas antes de aplicar.");
      } else d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível aplicar a importação.");
    }
    return true;
  }

  return false;
}
