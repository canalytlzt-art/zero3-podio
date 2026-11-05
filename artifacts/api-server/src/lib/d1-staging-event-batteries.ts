import type { Request, Response } from "express";
import {
  CreateZero3EventBatteryBody,
  CreateZero3EventBatteryParams,
  CreateZero3EventBatteryResponse,
  ControlZero3TimerBody,
  ControlZero3TimerResponse,
  FinalizeZero3EventBatteryBody,
  FinalizeZero3EventBatteryParams,
  FinalizeZero3EventBatteryResponse,
  DeleteZero3EventBatteryBody,
  DeleteZero3EventBatteryParams,
  DeleteZero3EventBatteryResponse,
  ListZero3EventBatteriesParams,
  ListZero3EventBatteriesResponse,
  SetZero3ActiveEventBatteryBody,
  SetZero3ActiveEventBatteryParams,
  SetZero3ActiveEventBatteryResponse,
  UpdateZero3EventBatteryBody,
  UpdateZero3EventBatteryParams,
  UpdateZero3EventBatteryResponse,
  zero3EventBatteryDeleteConfirmation,
} from "@workspace/api-zod";
import { calculateCategoryLeaderboard } from "./zero3-scoring";
import {
  d1ApiError,
  d1Date,
  d1IsoNow,
  d1JsonArray,
  isD1SchemaNotReady,
  newD1Id,
  requireD1Member,
} from "./d1-staging-shared";
import { batteryTimerBlocksStructureChange, resolveBatteryOrderChange } from "./d1-staging-battery-order";
import { resolveZero3DisplayTeamName } from "./zero3-team-name";
import { workerLogger } from "./worker-logger";

const EVENT_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;
const ACCESS_ROLES = ["ADMIN", "JUIZ_CHEFE", "JUIZ"] as const;
const EVENT_LIMIT_MS = 2 * 60 * 60 * 1000;

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function hasUniqueIds(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function isBatteryConstraintConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint failed|constraint violation|foreign key|unique constraint|not null constraint/i.test(message);
}

function changedRowsGuard(DB: D1Database, eventId: string) {
  // D1.batch is transactional. This statement intentionally violates the
  // battery_order CHECK only when the preceding guarded UPDATE matched zero
  // rows, forcing the entire batch (including an earlier temporary swap) to
  // roll back instead of leaving a partial order.
  return DB.prepare(`INSERT INTO zero3_batteries(id,event_id,battery_order,name)
    SELECT ?,?,0,'__ZERO3_ORDER_GUARD__' WHERE changes()=0`)
    .bind(newD1Id(), eventId);
}

type EventRow = {
  id: string; status: string; categories: string; preparation_seconds: number;
};
type ProofRow = {
  id: string; event_id: string; proof_order: number; name: string;
  metric_type: string; unit: string | null; direction: string | null;
  created_at: string; updated_at: string;
};
type BatteryRow = {
  id: string; event_id: string; battery_order: number; name: string; created_at: string;
  operational_finalized_at: string | null; operational_finalized_by: string | null;
};
type RegistrationRow = {
  id: string; event_id: string; category: string; team_name: string | null;
  athlete_ids: string; lane_label: string | null; confirmation_status: string;
};
type EntryRow = RegistrationRow & { battery_id: string; battery_lane_label: string | null };
type ResultRow = {
  id: string; event_id: string; battery_id: string | null; registration_id: string;
  proof_id: string | null; heat_id: string | null; category: string; lane_label: string | null;
  athlete_ids_snapshot: string; athlete_names_snapshot: string; team_name_snapshot: string | null;
  elapsed_ms: number | null; raw_value: string | null; sync_error_ms: number | null;
  status: string; published_status: string | null; published_elapsed_ms: number | null;
  published_raw_value: string | null; published_revision: number | null;
  captured_at: string; revision: number;
};
type RunRow = {
  battery_id: string; event_id: string; state: string; elapsed_ms: number;
  started_at: string | null; preparation_ends_at: string | null; version: number;
  last_command_id: string | null; updated_at: string;
  preparation_started_at: string | null; first_started_at: string | null; stopped_at: string | null;
};
type PublicationRow = {
  id: string; event_id: string; battery_id: string; version: number;
  result_fingerprint: string; result_count: number; results_json: string;
  leaderboards_json: string; published_by: string; published_at: string;
};

const proofDto = (row: ProofRow) => ({
  id: row.id, eventId: row.event_id, order: row.proof_order, name: row.name,
  metricType: row.metric_type, unit: row.unit, direction: row.direction,
  configured: row.metric_type !== "UNCONFIGURED" && Boolean(row.name.trim()) &&
    (row.direction === "LOWER" || row.direction === "HIGHER"),
  createdAt: d1Date(row.created_at), updatedAt: d1Date(row.updated_at),
});

function runElapsed(row: RunRow | null, now: Date) {
  if (!row) return 0;
  return Math.floor(row.elapsed_ms + (row.state === "RUNNING" && row.started_at
    ? Math.max(0, now.getTime() - Date.parse(row.started_at))
    : 0));
}

export function eventBatteryFinalizedRun(run: RunRow, now: Date) {
  return {
    state: "FINISHED" as const,
    elapsedMs: runElapsed(run, now),
    stoppedAt: now.toISOString(),
  };
}

function resultDto(row: ResultRow, registration?: EntryRow) {
  const snapshotNames = d1JsonArray(row.athlete_names_snapshot);
  return {
    id: row.id, eventId: row.event_id, registrationId: row.registration_id,
    heatId: row.heat_id, batteryId: row.battery_id, category: row.category,
    laneLabel: row.lane_label ?? registration?.battery_lane_label ?? registration?.lane_label ?? null,
    elapsedMs: row.elapsed_ms, proofId: row.proof_id,
    rawValue: row.raw_value === null ? null : Number(row.raw_value),
    placement: null, points: null, tieRulePending: false, syncErrorMs: row.sync_error_ms,
    status: row.status, capturedAt: d1Date(row.captured_at), revision: row.revision,
    publishedStatus: row.published_status,
    publishedElapsedMs: row.published_elapsed_ms,
    publishedRawValue: row.published_raw_value === null ? null : Number(row.published_raw_value),
    publishedRevision: row.published_revision,
    names: snapshotNames, teamName: resolveZero3DisplayTeamName(
      registration?.team_name, row.team_name_snapshot, Boolean(registration),
    ), heatName: null,
  };
}

function resultIsReviewed(result: ResultRow | undefined, proof: ProofRow | undefined) {
  if (!result) return false;
  if (result.status === "DNS" || result.status === "DNF") return true;
  if (result.status !== "VALIDATED" || !proof || proof.metric_type === "UNCONFIGURED" ||
    !proof.name.trim() || !["LOWER", "HIGHER"].includes(proof.direction ?? "")) return false;
  const value = result.raw_value === null ? Number.NaN : Number(result.raw_value);
  return Number.isFinite(value) && value >= 0;
}

