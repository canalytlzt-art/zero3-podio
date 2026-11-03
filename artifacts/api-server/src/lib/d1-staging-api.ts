import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import type { RequestHandler } from "express";
import {
  CaptureZero3ResultBody,
  CaptureZero3ResultResponse,
  GetZero3DashboardResponse,
  GetZero3MeResponse,
  GetZero3PublicBoardQueryParams,
  GetZero3PublicBoardResponse,
  ListZero3EventsResponse,
  ListZero3ProofsResponse,
  ListZero3RegistrationsResponse,
  UpdateZero3ResultBody,
  UpdateZero3ResultParams,
  UpdateZero3ResultResponse,
} from "@workspace/api-zod";
import { hasSignedInUserSession } from "./auth-session";
import { workerLogger } from "./worker-logger";
import { calculateAllResultPlacements } from "./zero3-scoring";
import { handleD1StagingAdmin } from "./d1-staging-admin";
import { handleD1StagingControls } from "./d1-staging-controls";
import { handleD1StagingRoster } from "./d1-staging-roster";

type D1Env = { DB: D1Database };
type Member = { clerk_user_id: string; email: string; role: string; active: number };
type EventRow = {
  id: string; name: string; proof_name: string; status: string;
  preparation_seconds: number; created_at: string;
};
type ProofRow = {
  id: string; event_id: string; proof_order: number; name: string;
  metric_type: string; unit: string | null; direction: string | null;
  created_at: string; updated_at: string;
};
type RegistrationRow = {
  id: string; event_id: string; category: string; team_name: string | null;
  athlete_ids: string; lane_label: string | null; created_at: string;
};
type ResultRow = {
  id: string; event_id: string; registration_id: string; proof_id: string | null;
  heat_id: string | null; category: string; lane_label: string | null;
  athlete_ids_snapshot: string; athlete_names_snapshot: string;
  team_name_snapshot: string | null; elapsed_ms: number | null;
  raw_value: string | null; sync_error_ms: number | null; status: string;
  idempotency_key: string; captured_at: string; revision: number;
};
class ClerkLookupFailure extends Error {}

const jsonArray = (value: string | null | undefined): string[] => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
};
const nullableStringArray = (value: string | null | undefined): Array<string | null> => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => typeof item === "string" ? item : null)
      : [];
  } catch {
    return [];
  }
};
const date = (value: string | null | undefined) => value ? new Date(value) : null;
const id = () => crypto.randomUUID();
const requestId = (req: Request) => (req as Request & { id?: string }).id;
const error = (res: Response, status: number, code: string, message: string, req: Request) =>
  res.status(status).json({ code, error: message, ...(requestId(req) ? { requestId: requestId(req) } : {}) });

async function memberForRequest(req: Request, DB: D1Database): Promise<Member | null> {
  const auth = getAuth(req);
  if (!hasSignedInUserSession(auth) || !auth.userId) return null;
  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try { user = await clerkClient.users.getUser(auth.userId); }
  catch (cause) { throw new ClerkLookupFailure("Clerk user lookup failed", { cause }); }
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") return null;
  const member = await DB.prepare(
    "SELECT clerk_user_id, email, role, active FROM zero3_members WHERE clerk_user_id = ? LIMIT 1",
  ).bind(auth.userId).first<Member>();
  return member?.email.toLowerCase() === primary.emailAddress.toLowerCase()
    ? member
    : null;
}

async function requireD1Role(
  req: Request, res: Response, DB: D1Database, roles: string[],
): Promise<Member | null | false> {
  const auth = getAuth(req);
  if (!hasSignedInUserSession(auth)) {
    error(res, 401, "SESSION_INVALID", "Sessão inválida.", req);
    return false;
  }
  try {
    const member = await memberForRequest(req, DB);
    if (!member || member.active !== 1) {
      error(res, 403, "ZERO3_ROLE_INACTIVE", "Acesso ZERO3 não autorizado.", req);
      return false;
    }
    if (!roles.includes(member.role)) {
      error(res, 403, "ZERO3_ROLE_INSUFFICIENT", "Permissão insuficiente.", req);
      return false;
    }
    return member;
  } catch (failure) {
    if (failure instanceof ClerkLookupFailure) {
      error(res, 503, "AUTH_PROVIDER_UNAVAILABLE", "Não foi possível validar a sessão agora.", req);
    } else {
      error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar a autorização agora.", req);
    }
    return false;
  }
}

