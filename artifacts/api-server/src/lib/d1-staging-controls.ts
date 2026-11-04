import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import {
  ControlZero3TimerBody,
  ControlZero3TimerResponse,
  GetZero3PodiumStateParams,
  GetZero3PodiumStateResponse,
  PublishZero3PodiumBody,
  PublishZero3PodiumParams,
  PublishZero3PodiumResponse,
  SaveZero3PodiumDraftBody,
  SaveZero3PodiumDraftParams,
  SaveZero3PodiumDraftResponse,
} from "@workspace/api-zod";
import {
  d1ApiError,
  d1Date,
  d1IsoNow,
  d1JsonArray,
  newD1Id,
  requireD1Member,
} from "./d1-staging-shared";
import { readD1ActiveBattery } from "./d1-staging-batteries";
import { handleD1BatteryFinalization } from "./d1-staging-finalization";

type TimerRow = {
  event_id: string; proof_id:string; battery_order:number; state: string; elapsed_ms: number; started_at: string | null;
  preparation_ends_at: string | null; version: number; last_command_id: string | null;
  updated_at: string;
};
type EventRow = { id: string; preparation_seconds: number };
type PodiumRow = {
  event_id: string; category: string; registration_ids: string; published: number;
  published_by: string | null; published_at: string | null; publish_reason: string | null;
  version: number; updated_at: string;
};

const EVENT_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;
const PODIUM_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;

function timerDto(row: TimerRow, preparationSeconds: number, now = new Date()) {
  const elapsedMs = Math.floor(row.elapsed_ms +
    (row.state === "RUNNING" && row.started_at
      ? Math.max(0, now.getTime() - Date.parse(row.started_at))
      : 0));
  return {
    eventId: row.event_id,
    state: row.state,
    elapsedMs,
    preparationRemainingMs: row.state === "PREPARATION" && row.preparation_ends_at
      ? Math.max(0, Math.ceil(Date.parse(row.preparation_ends_at) - now.getTime()))
      : 0,
    preparationSeconds,
    startedAt: d1Date(row.started_at),
    version: row.version,
    updatedAt: d1Date(row.updated_at),
    proofId:row.proof_id,
    batteryOrder:row.battery_order,
  };
}

function podiumDto(row: PodiumRow | null) {
  if (!row) return null;
  let registrationIds: Array<string | null>;
  try {
    const parsed: unknown = JSON.parse(row.registration_ids);
    registrationIds = Array.isArray(parsed)
      ? parsed.map((item) => typeof item === "string" ? item : null)
      : [];
  } catch { registrationIds = []; }
  return {
    eventId: row.event_id,
    category: row.category,
    registrationIds,
    published: row.published === 1,
    publishedBy: row.published_by,
    publishedAt: d1Date(row.published_at),
    publishReason: row.publish_reason,
    version: row.version,
    updatedAt: d1Date(row.updated_at),
  };
}

async function eventForTimer(DB: D1Database, eventId: string) {
  return DB.prepare("SELECT id,preparation_seconds FROM zero3_events WHERE id=?")
    .bind(eventId).first<EventRow>();
}