function fingerprintState(
  battery: BatteryRow,
  proofs: ProofRow[],
  registrations: EntryRow[],
  results: ResultRow[],
) {
  return JSON.stringify({
    battery: { id: battery.id, eventId: battery.event_id, order: battery.battery_order, name: battery.name },
    proofs: proofs.map((proof) => ({
      id: proof.id, order: proof.proof_order, name: proof.name,
      metricType: proof.metric_type, unit: proof.unit, direction: proof.direction,
    })).sort((a, b) => a.order - b.order),
    registrations: registrations.map((row) => ({
      id: row.id, category: row.category, teamName: row.team_name,
      athleteIds: d1JsonArray(row.athlete_ids), laneLabel: row.battery_lane_label ?? row.lane_label,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    results: results.map((row) => ({
      id: row.id, registrationId: row.registration_id, proofId: row.proof_id,
      status: row.status, rawValue: row.raw_value, elapsedMs: row.elapsed_ms,
      revision: row.revision, capturedAt: row.captured_at,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function publicationMatchesCurrentSnapshot(
  publication: Pick<PublicationRow, "results_json" | "leaderboards_json">,
  results: unknown[],
  leaderboards: unknown[],
) {
  try {
    return JSON.stringify(JSON.parse(publication.results_json)) === JSON.stringify(results) &&
      JSON.stringify(JSON.parse(publication.leaderboards_json)) === JSON.stringify(leaderboards);
  } catch {
    return false;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readRows(DB: D1Database, eventId: string) {
  const [event, proofResult, batteryResult, entryResult, resultResult, runResult, publicationResult, athleteResult] =
    await Promise.all([
      DB.prepare("SELECT id,status,categories,preparation_seconds FROM zero3_events WHERE id=?")
        .bind(eventId).first<EventRow>(),
      DB.prepare("SELECT * FROM zero3_proofs WHERE event_id=? ORDER BY proof_order")
        .bind(eventId).all<ProofRow>(),
      DB.prepare("SELECT * FROM zero3_batteries WHERE event_id=? ORDER BY battery_order")
        .bind(eventId).all<BatteryRow>(),
      DB.prepare(`SELECT be.battery_id,be.lane_label AS battery_lane_label,r.*
        FROM zero3_battery_entries be
        JOIN zero3_registrations r ON r.id=be.registration_id
        WHERE r.event_id=? AND r.confirmation_status<>'CANCELLED'
        ORDER BY be.assigned_at,r.created_at`)
        .bind(eventId).all<EntryRow>(),
      DB.prepare("SELECT * FROM zero3_results WHERE event_id=? AND battery_id IS NOT NULL ORDER BY captured_at,id")
        .bind(eventId).all<ResultRow>(),
      DB.prepare("SELECT * FROM zero3_battery_runs WHERE event_id=?")
        .bind(eventId).all<RunRow>(),
      DB.prepare("SELECT * FROM zero3_battery_publications WHERE event_id=? ORDER BY battery_id,version DESC")
        .bind(eventId).all<PublicationRow>(),
      DB.prepare("SELECT id,full_name FROM zero3_athletes")
        .all<{ id: string; full_name: string }>(),
    ]);
  return {
    event, proofs: proofResult.results, batteries: batteryResult.results,
    entries: entryResult.results, results: resultResult.results, runs: runResult.results,
    publications: publicationResult.results, athleteNames: new Map(athleteResult.results.map((r) => [r.id, r.full_name])),
  };
}

async function advanceDuePreparations(DB: D1Database, eventId: string, now: Date) {
  await DB.prepare(`UPDATE zero3_battery_runs
    SET state='RUNNING',started_at=preparation_ends_at,
        first_started_at=COALESCE(first_started_at,preparation_ends_at),stopped_at=NULL,
        version=version+1,updated_at=?
    WHERE event_id=? AND state='PREPARATION' AND preparation_ends_at IS NOT NULL
      AND preparation_ends_at<=?`)
    .bind(now.toISOString(), eventId, now.toISOString()).run();
}

export async function listD1EventBatteries(DB: D1Database, eventId: string, now = new Date()) {
  await advanceDuePreparations(DB, eventId, now);
  const rows = await readRows(DB, eventId);
  if (!rows.event) return null;
  const proofs = rows.proofs;
  const byBatteryEntries = new Map<string, EntryRow[]>();
  for (const entry of rows.entries) {
    const group = byBatteryEntries.get(entry.battery_id) ?? [];
    group.push(entry);
    byBatteryEntries.set(entry.battery_id, group);
  }
  const byBatteryResults = new Map<string, ResultRow[]>();
  for (const result of rows.results) {
    if (!result.battery_id) continue;
    const group = byBatteryResults.get(result.battery_id) ?? [];
    group.push(result);
    byBatteryResults.set(result.battery_id, group);
  }
  const runByBattery = new Map(rows.runs.map((run) => [run.battery_id, run]));
  const latestPublication = new Map<string, PublicationRow>();
  for (const publication of rows.publications) {
    if (!latestPublication.has(publication.battery_id)) latestPublication.set(publication.battery_id, publication);
  }
  const elapsedByBattery = new Map(rows.runs.map((run) => [run.battery_id, runElapsed(run, now)]));
  const eventElapsedMs = [...elapsedByBattery.values()].reduce((sum, value) => sum + value, 0);

  return Promise.all(rows.batteries.map(async (battery) => {
    const registrations = byBatteryEntries.get(battery.id) ?? [];
    const results = byBatteryResults.get(battery.id) ?? [];
    const run = runByBattery.get(battery.id) ?? null;
    const publication = latestPublication.get(battery.id) ?? null;
    const fingerprint = await sha256(fingerprintState(battery, proofs, registrations, results));
    const resultDtos = results.map((row) => {
      const reg = registrations.find((item) => item.id === row.registration_id);
      return resultDto(row, reg);
    });
    const proofLeaderboards = proofs.map((proof) => ({
      proofId: proof.id,
      leaderboards: [...new Set(registrations.map((reg) => reg.category))].map((category) =>
        calculateCategoryLeaderboard({
          category,
          eventStatus: rows.event!.status,
          proofs: [{
            id: proof.id, order: proof.proof_order, name: proof.name,
            metricType: proof.metric_type, unit: proof.unit, direction: proof.direction,
          }],
          registrations: registrations.map((reg) => ({
            id: reg.id, category: reg.category, teamName: reg.team_name,
            laneLabel: reg.battery_lane_label ?? reg.lane_label,
            athleteNames: d1JsonArray(reg.athlete_ids).map((athleteId) =>
              rows.athleteNames.get(athleteId) ?? "Atleta removido"),
          })),
          results: results.filter((result) => result.proof_id === proof.id).map((result) => ({
            id: result.id, registrationId: result.registration_id, proofId: result.proof_id,
            rawValue: result.raw_value, status: result.status,
          })),
        }),
      ),
    }));
    const resultByKey = new Map(results.map((result) => [`${result.registration_id}:${result.proof_id}`, result]));
    const expectedResultCount = registrations.length * proofs.length;
    const reviewedResultCount = registrations.reduce((count, registration) =>
      count + proofs.filter((proof) =>
        resultIsReviewed(resultByKey.get(`${registration.id}:${proof.id}`), proof),
      ).length, 0);
    const pendingResultCount = Math.max(0, expectedResultCount - reviewedResultCount);
    const categories = [...new Set(registrations.map((row) => row.category))]
      .sort((a, b) => d1JsonArray(rows.event!.categories).indexOf(a) - d1JsonArray(rows.event!.categories).indexOf(b));
    const finalized = Boolean(publication);
    return {
      id: battery.id,
      eventId: battery.event_id,
      order: battery.battery_order,
      name: battery.name,
      state: run?.state ?? "IDLE",
      elapsedMs: elapsedByBattery.get(battery.id) ?? 0,
      eventElapsedMs,
      eventLimitMs: EVENT_LIMIT_MS,
      preparationEndsAt: d1Date(run?.preparation_ends_at),
      preparationRemainingMs: run?.state === "PREPARATION" && run.preparation_ends_at
        ? Math.max(0, Date.parse(run.preparation_ends_at) - now.getTime()) : 0,
      preparationSeconds: rows.event!.preparation_seconds,
      startedAt: d1Date(run?.started_at),
      preparationStartedAt: d1Date(run?.preparation_started_at),
      firstStartedAt: d1Date(run?.first_started_at),
      stoppedAt: d1Date(run?.stopped_at),
      registrations: registrations.map((reg) => ({
        id: reg.id, batteryId: battery.id, category: reg.category, teamName: reg.team_name,
        laneLabel: reg.battery_lane_label ?? reg.lane_label,
        athleteNames: d1JsonArray(reg.athlete_ids).map((athleteId) =>
          rows.athleteNames.get(athleteId) ?? "Atleta removido"),
      })),
      proofs: proofs.map(proofDto),
      proofLeaderboards,
      results: resultDtos,
      categories,
      pendingResultCount,
      reviewedResultCount,
      expectedResultCount,
      finalizationCurrent: finalized && (
        publication!.result_fingerprint === fingerprint ||
        publicationMatchesCurrentSnapshot(publication!, resultDtos, proofLeaderboards)
      ),
      finalized,
      operationalFinalized: Boolean(battery.operational_finalized_at),
      operationalFinalizedAt: d1Date(battery.operational_finalized_at),
      finalizationFingerprint: fingerprint,
      finalizationVersion: publication?.version ?? null,
      finalizedAt: d1Date(publication?.published_at),
      timerVersion: run?.version ?? 0,
      updatedAt: d1Date(run?.updated_at ?? battery.created_at),
    };
  }));
}

export async function getD1ActiveEventBattery(DB: D1Database, eventId: string, now = new Date()) {
  const active = await DB.prepare("SELECT battery_id FROM zero3_active_batteries WHERE event_id=?")
    .bind(eventId).first<{ battery_id: string | null }>();
  if (!active?.battery_id) return null;
  const batteries = await listD1EventBatteries(DB, eventId, now);
  return batteries?.find((battery) =>
    battery.id === active.battery_id && !battery.operationalFinalized,
  ) ?? null;
}

export async function handleD1StagingEventBatteries(
  req: Request,
  res: Response,
  DB: D1Database,
): Promise<boolean> {
  const route = req.path.slice("/api/zero3".length);
  const timerMatch = route.match(/^\/events\/([^/]+)\/timer$/);
  if (timerMatch && req.method === "PUT" &&
      typeof req.body === "object" && req.body !== null && "expectedBatteryId" in req.body) {
    const member = await requireD1Member(req, res, DB, EVENT_ROLES);
    if (!member) return true;
    const parsed = ControlZero3TimerBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.expectedBatteryId) {
      res.status(400).json({ error: parsed.success ? "Informe a bateria do evento." : parsed.error.message });
      return true;
    }
    const eventId = timerMatch[1]!;
    const batteryId = parsed.data.expectedBatteryId;
    const now = new Date();
    const nowIso = now.toISOString();
    try {
      const event = await DB.prepare("SELECT id,preparation_seconds FROM zero3_events WHERE id=?")
        .bind(eventId).first<{ id: string; preparation_seconds: number }>();
      if (!event) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
      const battery = await DB.prepare("SELECT id,operational_finalized_at FROM zero3_batteries WHERE id=? AND event_id=?")
        .bind(batteryId, eventId).first<{ id: string; operational_finalized_at: string | null }>();
      if (!battery) { d1ApiError(req, res, 409, "BATTERY_SELECTION_CONFLICT", "A bateria não pertence a este evento."); return true; }
      if (battery.operational_finalized_at) {
        d1ApiError(req, res, 409, "BATTERY_OPERATIONAL_FINALIZED", "Esta bateria já foi finalizada e não pode reiniciar o cronômetro.");
        return true;
      }
      await DB.prepare("INSERT OR IGNORE INTO zero3_battery_runs(battery_id,event_id) VALUES(?,?)")
        .bind(batteryId, eventId).run();
      await advanceDuePreparations(DB, eventId, now);
      let run = await DB.prepare("SELECT * FROM zero3_battery_runs WHERE battery_id=? AND event_id=?")
        .bind(batteryId, eventId).first<RunRow>();
      if (!run) { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar o cronômetro da bateria."); return true; }
      if (run.last_command_id === parsed.data.commandId) {
        const batteries = await listD1EventBatteries(DB, eventId, now);
        const dto = batteries?.find((item) => item.id === batteryId);
        if (!dto) { d1ApiError(req, res, 404, "BATTERY_NOT_FOUND", "Bateria não encontrada."); return true; }
        res.json(ControlZero3TimerResponse.parse({
          eventId, state: dto.state, elapsedMs: dto.elapsedMs,
          preparationRemainingMs: dto.state === "PREPARATION" && dto.preparationEndsAt
            ? Math.max(0, dto.preparationEndsAt.getTime() - now.getTime()) : 0,
          preparationSeconds: event.preparation_seconds,
          startedAt: d1Date(run.started_at), preparationEndsAt: d1Date(run.preparation_ends_at),
          preparationStartedAt:d1Date(run.preparation_started_at),
          firstStartedAt:d1Date(run.first_started_at),stoppedAt:d1Date(run.stopped_at),
          version: run.version, updatedAt: d1Date(run.updated_at),
          proofId: null, batteryOrder: null, batteryId,
          eventElapsedMs: dto.eventElapsedMs, eventLimitMs: dto.eventLimitMs,
        }));
        return true;
      }
      if (run.version !== parsed.data.expectedVersion) {
        d1ApiError(req, res, 409, "TIMER_VERSION_CONFLICT", "O cronômetro mudou em outra tela. Atualize e tente novamente.");
        return true;
      }
      const liveElapsed = Math.floor(run.elapsed_ms + (run.state === "RUNNING" && run.started_at
        ? Math.max(0, now.getTime() - Date.parse(run.started_at)) : 0));
      const allRuns = await DB.prepare("SELECT * FROM zero3_battery_runs WHERE event_id=?")
        .bind(eventId).all<RunRow>();
      const eventElapsedMs = allRuns.results.reduce((sum, item) => sum + runElapsed(item, now), 0);
      let next: Pick<RunRow, "state" | "elapsed_ms" | "started_at" | "preparation_ends_at" |
        "preparation_started_at" | "first_started_at" | "stopped_at">;
      switch (parsed.data.action) {
        case "prepare":
          if (eventElapsedMs >= EVENT_LIMIT_MS) {
            d1ApiError(req, res, 409, "EVENT_TIME_LIMIT", "O limite de 2 horas do evento foi atingido.");
            return true;
          }
          if (run.state !== "IDLE") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = {
            state: "PREPARATION", elapsed_ms: 0, started_at: null,
            preparation_ends_at: new Date(now.getTime() + event.preparation_seconds * 1000).toISOString(),
            preparation_started_at:nowIso,first_started_at:run.first_started_at,stopped_at:null,
          };
          break;
        case "start":
          if (eventElapsedMs >= EVENT_LIMIT_MS) {
            d1ApiError(req, res, 409, "EVENT_TIME_LIMIT", "O limite de 2 horas do evento foi atingido.");
            return true;
          }
          if (run.state !== "IDLE") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = { state: "RUNNING", elapsed_ms: 0, started_at: nowIso, preparation_ends_at: null,
            preparation_started_at:null,first_started_at:run.first_started_at??nowIso,stopped_at:null };
          break;
        case "pause":
          if (run.state !== "RUNNING") { res.status(400).json({ error: "O cronômetro não está em execução." }); return true; }
          next = { state: "PAUSED", elapsed_ms: liveElapsed, started_at: null, preparation_ends_at: run.preparation_ends_at,
            preparation_started_at:run.preparation_started_at,first_started_at:run.first_started_at,stopped_at:nowIso };
          break;
        case "resume":
          if (run.state !== "PAUSED") { res.status(400).json({ error: "O cronômetro não está pausado." }); return true; }
          if (eventElapsedMs >= EVENT_LIMIT_MS) {
            d1ApiError(req, res, 409, "EVENT_TIME_LIMIT", "O limite de 2 horas do evento foi atingido.");
            return true;
          }
          next = { state: "RUNNING", elapsed_ms: run.elapsed_ms, started_at: nowIso, preparation_ends_at: run.preparation_ends_at,
            preparation_started_at:run.preparation_started_at,first_started_at:run.first_started_at??nowIso,stopped_at:null };
          break;
        case "finish":
          if (!["RUNNING", "PAUSED"].includes(run.state)) {
            res.status(400).json({ error: "O cronômetro não está em execução ou pausado." }); return true;
          }
          next = { state: "FINISHED", elapsed_ms: liveElapsed, started_at: null, preparation_ends_at: run.preparation_ends_at,
            preparation_started_at:run.preparation_started_at,first_started_at:run.first_started_at,stopped_at:nowIso };
          break;
        case "reset":
          if (run.state !== "IDLE" && run.state !== "PREPARATION") {
            res.status(409).json({ error: "O tempo acumulado não pode ser apagado após o início da prova." });
            return true;
          }
          next = { state: "IDLE", elapsed_ms: 0, started_at: null, preparation_ends_at: run.preparation_ends_at,
            preparation_started_at:run.preparation_started_at,first_started_at:run.first_started_at,stopped_at:run.stopped_at };
          break;
      }
      const saved = await DB.prepare(`UPDATE zero3_battery_runs
        SET state=?,elapsed_ms=?,started_at=?,preparation_ends_at=?,preparation_started_at=?,
            first_started_at=?,stopped_at=?,version=version+1,
            last_command_id=?,updated_at=?
        WHERE battery_id=? AND event_id=? AND version=?
          AND (last_command_id IS NULL OR last_command_id<>?)
          AND EXISTS(SELECT 1 FROM zero3_batteries
            WHERE id=? AND event_id=? AND operational_finalized_at IS NULL)`)
        .bind(next.state, next.elapsed_ms, next.started_at, next.preparation_ends_at,
          next.preparation_started_at,next.first_started_at,next.stopped_at,
          parsed.data.commandId, nowIso, batteryId, eventId, parsed.data.expectedVersion,
          parsed.data.commandId,batteryId,eventId).run();
      run = await DB.prepare("SELECT * FROM zero3_battery_runs WHERE battery_id=? AND event_id=?")
        .bind(batteryId, eventId).first<RunRow>();
      if ((saved.meta.changes ?? 0) !== 1) {
        if (run?.last_command_id !== parsed.data.commandId) {
          d1ApiError(req, res, 409, "TIMER_VERSION_CONFLICT", "O cronômetro mudou antes de salvar. Atualize e tente novamente.");
          return true;
        }
      }
      const batteries = await listD1EventBatteries(DB, eventId, now);
      const dto = batteries?.find((item) => item.id === batteryId);
      if (!run || !dto) { d1ApiError(req, res, 500, "API_INTERNAL_ERROR", "Cronômetro atualizado, mas não foi possível recuperá-lo."); return true; }
      res.json(ControlZero3TimerResponse.parse({
        eventId, state: dto.state, elapsedMs: dto.elapsedMs,
        preparationRemainingMs: dto.state === "PREPARATION" && dto.preparationEndsAt
          ? Math.max(0, dto.preparationEndsAt.getTime() - now.getTime()) : 0,
        preparationSeconds: event.preparation_seconds,
        startedAt: d1Date(run.started_at), preparationEndsAt: d1Date(run.preparation_ends_at),
        preparationStartedAt:d1Date(run.preparation_started_at),
        firstStartedAt:d1Date(run.first_started_at),stoppedAt:d1Date(run.stopped_at),
        version: run.version, updatedAt: d1Date(run.updated_at),
        proofId: null, batteryOrder: null, batteryId,
        eventElapsedMs: dto.eventElapsedMs, eventLimitMs: dto.eventLimitMs,
      }));
    } catch {
      d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível atualizar o cronômetro da bateria.");
    }
    return true;
  }

  const batteryMutationMatch = route.match(/^\/events\/([^/]+)\/batteries\/([^/]+)$/);
  if (batteryMutationMatch && req.method === "PATCH") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = UpdateZero3EventBatteryParams.safeParse({
      eventId: batteryMutationMatch[1], batteryId: batteryMutationMatch[2],
    });
    const body = UpdateZero3EventBatteryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Dados inválidos.",
      });
      return true;
    }
    if (!hasUniqueIds(body.data.expectedRegistrationIds) || !hasUniqueIds(body.data.registrationIds)) {
      d1ApiError(req, res, 400, "REGISTRATION_DUPLICATE", "Cada inscrição só pode aparecer uma vez na composição.");
      return true;
    }
    try {
      const batteries = await listD1EventBatteries(DB, params.data.eventId);
      if (!batteries) {
        d1ApiError(req, res, 404, "EVENT_NOT_FOUND", "Evento não encontrado.");
        return true;
      }
      const battery = batteries.find((item) => item.id === params.data.batteryId);
      if (!battery) {
        d1ApiError(req, res, 404, "BATTERY_NOT_FOUND", "Bateria não encontrada neste evento.");
        return true;
      }
      const currentRegistrationIds = battery.registrations.map((item) => item.id);
      if (body.data.expectedName !== battery.name ||
          body.data.expectedOrder !== battery.order ||
          !sameStringSet(body.data.expectedRegistrationIds, currentRegistrationIds)) {
        d1ApiError(req, res, 409, "BATTERY_CHANGED", "A composição mudou. Atualize a bateria antes de editar.");
        return true;
      }
      const compositionChanged = !sameStringSet(body.data.registrationIds, currentRegistrationIds);
      if (compositionChanged && (battery.state !== "IDLE" || battery.results.length > 0 || battery.operationalFinalized)) {
        d1ApiError(req, res, 409, "BATTERY_NOT_EDITABLE",
          "A composição só pode ser alterada antes do início, sem resultados nem publicação. Nome e número da bateria podem ser editados separadamente.");
        return true;
      }
      const decision = resolveBatteryOrderChange(
        batteries.map(({ id, order, name }) => ({ id, order, name })),
        battery.id,
        body.data.order,
        body.data.swapWithBatteryId,
      );
      if (decision.kind === "occupied") {
        d1ApiError(req, res, 409, "BATTERY_ORDER_OCCUPIED",
          `P${String(decision.other.order).padStart(2, "0")} já está em uso por "${decision.other.name}". Confirme a troca de posições para continuar.`);
        return true;
      }
      if (decision.kind === "conflict") {
        d1ApiError(req, res, 409, "BATTERY_ORDER_CHANGED",
          "A posição escolhida mudou. Atualize a lista e confirme novamente a troca.");
        return true;
      }
      const otherBattery = decision.kind === "swap"
        ? batteries.find((item) => item.id === decision.other.id)
        : undefined;
      if (batteryTimerBlocksStructureChange(battery.state) ||
          (otherBattery && batteryTimerBlocksStructureChange(otherBattery.state))) {
        d1ApiError(req, res, 409, "BATTERY_TIMER_ACTIVE",
          "Pare a preparação ou cronômetro em execução antes de alterar a ordem. O tempo pausado é preservado.");
        return true;
      }

      const registrationIds = body.data.registrationIds;
      if (compositionChanged) {
        const eligibility = await Promise.all(registrationIds.map(async (registrationId) => {
          const [registration, assignment, result] = await Promise.all([
            DB.prepare(`SELECT id FROM zero3_registrations
              WHERE id=? AND event_id=? AND confirmation_status<>'CANCELLED'`)
              .bind(registrationId, params.data.eventId).first<{ id: string }>(),
            DB.prepare("SELECT battery_id FROM zero3_battery_entries WHERE registration_id=?")
              .bind(registrationId).first<{ battery_id: string }>(),
            DB.prepare("SELECT id FROM zero3_results WHERE registration_id=? LIMIT 1")
              .bind(registrationId).first<{ id: string }>(),
          ]);
          return { registrationId, registration, assignment, result };
        }));
        if (eligibility.some((item) => !item.registration)) {
          d1ApiError(req, res, 400, "REGISTRATION_INVALID",
            "Todas as inscrições devem pertencer ao evento e estar ativas.");
          return true;
        }
        if (eligibility.some((item) => item.assignment && item.assignment.battery_id !== battery.id)) {
          d1ApiError(req, res, 409, "REGISTRATION_ALREADY_ASSIGNED",
            "Uma inscrição já pertence a outra bateria.");
          return true;
        }
        if (eligibility.some((item) => item.result)) {
          d1ApiError(req, res, 409, "REGISTRATION_HAS_RESULTS",
            "Uma inscrição selecionada tem resultado histórico; a composição não foi alterada.");
          return true;
        }
      }

      const nextName = body.data.name.trim();
      const nextOrder = body.data.order;
      const metadataChanged = nextName !== battery.name || nextOrder !== battery.order;
      if (!metadataChanged && !compositionChanged) {
        res.json(UpdateZero3EventBatteryResponse.parse(battery));
        return true;
      }

      const stamp = d1IsoNow();
      const marker = `__ZERO3_EDIT_${newD1Id()}__`;
      const expectedIdsJson = JSON.stringify([...new Set(body.data.expectedRegistrationIds)]);
      const isSwap = decision.kind === "swap";
      const initialOrder = isSwap
        ? (Math.max(0, ...batteries.map((item) => item.order)) + 1)
        : nextOrder;
      const compositionGuardSql = compositionChanged ? `
        AND NOT EXISTS(SELECT 1 FROM zero3_battery_runs
          WHERE battery_id=? AND event_id=? AND state<>'IDLE')
        AND NOT EXISTS(SELECT 1 FROM zero3_results WHERE battery_id=?)
        AND NOT EXISTS(SELECT 1 FROM zero3_battery_publications WHERE battery_id=?)
        AND NOT EXISTS(SELECT registration_id FROM zero3_battery_entries WHERE battery_id=?
          EXCEPT SELECT value FROM json_each(?))
        AND NOT EXISTS(SELECT value FROM json_each(?)
          EXCEPT SELECT registration_id FROM zero3_battery_entries WHERE battery_id=?)` : "";
      const compositionGuardBindings = compositionChanged
        ? [battery.id, params.data.eventId, battery.id, battery.id, battery.id,
          expectedIdsJson, expectedIdsJson, battery.id] as const
        : [] as const;
      const targetFreeSql = isSwap ? "" : `
        AND NOT EXISTS(SELECT 1 FROM zero3_batteries
          WHERE event_id=? AND battery_order=? AND id<>?)`;
      const targetFreeBindings = isSwap ? [] as const : [params.data.eventId, nextOrder, battery.id] as const;
      const firstUpdate = DB.prepare(`UPDATE zero3_batteries
        SET name=?,battery_order=?
        WHERE id=? AND event_id=? AND name=? AND battery_order=?
          AND NOT EXISTS(SELECT 1 FROM zero3_battery_runs
            WHERE battery_id=? AND event_id=? AND state IN ('PREPARATION','RUNNING'))
          ${targetFreeSql}
          ${compositionGuardSql}`)
        .bind(
          isSwap || compositionChanged ? marker : nextName,
          initialOrder,
          battery.id, params.data.eventId, body.data.expectedName, body.data.expectedOrder,
          battery.id, params.data.eventId,
          ...targetFreeBindings,
          ...compositionGuardBindings,
        );

      if (!isSwap && !compositionChanged) {
        const updated = await firstUpdate.run();
        if ((updated.meta.changes ?? 0) !== 1) {
          d1ApiError(req, res, 409, "BATTERY_CHANGED",
            "A bateria mudou durante a edição. Atualize e confira os dados antes de tentar novamente.");
          return true;
        }
      } else {
        const statements = [firstUpdate, changedRowsGuard(DB, params.data.eventId)];
        if (isSwap && otherBattery && decision.kind === "swap") {
          statements.push(
            DB.prepare(`UPDATE zero3_batteries SET battery_order=?
              WHERE id=? AND event_id=? AND battery_order=?
                AND NOT EXISTS(SELECT 1 FROM zero3_battery_runs
                  WHERE battery_id=? AND event_id=? AND state IN ('PREPARATION','RUNNING'))
                AND EXISTS(SELECT 1 FROM zero3_batteries
                  WHERE id=? AND event_id=? AND name=? AND battery_order=?)`)
              .bind(battery.order, otherBattery.id, params.data.eventId, body.data.order,
                otherBattery.id, params.data.eventId, battery.id, params.data.eventId, marker, initialOrder),
            changedRowsGuard(DB, params.data.eventId),
          );
        }
        if (compositionChanged) {
          statements.push(DB.prepare(`DELETE FROM zero3_battery_entries WHERE battery_id=?
            AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND event_id=? AND name=?)`)
            .bind(battery.id, battery.id, params.data.eventId, marker));
          statements.push(...registrationIds.map((registrationId) => DB.prepare(`INSERT INTO zero3_battery_entries
            (battery_id,registration_id,lane_label,assigned_at)
            VALUES(?,(SELECT id FROM zero3_registrations
              WHERE id=? AND event_id=? AND confirmation_status<>'CANCELLED'
                AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND event_id=? AND name=?)),
              (SELECT lane_label FROM zero3_registrations WHERE id=?),?)`)
            .bind(battery.id, registrationId, params.data.eventId,
              battery.id, params.data.eventId, marker, registrationId, stamp)));
        }
        const finalUpdateIndex = statements.length;
        const finalUpdate = isSwap && otherBattery
          ? DB.prepare(`UPDATE zero3_batteries SET name=?,battery_order=?
              WHERE id=? AND event_id=? AND name=? AND battery_order=?
                AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND event_id=? AND battery_order=?)`)
            .bind(nextName, nextOrder, battery.id, params.data.eventId, marker, initialOrder,
              otherBattery.id, params.data.eventId, battery.order)
          : DB.prepare(`UPDATE zero3_batteries SET name=?
              WHERE id=? AND event_id=? AND name=? AND battery_order=?`)
            .bind(nextName, battery.id, params.data.eventId, marker, nextOrder);
        statements.push(finalUpdate, changedRowsGuard(DB, params.data.eventId));
        const saved = await DB.batch(statements);
        if ((saved[0]?.meta.changes ?? 0) !== 1 ||
            (saved[finalUpdateIndex]?.meta.changes ?? 0) !== 1) {
          d1ApiError(req, res, 409, "BATTERY_CHANGED",
            "A bateria ou a posição mudou durante a edição. Nenhuma alteração parcial foi aplicada.");
          return true;
        }
      }

      const updated = (await listD1EventBatteries(DB, params.data.eventId))
        ?.find((item) => item.id === battery.id);
      if (!updated) {
        d1ApiError(req, res, 500, "API_INTERNAL_ERROR", "Bateria atualizada, mas não foi possível recuperá-la.");
        return true;
      }
      res.json(UpdateZero3EventBatteryResponse.parse(updated));
    } catch (error) {
      if (isBatteryConstraintConflict(error)) {
        d1ApiError(req, res, 409, "BATTERY_EDIT_CONFLICT",
          "A composição não pôde ser salva porque uma inscrição foi alterada ou atribuída em outra operação. Nenhuma alteração parcial foi aplicada.");
      } else {
        d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível editar a bateria.");
      }
    }
    return true;
  }

  if (batteryMutationMatch && req.method === "DELETE") {
    if (!await requireD1Member(req, res, DB, ["ADMIN"])) return true;
    const params = DeleteZero3EventBatteryParams.safeParse({
      eventId: batteryMutationMatch[1], batteryId: batteryMutationMatch[2],
    });
    const body = DeleteZero3EventBatteryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Dados inválidos.",
      });
      return true;
    }
    try {
      const batteries = await listD1EventBatteries(DB, params.data.eventId);
      const battery = batteries?.find((item) => item.id === params.data.batteryId);
      if (!battery) {
        d1ApiError(req, res, 404, "BATTERY_NOT_FOUND", "Bateria não encontrada neste evento.");
        return true;
      }
      if (body.data.expectedFingerprint !== battery.finalizationFingerprint) {
        d1ApiError(req, res, 409, "BATTERY_CHANGED", "A bateria mudou. Atualize e confira o impacto antes de excluir.");
        return true;
      }
      const confirmation = zero3EventBatteryDeleteConfirmation(battery.order, battery.name);
      if (body.data.confirmation !== confirmation) {
        d1ApiError(req, res, 409, "BATTERY_DELETE_CONFIRMATION_MISMATCH",
          `Digite exatamente ${confirmation} para confirmar.`);
        return true;
      }
      if (batteryTimerBlocksStructureChange(battery.state)) {
        d1ApiError(req, res, 409, "BATTERY_TIMER_ACTIVE",
          "Pare a preparação ou o cronômetro em execução antes de excluir a bateria. O tempo pausado será removido com ela.");
        return true;
      }
      const [counts, active] = await Promise.all([
        DB.prepare(`SELECT
          (SELECT COUNT(*) FROM zero3_results WHERE event_id=? AND battery_id=?) AS result_count,
          (SELECT COUNT(*) FROM zero3_battery_publications WHERE event_id=? AND battery_id=?) AS publication_count`)
          .bind(params.data.eventId, battery.id, params.data.eventId, battery.id)
          .first<{ result_count: number; publication_count: number }>(),
        DB.prepare("SELECT battery_id FROM zero3_active_batteries WHERE event_id=?")
          .bind(params.data.eventId).first<{ battery_id: string | null }>(),
      ]);
      const marker = `__ZERO3_DELETE_${newD1Id()}__`;
      const statements = [
        DB.prepare(`UPDATE zero3_batteries SET name=?
          WHERE id=? AND event_id=? AND battery_order=? AND name=?
            AND NOT EXISTS(SELECT 1 FROM zero3_battery_runs
              WHERE battery_id=? AND event_id=? AND state IN ('PREPARATION','RUNNING'))`)
          .bind(marker, battery.id, params.data.eventId, battery.order, battery.name,
            battery.id, params.data.eventId),
        DB.prepare(`UPDATE zero3_active_batteries SET battery_id=NULL,updated_at=?
          WHERE event_id=? AND battery_id=?
            AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND name=?)`)
          .bind(d1IsoNow(), params.data.eventId, battery.id, battery.id, marker),
        DB.prepare(`DELETE FROM zero3_results WHERE event_id=? AND battery_id=?
          AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND name=?)`)
          .bind(params.data.eventId, battery.id, battery.id, marker),
        DB.prepare(`DELETE FROM zero3_battery_publications WHERE event_id=? AND battery_id=?
          AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND name=?)`)
          .bind(params.data.eventId, battery.id, battery.id, marker),
        DB.prepare(`DELETE FROM zero3_battery_entries WHERE battery_id=?
          AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND name=?)`)
          .bind(battery.id, battery.id, marker),
        DB.prepare(`DELETE FROM zero3_battery_runs WHERE event_id=? AND battery_id=?
          AND EXISTS(SELECT 1 FROM zero3_batteries WHERE id=? AND name=?)`)
          .bind(params.data.eventId, battery.id, battery.id, marker),
        DB.prepare("DELETE FROM zero3_batteries WHERE id=? AND event_id=? AND name=?")
          .bind(battery.id, params.data.eventId, marker),
      ];
      const deleted = await DB.batch(statements);
      if ((deleted[0]?.meta.changes ?? 0) !== 1 ||
          (deleted.at(-1)?.meta.changes ?? 0) !== 1) {
        d1ApiError(req, res, 409, "BATTERY_CHANGED",
          "A bateria mudou durante a exclusão. Nada foi removido; atualize a lista e revise o impacto.");
        return true;
      }
      res.json(DeleteZero3EventBatteryResponse.parse({
        eventId: params.data.eventId,
        batteryId: battery.id,
        deleted: true,
        removedResults: counts?.result_count ?? 0,
        removedPublications: counts?.publication_count ?? 0,
        wasActive: active?.battery_id === battery.id,
      }));
    } catch (error) {
      if (isBatteryConstraintConflict(error)) {
        d1ApiError(req, res, 409, "BATTERY_DELETE_CONFLICT",
          "A bateria mudou durante a exclusão. Nada foi removido; atualize e tente novamente.");
      } else {
        d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível excluir a bateria.");
      }
    }
    return true;
  }

  const finalizeMatch = route.match(/^\/events\/([^/]+)\/batteries\/([^/]+)\/finalize$/);
  if (finalizeMatch && req.method === "POST") {
    const member = await requireD1Member(req, res, DB, EVENT_ROLES);
    if (!member) return true;
    const params = FinalizeZero3EventBatteryParams.safeParse({
      eventId: finalizeMatch[1], batteryId: finalizeMatch[2],
    });
    const body = FinalizeZero3EventBatteryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : !body.success ? body.error.message : "Dados inválidos.",
      });
      return true;
    }
    let finalizationStage = "load_battery";
    try {
      const batteries = await listD1EventBatteries(DB, params.data.eventId);
      const battery = batteries?.find((item) => item.id === params.data.batteryId);
      if (!battery) { d1ApiError(req, res, 404, "BATTERY_NOT_FOUND", "Bateria não encontrada neste evento."); return true; }
      const respondFinalized = (current: typeof battery, alreadyFinalized: boolean) =>
        FinalizeZero3EventBatteryResponse.parse({
          eventId: current.eventId,
          batteryId: current.id,
          order: current.order,
          operationalFinalizedAt: current.operationalFinalizedAt ?? d1IsoNow(),
          elapsedMs: current.elapsedMs,
          timerVersion: Math.max(1, current.timerVersion),
          resultCount: current.results.length,
          pendingResultCount: current.pendingResultCount,
          alreadyFinalized,
        });
      if (battery.operationalFinalized) {
        // Repair a stale TV selection on retries without changing the archived
        // battery, its timer, registrations, results, or publication history.
        await DB.prepare(`UPDATE zero3_active_batteries
          SET battery_id=NULL,updated_at=?
          WHERE event_id=? AND battery_id=?`)
          .bind(d1IsoNow(), battery.eventId, battery.id).run();
        res.json(respondFinalized(battery, true));
        return true;
      }
      if (body.data.expectedFingerprint !== battery.finalizationFingerprint) {
        d1ApiError(req, res, 409, "BATTERY_CHANGED", "A bateria ou seus resultados mudaram. Atualize antes de finalizar.");
        return true;
      }
      if (battery.registrations.length === 0) {
        d1ApiError(req, res, 409, "BATTERY_EMPTY", "Adicione ao menos uma inscrição antes de finalizar a bateria.");
        return true;
      }
      finalizationStage = "load_timer";
      const existingRun = await DB.prepare("SELECT * FROM zero3_battery_runs WHERE battery_id=? AND event_id=?")
        .bind(battery.id, battery.eventId).first<RunRow>();
      const stamp = d1IsoNow();
      const run: RunRow = existingRun ?? {
        battery_id: battery.id,
        event_id: battery.eventId,
        state: "IDLE",
        elapsed_ms: 0,
        started_at: null,
        preparation_ends_at: null,
        version: 0,
        last_command_id: null,
        updated_at: stamp,
        preparation_started_at: null,
        first_started_at: null,
        stopped_at: null,
      };
      const nextRun = eventBatteryFinalizedRun(run, new Date(stamp));
      finalizationStage = "commit_finalization";
      await DB.batch([
        DB.prepare(`INSERT OR IGNORE INTO zero3_battery_runs(battery_id,event_id)
          SELECT ?,? WHERE EXISTS(
            SELECT 1 FROM zero3_batteries
            WHERE id=? AND event_id=? AND operational_finalized_at IS NULL
          )`).bind(battery.id, battery.eventId, battery.id, battery.eventId),
        DB.prepare(`UPDATE zero3_battery_runs
          SET state=?,elapsed_ms=?,started_at=NULL,preparation_ends_at=NULL,
              stopped_at=?,version=version+1,updated_at=?
          WHERE battery_id=? AND event_id=? AND version=?
            AND EXISTS(SELECT 1 FROM zero3_batteries
              WHERE id=? AND event_id=? AND operational_finalized_at IS NULL)`)
          .bind(nextRun.state, nextRun.elapsedMs, nextRun.stoppedAt, stamp,
            battery.id, battery.eventId, run.version, battery.id, battery.eventId),
        changedRowsGuard(DB, battery.eventId),
        DB.prepare(`UPDATE zero3_batteries
          SET operational_finalized_at=?,operational_finalized_by=?
          WHERE id=? AND event_id=? AND operational_finalized_at IS NULL
            AND EXISTS(SELECT 1 FROM zero3_battery_runs
              WHERE battery_id=? AND event_id=? AND version=? AND state='FINISHED')`)
          .bind(stamp, member.clerk_user_id, battery.id, battery.eventId,
            battery.id, battery.eventId, run.version + 1),
        changedRowsGuard(DB, battery.eventId),
        DB.prepare(`UPDATE zero3_active_batteries
          SET battery_id=NULL,updated_at=?
          WHERE event_id=? AND battery_id=?`)
          .bind(stamp, battery.eventId, battery.id),
      ]);
      finalizationStage = "verify_persisted_state";
      const refreshed = await listD1EventBatteries(DB, battery.eventId);
      const saved = refreshed?.find((item) => item.id === battery.id);
      if (!saved?.operationalFinalized) {
        d1ApiError(req, res, 409, "BATTERY_FINALIZATION_CONFLICT",
          "A bateria mudou durante a finalização. Atualize e confira o estado atual.");
        return true;
      }
      res.json(respondFinalized(saved, false));
    } catch (cause) {
      if (isBatteryConstraintConflict(cause)) {
        const current = await listD1EventBatteries(DB, params.data.eventId).catch(() => null);
        const finalized = current?.find((item) => item.id === params.data.batteryId);
        if (finalized?.operationalFinalized) {
          res.json(FinalizeZero3EventBatteryResponse.parse({
            eventId: finalized.eventId,
            batteryId: finalized.id,
            order: finalized.order,
            operationalFinalizedAt: finalized.operationalFinalizedAt ?? d1IsoNow(),
            elapsedMs: finalized.elapsedMs,
            timerVersion: Math.max(1, finalized.timerVersion),
            resultCount: finalized.results.length,
            pendingResultCount: finalized.pendingResultCount,
            alreadyFinalized: true,
          }));
          return true;
        }
        d1ApiError(req, res, 409, "BATTERY_FINALIZATION_CONFLICT",
          "O cronômetro ou a bateria mudou durante a finalização. Nenhuma alteração parcial foi mantida; atualize e tente novamente.");
      } else {
        workerLogger.error({
          error: cause,
          requestId: (req as Request & { id?: string }).id,
          method: req.method,
          path: route,
          stage: finalizationStage,
        }, "D1 battery finalization failed");
        d1ApiError(req, res, 503,
          isD1SchemaNotReady(cause) ? "D1_SCHEMA_NOT_READY" : "DATABASE_UNAVAILABLE",
          isD1SchemaNotReady(cause)
            ? "O schema D1 está desatualizado e precisa das migrations de finalização operacional."
            : "Não foi possível finalizar a bateria do evento.");
      }
    }
    return true;
  }

  const listMatch = route.match(/^\/events\/([^/]+)\/batteries$/);
  if (listMatch && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, ACCESS_ROLES)) return true;
    const params = ListZero3EventBatteriesParams.safeParse({ eventId: listMatch[1] });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return true; }
    try {
      const batteries = await listD1EventBatteries(DB, params.data.eventId);
      if (batteries === null) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
      res.json(ListZero3EventBatteriesResponse.parse(batteries));
    } catch {
      d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar as baterias do evento.");
    }
    return true;
  }

  if (listMatch && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = CreateZero3EventBatteryParams.safeParse({ eventId: listMatch[1] });
    const body = CreateZero3EventBatteryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : !body.success ? body.error.message : "Dados inválidos." });
      return true;
    }
    try {
      const event = await DB.prepare("SELECT id FROM zero3_events WHERE id=?").bind(params.data.eventId)
        .first<{ id: string }>();
      if (!event) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
      const existingOrder = await DB.prepare("SELECT id FROM zero3_batteries WHERE event_id=? AND battery_order=?")
        .bind(event.id, body.data.order).first<{ id: string }>();
      if (existingOrder) {
        d1ApiError(req, res, 409, "BATTERY_ORDER_CONFLICT", "Este número de bateria já existe neste evento.");
        return true;
      }
      const registrationIds = body.data.registrationIds;
      const registrationResult = registrationIds.length
        ? await DB.prepare(`SELECT id,event_id,confirmation_status FROM zero3_registrations
          WHERE event_id=? AND id IN (${registrationIds.map(() => "?").join(",")})`)
          .bind(event.id, ...registrationIds).all<{ id: string; event_id: string; confirmation_status: string }>()
        : null;
      const registrationRows = registrationResult?.results ?? [];
      if (registrationRows.length !== registrationIds.length ||
          registrationRows.some((reg) => reg.confirmation_status === "CANCELLED")) {
        res.status(400).json({ error: "As inscrições devem pertencer ao evento e não podem estar canceladas." });
        return true;
      }
      if (registrationIds.length) {
        const assigned = await DB.prepare(`SELECT registration_id FROM zero3_battery_entries
          WHERE registration_id IN (${registrationIds.map(() => "?").join(",")})`)
          .bind(...registrationIds).all<{ registration_id: string }>();
        if (assigned.results.length) {
          d1ApiError(req, res, 409, "REGISTRATION_ALREADY_ASSIGNED", "Uma ou mais inscrições já pertencem a outra bateria deste evento.");
          return true;
        }
      }
      const batteryId = newD1Id();
      const stamp = d1IsoNow();
      await DB.batch([
        DB.prepare("INSERT INTO zero3_batteries(id,event_id,battery_order,name,created_at) VALUES(?,?,?,?,?)")
          .bind(batteryId, event.id, body.data.order, body.data.name.trim(), stamp),
        ...registrationIds.map((registrationId) => DB.prepare(`INSERT INTO zero3_battery_entries
          (battery_id,registration_id,lane_label,assigned_at)
          SELECT ?,id,lane_label,? FROM zero3_registrations WHERE id=? AND event_id=? AND confirmation_status<>'CANCELLED'`)
          .bind(batteryId, stamp, registrationId, event.id)),
        DB.prepare("INSERT INTO zero3_battery_runs(battery_id,event_id) VALUES(?,?)").bind(batteryId, event.id),
      ]);
      const batteries = await listD1EventBatteries(DB, event.id);
      const created = batteries?.find((battery) => battery.id === batteryId);
      if (!created) { d1ApiError(req, res, 500, "API_INTERNAL_ERROR", "Bateria criada, mas não foi possível recuperá-la."); return true; }
      res.status(201).json(CreateZero3EventBatteryResponse.parse(created));
    } catch {
      const collision = await DB.prepare("SELECT id FROM zero3_batteries WHERE event_id=? AND battery_order=?")
        .bind(params.data.eventId, body.data.order).first<{ id: string }>().catch(() => null);
      d1ApiError(req, res, collision ? 409 : 503,
        collision ? "BATTERY_ORDER_CONFLICT" : "DATABASE_UNAVAILABLE",
        collision ? "Este número de bateria já existe neste evento." : "Não foi possível criar a bateria.");
    }
    return true;
  }

  const activeMatch = route.match(/^\/events\/([^/]+)\/active-event-battery$/);
  if (activeMatch && req.method === "PATCH") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = SetZero3ActiveEventBatteryParams.safeParse({ eventId: activeMatch[1] });
    const body = SetZero3ActiveEventBatteryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : !body.success ? body.error.message : "Dados inválidos." });
      return true;
    }
    try {
      const event = await DB.prepare("SELECT id FROM zero3_events WHERE id=?").bind(params.data.eventId)
        .first<{ id: string }>();
      if (!event) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
      if (body.data.batteryId) {
        const battery = await DB.prepare("SELECT id FROM zero3_batteries WHERE id=? AND event_id=?")
          .bind(body.data.batteryId, event.id).first<{ id: string }>();
        if (!battery) { res.status(400).json({ error: "A bateria não pertence a este evento." }); return true; }
      }
      const stamp = d1IsoNow();
      await DB.prepare(`INSERT INTO zero3_active_batteries(event_id,battery_id,updated_at) VALUES(?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET battery_id=excluded.battery_id,updated_at=excluded.updated_at`)
        .bind(event.id, body.data.batteryId, stamp).run();
      const selected = body.data.batteryId
        ? (await listD1EventBatteries(DB, event.id))?.find((item) => item.id === body.data.batteryId) ?? null
        : null;
      res.json(SetZero3ActiveEventBatteryResponse.parse(selected));
    } catch {
      d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível selecionar a bateria para a TV.");
    }
    return true;
  }

  return false;
}