function eventDto(row: EventRow) {
  return {
    id: row.id, name: row.name, proofName: row.proof_name, status: row.status,
    preparationSeconds: row.preparation_seconds, createdAt: date(row.created_at),
  };
}

function proofDto(row: ProofRow) {
  return {
    id: row.id, eventId: row.event_id, order: row.proof_order, name: row.name,
    metricType: row.metric_type, unit: row.unit, direction: row.direction,
    configured: row.metric_type !== "UNCONFIGURED" && Boolean(row.name.trim()) &&
      (row.direction === "LOWER" || row.direction === "HIGHER"),
    createdAt: date(row.created_at),
  };
}

async function publicBoard(DB: D1Database, eventId?: string) {
  const event = eventId
    ? await DB.prepare("SELECT * FROM zero3_events WHERE id = ? LIMIT 1").bind(eventId).first<EventRow>()
    : await DB.prepare("SELECT * FROM zero3_events ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC LIMIT 1").first<EventRow>();
  if (!event) return GetZero3PublicBoardResponse.parse({
    serverTime: new Date(), results: [], proofs: [], registrations: [],
    leaderboards: [], podiums: [], activeHeats: [],
  });

  const [proofResult, regResult, resultResult, athleteResult, timer, podiumResult, activeResult] = await Promise.all([
    DB.prepare("SELECT * FROM zero3_proofs WHERE event_id = ? ORDER BY proof_order").bind(event.id).all<ProofRow>(),
    DB.prepare("SELECT * FROM zero3_registrations WHERE event_id = ? ORDER BY created_at").bind(event.id).all<RegistrationRow>(),
    DB.prepare("SELECT * FROM zero3_results WHERE event_id = ? ORDER BY captured_at DESC").bind(event.id).all<ResultRow>(),
    DB.prepare("SELECT id, full_name FROM zero3_athletes").all<{id: string; full_name: string}>(),
    DB.prepare("SELECT * FROM zero3_timers WHERE event_id = ? LIMIT 1").bind(event.id).first<{
      state: string; elapsed_ms: number; started_at: string | null; preparation_ends_at: string | null;
      version: number; updated_at: string;
    }>(),
    DB.prepare("SELECT * FROM zero3_podium_versions WHERE event_id = ? AND published = 1 ORDER BY version DESC").bind(event.id).all<{
      category: string; registration_ids: string;
    }>(),
    DB.prepare("SELECT ah.category, ah.heat_id, ah.updated_at, h.name AS heat_name FROM zero3_active_heats ah LEFT JOIN zero3_heats h ON h.id = ah.heat_id WHERE ah.event_id = ?").bind(event.id).all<{
      category: string; heat_id: string | null; updated_at: string; heat_name: string | null;
    }>(),
  ]);
  const proofs = proofResult.results;
  const registrations = regResult.results;
  const results = resultResult.results;
  const athleteNames = new Map(athleteResult.results.map((athlete) => [athlete.id, athlete.full_name]));
  const registrationsDto = registrations.map((reg) => ({
    id: reg.id, category: reg.category as "SC" | "RX", teamName: reg.team_name,
    laneLabel: reg.lane_label, athleteNames: jsonArray(reg.athlete_ids).map((athleteId) => athleteNames.get(athleteId) ?? "Atleta removido"),
  }));
  const scoring = calculateAllResultPlacements({
    categories: ["SC", "RX"],
    eventStatus: event.status,
    proofs: proofs.map((proof) => ({
      id: proof.id, order: proof.proof_order, name: proof.name,
      metricType: proof.metric_type, unit: proof.unit, direction: proof.direction,
    })),
    registrations: registrationsDto,
    results: results.map((row) => ({
      id: row.id, registrationId: row.registration_id, proofId: row.proof_id,
      rawValue: row.raw_value, status: row.status,
    })),
  });
  const placement = scoring.placements;
  const registrationsById = new Map(registrationsDto.map((reg) => [reg.id, reg]));
  const heatIds = [...new Set(results.flatMap((row) => row.heat_id ? [row.heat_id] : []))];
  const heats = heatIds.length
    ? (await DB.prepare(`SELECT id, name FROM zero3_heats WHERE id IN (${heatIds.map(() => "?").join(",")})`).bind(...heatIds).all<{id: string; name: string}>()).results
    : [];
  const heatNames = new Map(heats.map((heat) => [heat.id, heat.name]));
  const resultDtos = results.map((row) => {
    const p = placement.get(row.id);
    const reg = registrationsById.get(row.registration_id);
    const snapshotNames = jsonArray(row.athlete_names_snapshot);
    return {
      id: row.id, eventId: row.event_id, registrationId: row.registration_id,
      heatId: row.heat_id, category: row.category, laneLabel: row.lane_label,
      elapsedMs: row.elapsed_ms, proofId: row.proof_id,
      rawValue: row.raw_value === null ? null : Number(row.raw_value),
      placement: p?.placement ?? null, points: p?.points ?? null,
      tieRulePending: p?.tiePending ?? false, syncErrorMs: row.sync_error_ms,
      status: row.status, capturedAt: date(row.captured_at), revision: row.revision,
      names: snapshotNames.length ? snapshotNames : reg?.athleteNames ?? [],
      teamName: row.team_name_snapshot ?? reg?.teamName ?? null,
      heatName: row.heat_id ? heatNames.get(row.heat_id) ?? null : null,
    };
  });
  const latestPodium = new Map<string, string>();
  for (const podium of podiumResult.results) {
    if (!latestPodium.has(podium.category)) latestPodium.set(podium.category, podium.registration_ids);
  }
  const podiums = [...latestPodium].map(([category, json]) => ({
    category, places: nullableStringArray(json).flatMap((registrationId, index) => {
      if (!registrationId) return [];
      const reg = registrationsById.get(registrationId);
      return !reg || reg.category !== category ? [] : [{
        place: index + 1, registrationId, teamName: reg.teamName, athleteNames: reg.athleteNames,
      }];
    }),
  }));
  const now = new Date();
  const timerDto = timer ? {
    eventId: event.id, state: timer.state,
    elapsedMs: Math.floor(timer.elapsed_ms + (timer.state === "RUNNING" && timer.started_at ? Math.max(0, now.getTime() - Date.parse(timer.started_at)) : 0)),
    preparationRemainingMs: timer.state === "PREPARATION" && timer.preparation_ends_at ? Math.max(0, Math.ceil(Date.parse(timer.preparation_ends_at) - now.getTime())) : 0,
    preparationSeconds: event.preparation_seconds,
    startedAt: date(timer.started_at), version: timer.version, updatedAt: date(timer.updated_at),
  } : undefined;
  const activeHeats = (["SC", "RX"] as const).map((category) => {
    const row = activeResult.results.find((item) => item.category === category);
    return { eventId: event.id, category, heatId: row?.heat_id ?? null, heatName: row?.heat_name ?? null, updatedAt: date(row?.updated_at) ?? new Date(0) };
  });
  return GetZero3PublicBoardResponse.parse({
    serverTime: now, event: eventDto(event), timer: timerDto,
    results: resultDtos, proofs: proofs.map(proofDto),
    registrations: registrationsDto,
    leaderboards: scoring.leaderboards, podiums, activeHeats,
  });
}