export async function handleD1StagingControls(
  req: Request,
  res: Response,
  DB: D1Database,
): Promise<boolean> {
  if (await handleD1BatteryFinalization(req, res, DB)) return true;
  const route = req.path.slice("/api/zero3".length);

  const timerMatch = route.match(/^\/events\/([^/]+)\/timer$/);
  if (timerMatch && req.method === "PUT") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const body = ControlZero3TimerBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const event = await eventForTimer(DB, timerMatch[1]);
    if (!event) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
    const now = new Date();
    const nowIso = now.toISOString();
    try {
      const activeBattery=await readD1ActiveBattery(DB,event.id);
      if(!activeBattery){d1ApiError(req,res,409,"BATTERY_NOT_SELECTED","Selecione uma bateria vinculada a uma prova antes de controlar o cronômetro.");return true;}
      await DB.prepare(`INSERT OR IGNORE INTO zero3_heat_runs(event_id,proof_id,battery_order)
        VALUES(?,?,?)`).bind(event.id,activeBattery.proofId,activeBattery.order).run();
      let timer = await DB.prepare(`SELECT * FROM zero3_heat_runs
        WHERE event_id=? AND proof_id=? AND battery_order=?`)
        .bind(event.id,activeBattery.proofId,activeBattery.order).first<TimerRow>();
      if (!timer) { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar o cronômetro."); return true; }
      if (timer.last_command_id === body.data.commandId) {
        res.json(ControlZero3TimerResponse.parse(timerDto(timer, event.preparation_seconds, now)));
        return true;
      }
      if (timer.version !== body.data.expectedVersion) {
        d1ApiError(req, res, 409, "TIMER_VERSION_CONFLICT", "O timer mudou em outra tela. Atualize e tente novamente.");
        return true;
      }
      const liveElapsed = timer.state === "RUNNING" && timer.started_at
        ? timer.elapsed_ms + now.getTime() - Date.parse(timer.started_at)
        : timer.elapsed_ms;
      let next: Pick<TimerRow, "state" | "elapsed_ms" | "started_at" | "preparation_ends_at">;
      switch (body.data.action) {
        case "prepare":
          if (timer.state === "RUNNING" || timer.state === "PAUSED") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = {
            state: "PREPARATION", elapsed_ms: 0, started_at: null,
            preparation_ends_at: new Date(now.getTime() + event.preparation_seconds * 1000).toISOString(),
          };
          break;
        case "start":
          if (timer.state !== "IDLE" && timer.state !== "FINISHED") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = { state: "RUNNING", elapsed_ms: 0, started_at: nowIso, preparation_ends_at: null };
          break;
        case "pause":
          if (timer.state !== "RUNNING") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = { state: "PAUSED", elapsed_ms: Math.floor(liveElapsed), started_at: null, preparation_ends_at: null };
          break;
        case "resume":
          if (timer.state !== "PAUSED") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = { state: "RUNNING", elapsed_ms: timer.elapsed_ms, started_at: nowIso, preparation_ends_at: null };
          break;
        case "finish":
          if (timer.state !== "RUNNING" && timer.state !== "PAUSED") {
            res.status(400).json({ error: "Este comando não é válido para o estado atual." }); return true;
          }
          next = { state: "FINISHED", elapsed_ms: Math.floor(liveElapsed), started_at: null, preparation_ends_at: null };
          break;
        case "reset":
          next = { state: "IDLE", elapsed_ms: 0, started_at: null, preparation_ends_at: null };
          break;
      }
      const saved = await DB.prepare(`UPDATE zero3_heat_runs SET state=?,elapsed_ms=?,started_at=?,
        preparation_ends_at=?,version=version+1,last_command_id=?,updated_at=?
        WHERE event_id=? AND proof_id=? AND battery_order=? AND version=?
        AND (last_command_id IS NULL OR last_command_id<>?)`)
        .bind(next.state, next.elapsed_ms, next.started_at, next.preparation_ends_at,
          body.data.commandId, nowIso, event.id, activeBattery.proofId, activeBattery.order,
          body.data.expectedVersion, body.data.commandId).run();
      timer = await DB.prepare(`SELECT * FROM zero3_heat_runs
        WHERE event_id=? AND proof_id=? AND battery_order=?`)
        .bind(event.id,activeBattery.proofId,activeBattery.order).first<TimerRow>();
      if ((saved.meta.changes ?? 0) !== 1) {
        if (timer?.last_command_id === body.data.commandId) {
          res.json(ControlZero3TimerResponse.parse(timerDto(timer, event.preparation_seconds, now)));
        } else d1ApiError(req, res, 409, "TIMER_VERSION_CONFLICT", "O timer mudou em outra tela. Atualize e tente novamente.");
        return true;
      }
      if (!timer) { d1ApiError(req, res, 500, "API_INTERNAL_ERROR", "Cronômetro atualizado, mas não foi possível recuperá-lo."); return true; }
      res.json(ControlZero3TimerResponse.parse(timerDto(timer, event.preparation_seconds, now)));
    } catch { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível atualizar o cronômetro."); }
    return true;
  }

  const podiumMatch = route.match(/^\/events\/([^/]+)\/podiums\/([^/]+)$/);
  if (podiumMatch && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, PODIUM_ROLES)) return true;
    const params = GetZero3PodiumStateParams.safeParse({ eventId: podiumMatch[1], category: podiumMatch[2] });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return true; }
    try {
      const rows = await DB.prepare(`SELECT * FROM zero3_podium_versions
        WHERE event_id=? AND category=? ORDER BY version DESC`)
        .bind(params.data.eventId, params.data.category).all<PodiumRow>();
      const draft = rows.results.find((row) => row.published === 0) ?? null;
      const published = rows.results.find((row) => row.published === 1) ?? null;
      res.json(GetZero3PodiumStateResponse.parse({ draft: podiumDto(draft), published: podiumDto(published) }));
    } catch { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar o estado do pódio."); }
    return true;
  }

  if (podiumMatch && req.method === "PUT") {
    if (!await requireD1Member(req, res, DB, PODIUM_ROLES)) return true;
    const params = SaveZero3PodiumDraftParams.safeParse({ eventId: podiumMatch[1], category: podiumMatch[2] });
    const body = SaveZero3PodiumDraftBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos." });
      return true;
    }
    const selected = body.data.registrationIds.filter((id): id is string => id !== null);
    if (new Set(selected).size !== selected.length) { res.status(400).json({ error: "Cada posição do pódio deve ser única." }); return true; }
    try {
      if (selected.length) {
        const registrations = await DB.prepare(`SELECT id,category FROM zero3_registrations
          WHERE event_id=? AND id IN (${selected.map(() => "?").join(",")})`)
          .bind(params.data.eventId, ...selected).all<{ id: string; category: string }>();
        if (registrations.results.length !== selected.length ||
            registrations.results.some((row) => row.category !== params.data.category)) {
          res.status(400).json({ error: "Pódio deve usar inscrições desta categoria." }); return true;
        }
      }
      const latest = await DB.prepare(`SELECT * FROM zero3_podium_versions
        WHERE event_id=? AND category=? ORDER BY version DESC LIMIT 1`)
        .bind(params.data.eventId, params.data.category).first<PodiumRow>();
      const stamp = d1IsoNow();
      if (latest && latest.published === 0) {
        const result = await DB.prepare(`UPDATE zero3_podium_versions SET registration_ids=?,updated_at=?
          WHERE event_id=? AND category=? AND version=? AND published=0`)
          .bind(JSON.stringify(body.data.registrationIds), stamp, params.data.eventId, params.data.category, latest.version).run();
        if ((result.meta.changes ?? 0) !== 1) { d1ApiError(req, res, 409, "PODIUM_CONFLICT", "O rascunho mudou em outra operação. Atualize e tente novamente."); return true; }
        const saved = await DB.prepare(`SELECT * FROM zero3_podium_versions
          WHERE event_id=? AND category=? AND version=?`)
          .bind(params.data.eventId, params.data.category, latest.version).first<PodiumRow>();
        res.json(SaveZero3PodiumDraftResponse.parse(podiumDto(saved)));
      } else {
        const version = (latest?.version ?? 0) + 1;
        await DB.prepare(`INSERT INTO zero3_podium_versions
          (event_id,category,registration_ids,published,published_by,published_at,publish_reason,version,updated_at)
          VALUES(?,?,?,0,NULL,NULL,NULL,?,?)`)
          .bind(params.data.eventId, params.data.category, JSON.stringify(body.data.registrationIds), version, stamp).run();
        const saved = await DB.prepare(`SELECT * FROM zero3_podium_versions
          WHERE event_id=? AND category=? AND version=?`)
          .bind(params.data.eventId, params.data.category, version).first<PodiumRow>();
        res.json(SaveZero3PodiumDraftResponse.parse(podiumDto(saved)));
      }
    } catch { d1ApiError(req, res, 409, "PODIUM_CONFLICT", "Não foi possível salvar o rascunho do pódio."); }
    return true;
  }

  const publishMatch = route.match(/^\/events\/([^/]+)\/podiums\/([^/]+)\/publish$/);
  if (publishMatch && req.method === "POST") {
    const member = await requireD1Member(req, res, DB, PODIUM_ROLES);
    if (!member) return true;
    const params = PublishZero3PodiumParams.safeParse({ eventId: publishMatch[1], category: publishMatch[2] });
    const body = PublishZero3PodiumBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Informe o motivo da publicação." });
      return true;
    }
    try {
      const draft = await DB.prepare(`SELECT * FROM zero3_podium_versions
        WHERE event_id=? AND category=? ORDER BY version DESC LIMIT 1`)
        .bind(params.data.eventId, params.data.category).first<PodiumRow>();
      if (!draft) { res.status(400).json({ error: "Salve um rascunho antes de publicar." }); return true; }
      if (draft.published === 1) { res.json(PublishZero3PodiumResponse.parse(podiumDto(draft))); return true; }
      let ids: Array<string | null>;
      try {
        const parsed: unknown = JSON.parse(draft.registration_ids);
        ids = Array.isArray(parsed) ? parsed.map((item) => typeof item === "string" ? item : null) : [];
      } catch { ids = []; }
      if (ids.length !== 3 || ids.some((id) => !id)) { res.status(400).json({ error: "Selecione os três lugares do pódio." }); return true; }
      const registrations = await DB.prepare(`SELECT id,category FROM zero3_registrations
        WHERE event_id=? AND id IN (${ids.map(() => "?").join(",")})`)
        .bind(params.data.eventId, ...ids as string[]).all<{ id: string; category: string }>();
      if (registrations.results.length !== 3 || registrations.results.some((row) => row.category !== params.data.category)) {
        res.status(409).json({ error: "As inscrições do rascunho já não pertencem a esta categoria." }); return true;
      }
      const stamp = d1IsoNow();
      const result = await DB.prepare(`UPDATE zero3_podium_versions SET published=1,published_by=?,
        published_at=?,publish_reason=?,updated_at=?
        WHERE event_id=? AND category=? AND version=? AND published=0`)
        .bind(member.email, stamp, body.data.reason, stamp, params.data.eventId, params.data.category, draft.version).run();
      if ((result.meta.changes ?? 0) !== 1) { d1ApiError(req, res, 409, "PODIUM_CONFLICT", "O rascunho mudou antes da publicação. Atualize e tente novamente."); return true; }
      const published = await DB.prepare(`SELECT * FROM zero3_podium_versions
        WHERE event_id=? AND category=? AND version=?`)
        .bind(params.data.eventId, params.data.category, draft.version).first<PodiumRow>();
      res.json(PublishZero3PodiumResponse.parse(podiumDto(published)));
    } catch { d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível publicar o pódio."); }
    return true;
  }

  return false;
}