function captureDto(row: ResultRow, reg: RegistrationRow, names: string[], placement?: {placement: number|null; points: number|null; tiePending: boolean}) {
  return {
    id: row.id, eventId: row.event_id, registrationId: row.registration_id,
    heatId: row.heat_id, category: row.category, laneLabel: row.lane_label,
    elapsedMs: row.elapsed_ms, proofId: row.proof_id,
    rawValue: row.raw_value === null ? null : Number(row.raw_value),
    placement: placement?.placement ?? null, points: placement?.points ?? null,
    tieRulePending: placement?.tiePending ?? false, syncErrorMs: row.sync_error_ms,
    status: row.status, capturedAt: date(row.captured_at), revision: row.revision,
    names, teamName: row.team_name_snapshot ?? reg.team_name, heatName: null,
  };
}

export function d1StagingApi(
  DB: D1Database,
  options: { allowRosterApply?: boolean } = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/zero3/")) { next(); return; }
    void (async () => {
      const route = req.path.slice("/api/zero3".length);
      if (route === "/me" && req.method === "GET") {
        const auth = getAuth(req);
        if (!hasSignedInUserSession(auth) || !auth.userId) {
          error(res, 401, "SESSION_INVALID", "Sessão inválida.", req); return;
        }
        let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
        try {
          user = await clerkClient.users.getUser(auth.userId);
        } catch {
          error(res, 503, "AUTH_PROVIDER_UNAVAILABLE", "Não foi possível validar a sessão agora.", req); return;
        }
        if (!user) { error(res, 503, "AUTH_PROVIDER_UNAVAILABLE", "Não foi possível validar a sessão agora.", req); return; }
        const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
        if (!primary || primary.verification?.status !== "verified") {
          error(res, 403, "ZERO3_ROLE_INACTIVE", "Acesso ZERO3 não autorizado.", req); return;
        }
        try {
          const member = await DB.prepare("SELECT clerk_user_id, email, role, active FROM zero3_members WHERE clerk_user_id = ? LIMIT 1")
            .bind(auth.userId).first<Member>();
          if (!member || member.active !== 1 || member.email.toLowerCase() !== primary.emailAddress.toLowerCase()) {
            error(res, 403, "ZERO3_ROLE_INACTIVE", "Acesso ZERO3 não autorizado.", req); return;
          }
          res.json(GetZero3MeResponse.parse({ userId: auth.userId, email: primary.emailAddress.toLowerCase(), role: member.role }));
        } catch {
          error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar a autorização agora.", req);
        }
        return;
      }
      if (route === "/dashboard" && req.method === "GET") {
        const member = await requireD1Role(req, res, DB, ["ADMIN", "JUIZ_CHEFE", "JUIZ"]);
        if (!member) return;
        try {
          const [events, athleteCount, activeEvent, recentRows] = await Promise.all([
            DB.prepare("SELECT * FROM zero3_events ORDER BY created_at DESC").all<EventRow>(),
            DB.prepare("SELECT COUNT(*) AS count FROM zero3_athletes").first<{count: number}>(),
            DB.prepare("SELECT * FROM zero3_events WHERE status='ACTIVE' ORDER BY created_at DESC LIMIT 1").first<EventRow>(),
            DB.prepare("SELECT * FROM zero3_results ORDER BY captured_at DESC LIMIT 8").all<ResultRow>(),
          ]);
          const recentResults = recentRows.results.map((row) => ({
            id: row.id, eventId: row.event_id, registrationId: row.registration_id,
            heatId: row.heat_id, category: row.category, laneLabel: row.lane_label,
            elapsedMs: row.elapsed_ms, proofId: row.proof_id,
            rawValue: row.raw_value === null ? null : Number(row.raw_value),
            placement: null, points: null, tieRulePending: false, syncErrorMs: row.sync_error_ms,
            status: row.status, capturedAt: date(row.captured_at), revision: row.revision,
            names: jsonArray(row.athlete_names_snapshot),
            teamName: row.team_name_snapshot, heatName: null,
          }));
          res.json(GetZero3DashboardResponse.parse({
            eventCount: events.results.length, athleteCount: athleteCount?.count ?? 0,
            ...(activeEvent ? { activeEvent: eventDto(activeEvent) } : {}),
            recentResults, connected: true,
          }));
        } catch {
          error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar o painel.", req);
        }
        return;
      }
      if (route === "/events" && req.method === "GET") {
        const member = await requireD1Role(req, res, DB, ["ADMIN", "JUIZ_CHEFE", "JUIZ"]);
        if (!member) return;
        try {
          const rows = await DB.prepare("SELECT * FROM zero3_events ORDER BY created_at DESC").all<EventRow>();
          res.json(ListZero3EventsResponse.parse(rows.results.map(eventDto)));
        } catch { error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar os eventos.", req); }
        return;
      }
      const proofsMatch = route.match(/^\/events\/([^/]+)\/proofs$/);
      if (proofsMatch && req.method === "GET") {
        const member = await requireD1Role(req, res, DB, ["ADMIN", "JUIZ_CHEFE", "JUIZ"]);
        if (!member) return;
        try {
          const event = await DB.prepare("SELECT id FROM zero3_events WHERE id=?")
            .bind(proofsMatch[1]).first<{ id: string }>();
          if (!event) { res.status(404).json({ error: "Evento não encontrado." }); return; }
          const existing = await DB.prepare("SELECT proof_order FROM zero3_proofs WHERE event_id=?")
            .bind(event.id).all<{ proof_order: number }>();
          const orders = new Set(existing.results.map((row) => row.proof_order));
          const missing = [1, 2, 3, 4].filter((order) => !orders.has(order));
          if (missing.length) {
            await DB.batch(missing.map((order) => DB.prepare(`INSERT OR IGNORE INTO zero3_proofs
              (id,event_id,proof_order,name,metric_type,unit,direction) VALUES(?,?,?,'','UNCONFIGURED',NULL,NULL)`)
              .bind(id(), event.id, order)));
          }
          const rows = await DB.prepare("SELECT * FROM zero3_proofs WHERE event_id=? ORDER BY proof_order").bind(event.id).all<ProofRow>();
          res.json(ListZero3ProofsResponse.parse(rows.results.map(proofDto)));
        } catch { error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar as provas.", req); }
        return;
      }
      const registrationsMatch = route.match(/^\/events\/([^/]+)\/registrations$/);
      if (registrationsMatch && req.method === "GET") {
        const member = await requireD1Role(req, res, DB, ["ADMIN", "JUIZ_CHEFE", "JUIZ"]);
        if (!member) return;
        try {
          const rows = await DB.prepare("SELECT * FROM zero3_registrations WHERE event_id=? ORDER BY created_at").bind(registrationsMatch[1]).all<RegistrationRow>();
          const athletes = await DB.prepare("SELECT id,full_name FROM zero3_athletes").all<{id:string;full_name:string}>();
          const names = new Map(athletes.results.map((athlete) => [athlete.id, athlete.full_name]));
          res.json(ListZero3RegistrationsResponse.parse(rows.results.map((row) => ({
            id: row.id, eventId: row.event_id, category: row.category,
            teamName: row.team_name, athleteIds: jsonArray(row.athlete_ids),
            athleteNames: jsonArray(row.athlete_ids).map((athleteId) => names.get(athleteId) ?? "Atleta removido"),
            laneLabel: row.lane_label, createdAt: date(row.created_at),
          }))));
        } catch { error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar as inscrições.", req); }
        return;
      }
      if (route === "/public-board" && req.method === "GET") {
        const query = GetZero3PublicBoardQueryParams.safeParse(req.query);
        if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
        try { res.json(await publicBoard(DB, query.data.eventId)); }
        catch (cause) {
          workerLogger.error({ error: cause, requestId: requestId(req), stage: "d1_public_board" }, "D1 public board query failed");
          error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar o placar.", req);
        }
        return;
      }
      if (route === "/results" && req.method === "POST") {
        const member = await requireD1Role(req, res, DB, ["ADMIN", "JUIZ_CHEFE", "JUIZ"]);
        if (!member) return;
        const body = CaptureZero3ResultBody.safeParse(req.body);
        if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
        try {
          const reg = await DB.prepare("SELECT * FROM zero3_registrations WHERE id=? AND event_id=?")
            .bind(body.data.registrationId, body.data.eventId).first<RegistrationRow>();
          if (!reg) { res.status(400).json({ error: "Inscrição inválida para esta prova." }); return; }
          if (!body.data.proofId || body.data.status !== "PROVISIONAL" || body.data.rawValue == null) {
            res.status(400).json({ error: "Informe prova e valor; o lançamento inicial deve ser provisório." }); return;
          }
          const proof = await DB.prepare("SELECT * FROM zero3_proofs WHERE id=? AND event_id=?")
            .bind(body.data.proofId, body.data.eventId).first<ProofRow>();
          if (!proof) { res.status(400).json({ error: "Prova inválida para este evento." }); return; }
          if (proof.metric_type === "UNCONFIGURED" || !proof.name.trim() || !["LOWER","HIGHER"].includes(proof.direction ?? "")) {
            res.status(409).json({ error: "Configure nome, métrica e direção antes de lançar resultados." }); return;
          }
          if (body.data.rawValue > 999999999.999) {
            res.status(400).json({ error: "O valor excede a precisão permitida pela prova." }); return;
          }
          const names = jsonArray(reg.athlete_ids);
          const athleteRows = names.length
            ? (await DB.prepare(`SELECT id,full_name FROM zero3_athletes WHERE id IN (${names.map(() => "?").join(",")})`).bind(...names).all<{id:string;full_name:string}>()).results
            : [];
          const namesById = new Map(athleteRows.map((a) => [a.id, a.full_name]));
          const athleteNames = names.map((athleteId) => namesById.get(athleteId) ?? "Atleta removido");
          const stamp = new Date().toISOString();
          const row = await DB.prepare(`INSERT INTO zero3_results
            (id,event_id,registration_id,proof_id,heat_id,category,lane_label,athlete_ids_snapshot,athlete_names_snapshot,team_name_snapshot,elapsed_ms,raw_value,sync_error_ms,status,idempotency_key,captured_at,revision)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PROVISIONAL',?,?,1)
            ON CONFLICT DO NOTHING RETURNING *`)
            .bind(id(), reg.event_id, reg.id, proof.id, body.data.heatId ?? null, reg.category, reg.lane_label,
              JSON.stringify(names), JSON.stringify(athleteNames), reg.team_name, null,
              body.data.rawValue.toFixed(3), null, body.data.idempotencyKey, stamp)
            .first<ResultRow>();
          const saved = row ?? await DB.prepare("SELECT * FROM zero3_results WHERE idempotency_key=?")
            .bind(body.data.idempotencyKey).first<ResultRow>();
          if (!saved) { res.status(409).json({ error: "Já existe um lançamento para esta equipe e prova." }); return; }
          const dto = CaptureZero3ResultResponse.parse(captureDto(saved, reg, athleteNames));
          res.status(201).json(dto);
        } catch {
          error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível salvar o resultado.", req);
        }
        return;
      }
      const match = route.match(/^\/results\/([^/]+)$/);
      if (match && req.method === "PATCH") {
        const member = await requireD1Role(req, res, DB, ["ADMIN", "JUIZ_CHEFE"]);
        if (!member) return;
        const params = UpdateZero3ResultParams.safeParse({ resultId: match[1] });
        const body = UpdateZero3ResultBody.safeParse(req.body);
        if (!params.success || !body.success) {
          res.status(400).json({ error: !params.success ? params.error.message : (body.error?.message ?? "Dados inválidos.") }); return;
        }
        try {
          const current = await DB.prepare("SELECT * FROM zero3_results WHERE id=?").bind(params.data.resultId).first<ResultRow>();
          if (!current) { res.status(404).json({ error: "Resultado não encontrado." }); return; }
          const stamp = new Date().toISOString();
          const raw = body.data.rawValue === undefined ? current.raw_value : body.data.rawValue === null ? null : body.data.rawValue.toFixed(3);
          const elapsed = body.data.elapsedMs === undefined ? current.elapsed_ms : body.data.elapsedMs;
          const status = body.data.status ?? current.status;
          const insertRevision = DB.prepare(`INSERT INTO zero3_result_revisions
            (id,result_id,previous_status,previous_elapsed_ms,previous_raw_value,reason,actor_id,created_at)
            SELECT ?,id,status,elapsed_ms,raw_value,?,?,? FROM zero3_results WHERE id=? AND revision=?`)
            .bind(id(), body.data.reason, getAuth(req).userId ?? "unknown", stamp, current.id, current.revision);
          const updateResult = DB.prepare(`UPDATE zero3_results SET status=?,elapsed_ms=?,raw_value=?,revision=revision+1
            WHERE id=? AND revision=?`)
            .bind(status, elapsed, raw, current.id, current.revision);
          const [revisionResult, updateResultMeta] = await DB.batch([insertRevision, updateResult]);
          if ((revisionResult.meta.changes ?? 0) !== 1 || (updateResultMeta.meta.changes ?? 0) !== 1) {
            res.status(409).json({ error: "O resultado foi alterado por outra operação. Recarregue e tente novamente." }); return;
          }
          const updated = await DB.prepare("SELECT * FROM zero3_results WHERE id=?").bind(current.id).first<ResultRow>();
          if (!updated) { error(res, 500, "API_INTERNAL_ERROR", "Resultado atualizado não encontrado.", req); return; }
          const reg = await DB.prepare("SELECT * FROM zero3_registrations WHERE id=?").bind(updated.registration_id).first<RegistrationRow>();
          const names = jsonArray(updated.athlete_names_snapshot);
          const placementMap = (await publicBoard(DB, updated.event_id)).results.find((result) => result.id === updated.id);
          const dto = UpdateZero3ResultResponse.parse({
            ...captureDto(updated, reg!, names),
            placement: placementMap?.placement ?? null, points: placementMap?.points ?? null,
            tieRulePending: placementMap?.tieRulePending ?? false,
          });
          res.json(dto);
        } catch {
          error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível corrigir o resultado.", req);
        }
        return;
      }
      if (await handleD1StagingAdmin(req, res, DB)) return;
      if (await handleD1StagingRoster(req, res, DB, options.allowRosterApply)) return;
      if (await handleD1StagingControls(req, res, DB)) return;
      res.status(501).json({ code: "D1_ROUTE_NOT_IMPLEMENTED", error: "Esta rota ainda não foi migrada para D1 neste staging." });
    })().catch(() => {
      error(res, 500, "API_INTERNAL_ERROR", "Falha interna da API D1.", req);
    });
  };
}
