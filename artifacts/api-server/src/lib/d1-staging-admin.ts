import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import {
  CreateZero3AthleteBody,
  CreateZero3AthleteResponse,
  CreateZero3EventBody,
  CreateZero3EventResponse,
  CreateZero3HeatBody,
  CreateZero3HeatResponse,
  CreateZero3RegistrationBody,
  CreateZero3RegistrationResponse,
  CancelZero3RegistrationBody,
  CancelZero3RegistrationParams,
  CancelZero3RegistrationResponse,
  DeleteZero3AthleteParams,
  DeleteZero3AthleteResponse,
  DeleteZero3RegistrationParams,
  DeleteZero3RegistrationResponse,
  ListZero3AthletesResponse,
  ListZero3HeatsParams,
  ListZero3HeatsResponse,
  ListZero3MembersResponse,
  SetZero3ActiveHeatBody,
  SetZero3ActiveHeatParams,
  SetZero3ActiveHeatResponse,
  SetZero3ActiveBatteryBody,
  SetZero3ActiveBatteryParams,
  SetZero3ActiveBatteryResponse,
  UpdateZero3HeatProofBody,
  UpdateZero3HeatProofParams,
  UpdateZero3HeatProofResponse,
  SetZero3MemberRoleBody,
  SetZero3MemberRoleResponse,
  UpdateZero3EventBody,
  UpdateZero3EventParams,
  UpdateZero3EventResponse,
  UpdateZero3ProofBody,
  UpdateZero3ProofParams,
  UpdateZero3ProofResponse,
  UpdateZero3RegistrationBody,
  UpdateZero3RegistrationParams,
  UpdateZero3RegistrationResponse,
  UpdateZero3AthleteBody,
  UpdateZero3AthleteParams,
  UpdateZero3AthleteResponse,
} from "@workspace/api-zod";
import {
  d1ApiError,
  d1Date,
  d1IsoNow,
  d1JsonArray,
  newD1Id,
  requireD1Member,
} from "./d1-staging-shared";
import { resolveHeatRegistrationAssignments } from "./zero3-heat-assignments";
import { normalizeEventCategories, validateEventCategories } from "./zero3-categories";
import { parseZero3TeamName } from "./zero3-team-name";
import { handleD1StagingEventLifecycle } from "./d1-staging-event-lifecycle";
import { BatteryConflict, selectD1ActiveBattery } from "./d1-staging-batteries";

type EventRow = {
  id: string; name: string; proof_name: string; status: string;
  preparation_seconds: number; categories: string; created_at: string;
};
type ProofRow = {
  id: string; event_id: string; proof_order: number; name: string;
  metric_type: string; unit: string | null; direction: string | null;
  created_at: string; updated_at: string;
};
type AthleteRow = { id: string; full_name: string; created_at: string };
type RegistrationRow = {
  id: string; event_id: string; category: string; team_name: string | null;
  athlete_ids: string; lane_label: string | null; confirmation_status: string;
  payment_status: string; created_at: string;
};
type HeatRow = {
  id: string; event_id: string; category: string; name: string; order: number;
  proof_id?: string | null; proof_order?: number | null; proof_name?: string | null;
  battery_order?: number | null;
};

const ADMIN = ["ADMIN"] as const;
const EVENT_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;
const RESULT_ROLES = ["ADMIN", "JUIZ_CHEFE", "JUIZ"] as const;

const eventDto = (row: EventRow) => ({
  id: row.id, name: row.name, proofName: row.proof_name, status: row.status,
  preparationSeconds: row.preparation_seconds,
  categories: d1JsonArray(row.categories),
  createdAt: d1Date(row.created_at),
});
const proofDto = (row: ProofRow) => ({
  id: row.id, eventId: row.event_id, order: row.proof_order, name: row.name,
  metricType: row.metric_type, unit: row.unit, direction: row.direction,
  configured: row.metric_type !== "UNCONFIGURED" && Boolean(row.name.trim()) &&
    (row.direction === "LOWER" || row.direction === "HIGHER"),
  createdAt: d1Date(row.created_at),
});
const athleteDto = (row: AthleteRow) => ({
  id: row.id, fullName: row.full_name, createdAt: d1Date(row.created_at),
});

async function registrationDto(DB: D1Database, row: RegistrationRow) {
  const athleteIds = d1JsonArray(row.athlete_ids);
  const athletes = athleteIds.length
    ? (await DB.prepare(
        `SELECT id,full_name FROM zero3_athletes WHERE id IN (${athleteIds.map(() => "?").join(",")})`,
      ).bind(...athleteIds).all<{ id: string; full_name: string }>()).results
    : [];
  const names = new Map(athletes.map((athlete) => [athlete.id, athlete.full_name]));
  return {
    id: row.id, eventId: row.event_id, category: row.category,
    teamName: row.team_name, athleteIds,
    athleteNames: athleteIds.map((athleteId) => names.get(athleteId) ?? "Atleta removido"),
    laneLabel: row.lane_label, createdAt: d1Date(row.created_at),
  };
}

function internalError(req: Request, res: Response, message: string) {
  d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", message);
}

export async function handleD1StagingAdmin(
  req: Request,
  res: Response,
  DB: D1Database,
): Promise<boolean> {
  const route = req.path.slice("/api/zero3".length);
  if (await handleD1StagingEventLifecycle(req, res, DB)) return true;

  if (route === "/events" && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const parsed = CreateZero3EventBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return true; }
    const categoryError = parsed.data.categories && validateEventCategories(parsed.data.categories);
    if (categoryError) {
      res.status(400).json({ error: categoryError });
      return true;
    }
    const eventId = newD1Id();
    const stamp = d1IsoNow();
    const proofName = parsed.data.proofName?.trim() || "4 provas — configuração pendente";
    const categories = normalizeEventCategories(parsed.data.categories ?? ["SC", "RX"]);
    try {
      const statements: D1PreparedStatement[] = [
        DB.prepare(`INSERT INTO zero3_events
          (id,name,proof_name,status,preparation_seconds,categories,created_at) VALUES(?,?,?,'PLANNED',?,?,?)`)
          .bind(eventId, parsed.data.name.trim(), proofName, parsed.data.preparationSeconds, JSON.stringify(categories), stamp),
        ...[1, 2, 3, 4].map((order) => DB.prepare(`INSERT INTO zero3_proofs
          (id,event_id,proof_order,name,metric_type,unit,direction,created_at,updated_at)
          VALUES(?,?,?,'','UNCONFIGURED',NULL,NULL,?,?)`)
          .bind(newD1Id(), eventId, order, stamp, stamp)),
        DB.prepare("INSERT INTO zero3_timers(event_id) VALUES(?)").bind(eventId),
      ];
      await DB.batch(statements);
      const row = await DB.prepare("SELECT * FROM zero3_events WHERE id=?").bind(eventId).first<EventRow>();
      if (!row) { d1ApiError(req, res, 500, "API_INTERNAL_ERROR", "Evento criado, mas não foi possível recuperá-lo."); return true; }
      res.status(201).json(CreateZero3EventResponse.parse(eventDto(row)));
    } catch {
      internalError(req, res, "Não foi possível criar o evento.");
    }
    return true;
  }

  const eventMatch = route.match(/^\/events\/([^/]+)$/);
  if (eventMatch && req.method === "PATCH") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = UpdateZero3EventParams.safeParse({ eventId: eventMatch[1] });
    const body = UpdateZero3EventBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos." });
      return true;
    }
    const categoryError = body.data.categories && validateEventCategories(body.data.categories);
    if (categoryError) {
      res.status(400).json({ error: categoryError });
      return true;
    }
    const fields: Array<[string, unknown]> = [];
    if (body.data.categories) {
      const [registrations, heats, results, activeHeats, podiums] = await Promise.all([
        DB.prepare("SELECT category FROM zero3_registrations WHERE event_id=?").bind(params.data.eventId).all<{ category: string }>(),
        DB.prepare("SELECT category FROM zero3_heats WHERE event_id=?").bind(params.data.eventId).all<{ category: string }>(),
        DB.prepare("SELECT category FROM zero3_results WHERE event_id=?").bind(params.data.eventId).all<{ category: string }>(),
        DB.prepare("SELECT category FROM zero3_active_heats WHERE event_id=?").bind(params.data.eventId).all<{ category: string }>(),
        DB.prepare("SELECT category FROM zero3_podium_versions WHERE event_id=?").bind(params.data.eventId).all<{ category: string }>(),
      ]);
      const configured = new Set(normalizeEventCategories(body.data.categories));
      const inUse = [
        ...registrations.results.map((row) => row.category),
        ...heats.results.map((row) => row.category),
        ...results.results.map((row) => row.category),
        ...activeHeats.results.map((row) => row.category),
        ...podiums.results.map((row) => row.category),
      ];
        const removed = [...new Set(inUse)].filter((category) => !configured.has(category));
      if (removed.length) {
        res.status(409).json({ error: `Não é possível remover ${removed.join(", ")}: a categoria já possui inscrições ou histórico.` });
        return true;
      }
    }
    if (body.data.name !== undefined) fields.push(["name", body.data.name.trim()]);
    if (body.data.proofName !== undefined) fields.push(["proof_name", body.data.proofName.trim()]);
    if (body.data.status !== undefined) fields.push(["status", body.data.status]);
    if (body.data.preparationSeconds !== undefined) fields.push(["preparation_seconds", body.data.preparationSeconds]);
    if (body.data.categories !== undefined) {
      const ordered = normalizeEventCategories(body.data.categories);
      fields.push(["categories", JSON.stringify(ordered)]);
    }
    if (!fields.length) { res.status(400).json({ error: "Informe ao menos um campo para atualizar." }); return true; }
    try {
      await DB.prepare(`UPDATE zero3_events SET ${fields.map(([name]) => `${name}=?`).join(",")}
        WHERE id=?`).bind(...fields.map(([, value]) => value), params.data.eventId).run();
      const row = await DB.prepare("SELECT * FROM zero3_events WHERE id=?").bind(params.data.eventId).first<EventRow>();
      if (!row) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
      res.json(UpdateZero3EventResponse.parse(eventDto(row)));
    } catch { internalError(req, res, "Não foi possível atualizar o evento."); }
    return true;
  }

  const proofMatch = route.match(/^\/events\/([^/]+)\/proofs\/([^/]+)$/);
  if (proofMatch && req.method === "PATCH") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = UpdateZero3ProofParams.safeParse({ eventId: proofMatch[1], proofId: proofMatch[2] });
    const body = UpdateZero3ProofBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos." });
      return true;
    }
    if (body.data.metricType === "UNCONFIGURED") {
      res.status(400).json({ error: "Selecione uma métrica válida." }); return true;
    }
    try {
      const proof = await DB.prepare("SELECT * FROM zero3_proofs WHERE id=? AND event_id=?")
        .bind(params.data.proofId, params.data.eventId).first<ProofRow>();
      if (!proof) { res.status(404).json({ error: "Prova não encontrada." }); return true; }
      const result = await DB.prepare("SELECT id FROM zero3_results WHERE proof_id=? LIMIT 1")
        .bind(proof.id).first<{ id: string }>();
      if (result && (proof.metric_type !== body.data.metricType || proof.direction !== body.data.direction)) {
        res.status(409).json({ error: "A métrica e a direção não podem mudar após lançamentos. Revise os resultados antes de alterar a regra." });
        return true;
      }
      const stamp = d1IsoNow();
      await DB.prepare(`UPDATE zero3_proofs SET name=?,metric_type=?,unit=?,direction=?,updated_at=?
        WHERE id=? AND event_id=?`)
        .bind(body.data.name.trim(), body.data.metricType, body.data.unit?.trim() || null,
          body.data.direction, stamp, proof.id, params.data.eventId).run();
      const updated = await DB.prepare("SELECT * FROM zero3_proofs WHERE id=?").bind(proof.id).first<ProofRow>();
      res.json(UpdateZero3ProofResponse.parse(proofDto(updated!)));
    } catch { internalError(req, res, "Não foi possível atualizar a prova."); }
    return true;
  }

  if (route === "/athletes" && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, RESULT_ROLES)) return true;
    try {
      const rows = await DB.prepare("SELECT * FROM zero3_athletes ORDER BY full_name COLLATE NOCASE").all<AthleteRow>();
      res.json(ListZero3AthletesResponse.parse(rows.results.map(athleteDto)));
    } catch { internalError(req, res, "Não foi possível consultar os atletas."); }
    return true;
  }

  if (route === "/athletes" && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const body = CreateZero3AthleteBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const row = { id: newD1Id(), full_name: body.data.fullName.trim(), created_at: d1IsoNow() };
    try {
      await DB.prepare("INSERT INTO zero3_athletes(id,full_name,created_at) VALUES(?,?,?)")
        .bind(row.id, row.full_name, row.created_at).run();
      res.status(201).json(CreateZero3AthleteResponse.parse(athleteDto(row)));
    } catch { internalError(req, res, "Não foi possível cadastrar o atleta."); }
    return true;
  }

  const athleteMatch = route.match(/^\/athletes\/([^/]+)$/);
  if (athleteMatch && req.method === "PUT") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = UpdateZero3AthleteParams.safeParse({ athleteId: athleteMatch[1] });
    const body = UpdateZero3AthleteBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Informe o nome completo do atleta." });
      return true;
    }
    try {
      await DB.prepare("UPDATE zero3_athletes SET full_name=? WHERE id=?")
        .bind(body.data.fullName.trim(), params.data.athleteId).run();
      const row = await DB.prepare("SELECT * FROM zero3_athletes WHERE id=?").bind(params.data.athleteId).first<AthleteRow>();
      if (!row) { res.status(404).json({ error: "Atleta não encontrado." }); return true; }
      res.json(UpdateZero3AthleteResponse.parse(athleteDto(row!)));
    } catch { internalError(req, res, "Não foi possível atualizar o atleta."); }
    return true;
  }

  if (athleteMatch && req.method === "DELETE") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = DeleteZero3AthleteParams.safeParse({ athleteId: athleteMatch[1] });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return true; }
    try {
      const athleteId = params.data.athleteId;
      const deleted = await DB.prepare(`DELETE FROM zero3_athletes WHERE id=?
        AND NOT EXISTS(SELECT 1 FROM zero3_registration_members WHERE athlete_id=?)
        AND NOT EXISTS(SELECT 1 FROM zero3_registrations r, json_each(r.athlete_ids) j WHERE j.value=?)
        AND NOT EXISTS(SELECT 1 FROM zero3_import_people WHERE athlete_id=?)`)
        .bind(athleteId, athleteId, athleteId, athleteId).run();
      if ((deleted.meta.changes ?? 0) === 1) {
        res.json(DeleteZero3AthleteResponse.parse({ id: athleteId, deleted: true }));
        return true;
      }

      const row = await DB.prepare("SELECT id FROM zero3_athletes WHERE id=?")
        .bind(athleteId).first<{ id: string }>();
      if (!row) { res.status(404).json({ error: "Atleta não encontrado." }); return true; }
      const linked = await DB.prepare(`SELECT
        (SELECT COUNT(*) FROM (
          SELECT registration_id FROM zero3_registration_members WHERE athlete_id=?
          UNION
          SELECT r.id FROM zero3_registrations r, json_each(r.athlete_ids) j WHERE j.value=?
        )) AS registration_count,
        (SELECT COUNT(DISTINCT batch_id) FROM zero3_import_people WHERE athlete_id=?) AS import_count`)
        .bind(athleteId, athleteId, athleteId)
        .first<{ registration_count: number; import_count: number }>();
      const blockedBy = [
        ...(linked?.registration_count ? [{
          kind: "REGISTRATION",
          count: linked.registration_count,
          href: "/admin/roster/manage",
          label: "Inscrições e equipes",
        }] : []),
        ...(linked?.import_count ? [{
          kind: "IMPORT_HISTORY",
          count: linked.import_count,
          href: "/admin/roster/import",
          label: "Histórico de importação",
        }] : []),
      ];
      if (blockedBy.length) {
        const locations = blockedBy.map((item) =>
          `${item.count} vínculo(s) em ${item.label} (${item.href})`,
        ).join(" e ");
        res.status(409).json({
          code: "ATHLETE_HAS_LINKS",
          error: `Não é possível excluir: ${locations}. Revise esses vínculos sem apagar o histórico da competição.`,
          blockedBy,
        });
        return true;
      }
      res.status(409).json({
        code: "ATHLETE_DELETE_CONFLICT",
        error: "O atleta foi alterado por outra operação. Atualize a lista e tente novamente.",
      });
    } catch { internalError(req, res, "Não foi possível excluir o atleta."); }
    return true;
  }

  const activeHeatMatch = route.match(/^\/events\/([^/]+)\/active-heats\/([^/]+)$/);
  if (activeHeatMatch && req.method === "PUT") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = SetZero3ActiveHeatParams.safeParse({ eventId: activeHeatMatch[1], category: activeHeatMatch[2] });
    const body = SetZero3ActiveHeatBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Selecione uma bateria válida." });
      return true;
    }
    try {
      let heatName: string | null = null;
      let proofId: string | null = null;
      let proofOrder: number | null = null;
      let batteryOrder: number | null = null;
      if (body.data.heatId) {
        const heat = await DB.prepare(`SELECT h.name,h.proof_id,h.battery_order,h."order" AS heat_order,p.proof_order
          FROM zero3_heats h LEFT JOIN zero3_proofs p ON p.id=h.proof_id
          WHERE h.id=? AND h.event_id=? AND h.category=?`)
          .bind(body.data.heatId, params.data.eventId, params.data.category)
          .first<{name:string;proof_id:string|null;battery_order:number|null;heat_order:number;proof_order:number|null}>();
        if (!heat) { res.status(400).json({ error: "A bateria precisa pertencer ao evento e à categoria selecionados." }); return true; }
        if (!heat.proof_id || !heat.proof_order) {
          res.status(400).json({ error: "Vincule a bateria a uma prova antes de colocá-la na TV." }); return true;
        }
        const selected = await selectD1ActiveBattery(DB, params.data.eventId, body.data.heatId);
        heatName = heat.name;
        proofId = heat.proof_id;
        proofOrder = heat.proof_order;
        batteryOrder = heat.battery_order ?? heat.heat_order;
        res.json(SetZero3ActiveHeatResponse.parse({
          eventId: params.data.eventId, category: params.data.category,
          heatId: body.data.heatId, heatName, proofId, proofOrder, batteryOrder,
          updatedAt: selected.updatedAt,
        }));
        return true;
      }
      const stamp = d1IsoNow();
      const selected = await selectD1ActiveBattery(DB, params.data.eventId, null);
      res.json(SetZero3ActiveHeatResponse.parse({
        eventId: params.data.eventId, category: params.data.category,
        heatId: null, heatName, proofId, proofOrder, batteryOrder,
        updatedAt: selected.updatedAt,
      }));
    } catch (cause) {
      if (cause instanceof BatteryConflict) d1ApiError(req, res, cause.status, cause.code, cause.message);
      else internalError(req, res, "Não foi possível selecionar a bateria ativa.");
    }
    return true;
  }

  const activeBatteryMatch = route.match(/^\/events\/([^/]+)\/active-battery$/);
  if (activeBatteryMatch && req.method === "PUT") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = SetZero3ActiveBatteryParams.safeParse({eventId:activeBatteryMatch[1]});
    const body = SetZero3ActiveBatteryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({error:!params.success?params.error.message:body.error?.message??"Selecione uma bateria válida."});
      return true;
    }
    try {
      const selected = await selectD1ActiveBattery(DB,params.data.eventId,body.data.heatId);
      res.json(SetZero3ActiveBatteryResponse.parse(selected));
    } catch (cause) {
      if (cause instanceof BatteryConflict) d1ApiError(req,res,cause.status,cause.code,cause.message);
      else internalError(req,res,"Não foi possível selecionar a bateria ativa.");
    }
    return true;
  }

  const registrationsMatch = route.match(/^\/events\/([^/]+)\/registrations$/);
  if (registrationsMatch && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const body = CreateZero3RegistrationBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const parsedTeamName = parseZero3TeamName(body.data.teamName);
    if (!parsedTeamName.success) { res.status(400).json({ error: parsedTeamName.error }); return true; }
    const eventId = registrationsMatch[1];
    const event = await DB.prepare("SELECT categories FROM zero3_events WHERE id=?")
      .bind(eventId).first<{ categories: string }>();
    if (!event) { res.status(404).json({ error: "Prova não encontrada." }); return true; }
    if (!d1JsonArray(event.categories).includes(body.data.category)) {
      res.status(400).json({ error: "A categoria não está habilitada para este evento." });
      return true;
    }
    if (body.data.athleteIds.length > 2) {
      res.status(400).json({ error: "Uma inscrição pode conter no máximo dois atletas." });
      return true;
    }
    const athleteIds = body.data.athleteIds;
    if (new Set(athleteIds).size !== athleteIds.length) { res.status(400).json({ error: "Há atletas duplicados nesta inscrição." }); return true; }
    if (athleteIds.length !== 2) { res.status(400).json({ error: "Uma dupla precisa conter exatamente dois atletas." }); return true; }
    try {
      const event = await DB.prepare("SELECT id FROM zero3_events WHERE id=?").bind(eventId).first<{ id: string }>();
      if (!event) { res.status(404).json({ error: "Evento não encontrado." }); return true; }
      const athleteRows = await DB.prepare(`SELECT id FROM zero3_athletes WHERE id IN (${athleteIds.map(() => "?").join(",")})`).bind(...athleteIds).all<{ id: string }>();
      if (athleteRows.results.length !== athleteIds.length) { res.status(400).json({ error: "Selecione atletas cadastrados." }); return true; }
      const existingRows = await DB.prepare("SELECT id,category,athlete_ids FROM zero3_registrations WHERE event_id=?").bind(eventId).all<{ id: string; category: string; athlete_ids: string }>();
      const candidate = [...athleteIds].sort().join(":");
      if (existingRows.results.some((row) => [...d1JsonArray(row.athlete_ids)].sort().join(":") === candidate)) {
        res.status(409).json({ error: "Esta equipe já está inscrita nesta categoria." }); return true;
      }
      if (existingRows.results.some((row) => d1JsonArray(row.athlete_ids).some((id) => athleteIds.includes(id)))) {
        res.status(409).json({ error: "Um atleta já está inscrito em outra equipe nesta edição." }); return true;
      }
      const registrationId = newD1Id();
      const stamp = d1IsoNow();
      const teamName = parsedTeamName.value;
      const laneLabel = body.data.laneLabel?.trim() || null;
      await DB.batch([
        DB.prepare(`INSERT INTO zero3_registrations
          (id,event_id,category,team_name,athlete_ids,lane_label,confirmation_status,payment_status,created_at)
          VALUES(?,?,?,?,?,?,'PENDING','UNVERIFIED',?)`)
          .bind(registrationId, eventId, body.data.category, teamName, JSON.stringify(athleteIds), laneLabel, stamp),
        ...athleteIds.map((athleteId, index) => DB.prepare(`INSERT INTO zero3_registration_members
          (registration_id,event_id,athlete_id,slot) VALUES(?,?,?,?)`)
          .bind(registrationId, eventId, athleteId, index + 1)),
      ]);
      const row = await DB.prepare("SELECT * FROM zero3_registrations WHERE id=?").bind(registrationId).first<RegistrationRow>();
      res.status(201).json(CreateZero3RegistrationResponse.parse(await registrationDto(DB, row!)));
    } catch {
      const message = "A inscrição conflita com outro cadastro ou não pôde ser salva.";
      d1ApiError(req, res, 409, "REGISTRATION_CONFLICT", message);
    }
    return true;
  }

  const registrationMatch = route.match(/^\/events\/([^/]+)\/registrations\/([^/]+)$/);
  if (registrationMatch && req.method === "DELETE") {
    if (!await requireD1Member(req, res, DB, ADMIN)) return true;
    const [eventId, registrationId] = registrationMatch.slice(1);
    const existing = await DB.prepare("SELECT id FROM zero3_registrations WHERE id=? AND event_id=?")
      .bind(registrationId, eventId).first<{ id: string }>();
    if (!existing) { res.status(404).json({ error: "Inscrição não encontrada." }); return true; }
    const dependencies = await DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM zero3_results WHERE registration_id=?) AS has_results,
      EXISTS(SELECT 1 FROM zero3_heat_entries WHERE registration_id=?) AS has_heat_entries,
      EXISTS(SELECT 1 FROM zero3_registration_audit WHERE registration_id=?) AS has_audit,
      EXISTS(SELECT 1 FROM zero3_import_teams WHERE registration_id=?) AS has_import,
      EXISTS(SELECT 1 FROM zero3_podium_versions p, json_each(p.registration_ids) j
        WHERE p.event_id=? AND j.value=?) AS has_podium,
      EXISTS(SELECT 1 FROM zero3_podium_versions p, json_each(p.registration_ids) j
        WHERE p.event_id=? AND p.published=1 AND j.value=?) AS has_published_podium`)
      .bind(registrationId, registrationId, registrationId, registrationId, eventId, registrationId, eventId, registrationId)
      .first<{ has_results: number; has_heat_entries: number; has_audit: number; has_import: number; has_podium: number; has_published_podium: number }>();
    if (dependencies && Object.values(dependencies).some(Boolean)) {
      const canCancel = !dependencies.has_published_podium;
      res.status(409).json({
        code: "REGISTRATION_HAS_HISTORY",
        canCancel,
        error: canCancel
          ? "Esta inscrição possui resultados, bateria ou histórico. Cancele para preservar os registros."
          : "Esta inscrição está em um pódio publicado. Atualize o pódio antes de cancelar.",
      });
      return true;
    }
    const deleted = await DB.prepare(`DELETE FROM zero3_registrations
      WHERE id=? AND event_id=?
      AND NOT EXISTS(SELECT 1 FROM zero3_results WHERE registration_id=?)
      AND NOT EXISTS(SELECT 1 FROM zero3_heat_entries WHERE registration_id=?)
      AND NOT EXISTS(SELECT 1 FROM zero3_registration_audit WHERE registration_id=?)
      AND NOT EXISTS(SELECT 1 FROM zero3_import_teams WHERE registration_id=?)
      AND NOT EXISTS(SELECT 1 FROM zero3_podium_versions p, json_each(p.registration_ids) j
        WHERE p.event_id=? AND j.value=?)`)
      .bind(registrationId, eventId, registrationId, registrationId, registrationId, registrationId, eventId, registrationId)
      .run();
    if ((deleted.meta.changes ?? 0) !== 1) {
      res.status(409).json({ code: "REGISTRATION_HAS_HISTORY", canCancel: true, error: "A inscrição ganhou um vínculo durante a exclusão. Atualize e tente novamente." });
      return true;
    }
    res.json(DeleteZero3RegistrationResponse.parse({ registrationId, deleted: true }));
    return true;
  }
  const cancelMatch = route.match(/^\/events\/([^/]+)\/registrations\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const member = await requireD1Member(req, res, DB, ADMIN);
    if (!member) return true;
    const body = CancelZero3RegistrationBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const [eventId, registrationId] = cancelMatch.slice(1);
    const row = await DB.prepare("SELECT * FROM zero3_registrations WHERE id=? AND event_id=?")
      .bind(registrationId, eventId).first<RegistrationRow>();
    if (!row) { res.status(404).json({ error: "Inscrição não encontrada." }); return true; }
    if (row.confirmation_status === "CANCELLED") {
      res.status(409).json({ error: "A inscrição já está cancelada." });
      return true;
    }
    const published = await DB.prepare(`SELECT 1 AS found FROM zero3_podium_versions p,
      json_each(p.registration_ids) j WHERE p.event_id=? AND p.published=1 AND j.value=? LIMIT 1`)
      .bind(eventId, registrationId).first<{ found: number }>();
    if (published) {
      res.status(409).json({ error: "A inscrição está em um pódio publicado. Atualize o pódio antes de cancelar." });
      return true;
    }
    const stamp = d1IsoNow();
    const beforeState = JSON.stringify({
      teamName: row.team_name, category: row.category, athleteIds: d1JsonArray(row.athlete_ids),
      confirmationStatus: row.confirmation_status, paymentStatus: row.payment_status,
    });
    const afterState = JSON.stringify({
      teamName: row.team_name, category: row.category, athleteIds: d1JsonArray(row.athlete_ids),
      confirmationStatus: "CANCELLED", paymentStatus: row.payment_status,
    });
    const changes = await DB.batch([
      DB.prepare(`UPDATE zero3_registrations SET confirmation_status='CANCELLED'
        WHERE id=? AND event_id=? AND confirmation_status<> 'CANCELLED'`)
        .bind(registrationId, eventId),
      DB.prepare(`INSERT INTO zero3_registration_audit
        (id,event_id,registration_id,actor_id,reason,before_state,after_state,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`)
        .bind(newD1Id(), eventId, registrationId, member.clerk_user_id, body.data.reason.trim(), beforeState, afterState, stamp),
    ]);
    if ((changes[0]?.meta.changes ?? 0) !== 1) {
      res.status(409).json({ error: "A inscrição foi alterada por outra operação. Atualize a lista." });
      return true;
    }
    res.json(CancelZero3RegistrationResponse.parse({ registrationId, cancelled: true }));
    return true;
  }
  if (registrationMatch && req.method === "PATCH") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = UpdateZero3RegistrationParams.safeParse({ eventId: registrationMatch[1], registrationId: registrationMatch[2] });
    const body = UpdateZero3RegistrationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Informe o nome da equipe." });
      return true;
    }
    const parsedTeamName = parseZero3TeamName(body.data.teamName);
    if (!parsedTeamName.success) {
      res.status(400).json({ error: parsedTeamName.error });
      return true;
    }
    try {
      const current = await DB.prepare("SELECT team_name FROM zero3_registrations WHERE id=? AND event_id=?")
        .bind(params.data.registrationId, params.data.eventId)
        .first<{ team_name: string | null }>();
      if (!current) { res.status(404).json({ error: "Inscrição não encontrada." }); return true; }
      const nextTeamName = parsedTeamName.value;
      const update = await DB.prepare(`UPDATE zero3_registrations SET team_name=?
        WHERE id=? AND event_id=?`)
        .bind(nextTeamName, params.data.registrationId, params.data.eventId).run();
      if ((update.meta.changes ?? 0) !== 1) { res.status(404).json({ error: "Inscrição não encontrada." }); return true; }
      const row = await DB.prepare("SELECT * FROM zero3_registrations WHERE id=?").bind(params.data.registrationId).first<RegistrationRow>();
      res.json(UpdateZero3RegistrationResponse.parse(await registrationDto(DB, row!)));
    } catch { internalError(req, res, "Não foi possível atualizar a inscrição."); }
    return true;
  }

  if (route.match(/^\/events\/[^/]+\/heats$/) && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, RESULT_ROLES)) return true;
    const match = route.match(/^\/events\/([^/]+)\/heats$/)!;
    const params = ListZero3HeatsParams.safeParse({ eventId: match[1] });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return true; }
    try {
      const heats = await DB.prepare(`SELECT h.*,p.proof_order,p.name AS proof_name
        FROM zero3_heats h LEFT JOIN zero3_proofs p ON p.id=h.proof_id
        WHERE h.event_id=? ORDER BY p.proof_order,COALESCE(h.battery_order,h."order"),h.category`)
        .bind(params.data.eventId).all<HeatRow>();
      const publications = await DB.prepare(`SELECT proof_id,battery_order,version,published_at
        FROM zero3_heat_publications WHERE event_id=?
        ORDER BY proof_id,battery_order,version DESC`)
        .bind(params.data.eventId)
        .all<{proof_id:string;battery_order:number;version:number;published_at:string}>();
      const latestPublication = new Map<string,{version:number;publishedAt:string}>();
      for(const publication of publications.results){
        const key=`${publication.proof_id}:${publication.battery_order}`;
        if(!latestPublication.has(key))latestPublication.set(key,{version:publication.version,publishedAt:publication.published_at});
      }
      const payload = [];
      for (const heat of heats.results) {
        const published=heat.proof_id?latestPublication.get(`${heat.proof_id}:${heat.battery_order??heat.order}`):undefined;
        const entries = await DB.prepare(`SELECT r.*, he.lane_label AS heat_lane_label
          FROM zero3_heat_entries he JOIN zero3_registrations r ON r.id=he.registration_id
          WHERE he.heat_id=? AND r.confirmation_status<>'CANCELLED' ORDER BY he.assigned_at`)
          .bind(heat.id).all<RegistrationRow & { heat_lane_label: string | null }>();
        payload.push({
          id:heat.id, proofId:heat.proof_id??null, proofName:heat.proof_name??null,
          proofOrder:heat.proof_order??null, category:heat.category, name:heat.name,
          eventId: heat.event_id,
          order: heat.battery_order??heat.order,
          finalized:Boolean(published),
          finalizationVersion:published?.version??null,
          finalizedAt:published?new Date(published.publishedAt):null,
          registrations: await Promise.all(entries.results.map(async (entry) => ({
            ...(await registrationDto(DB, entry)), laneLabel: entry.heat_lane_label,
          }))),
        });
      }
      res.json(ListZero3HeatsResponse.parse(payload));
    } catch { internalError(req, res, "Não foi possível consultar as baterias."); }
    return true;
  }

  const heatMatch = route.match(/^\/events\/([^/]+)\/heats$/);
  if (heatMatch && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const body = CreateZero3HeatBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const registrationIds = body.data.registrationIds ?? [];
    let proposedOrder: number | null = null;
    try {
      if (!body.data.proofId) { res.status(400).json({error:"Selecione a prova desta bateria."}); return true; }
      const proof = await DB.prepare("SELECT id FROM zero3_proofs WHERE id=? AND event_id=?")
        .bind(body.data.proofId,heatMatch[1]).first<{id:string}>();
      if (!proof) { res.status(400).json({error:"A prova precisa pertencer ao evento selecionado."}); return true; }
      const rows = registrationIds.length
        ? await DB.prepare(`SELECT * FROM zero3_registrations WHERE event_id=? AND category=?
          AND confirmation_status<>'CANCELLED'
          AND id IN (${registrationIds.map(() => "?").join(",")})`)
          .bind(heatMatch[1], body.data.category, ...registrationIds).all<RegistrationRow>()
        : { results: [] as RegistrationRow[] };
      const assignments = resolveHeatRegistrationAssignments(
        registrationIds,
        rows.results.map((row) => ({
          ...row,
          eventId: row.event_id,
          athleteIds: d1JsonArray(row.athlete_ids),
        })),
        heatMatch[1],
        body.data.category,
      );
      if (!assignments.ok) {
        res.status(400).json({ error: assignments.error });
        return true;
      }
      const registrations = assignments.registrations;
      const orderRow = await DB.prepare(`SELECT COALESCE(MAX("order"),0)+1 AS next_order
        FROM zero3_heats WHERE event_id=? AND category=?`)
        .bind(heatMatch[1],body.data.category).first<{next_order:number}>();
      proposedOrder = orderRow?.next_order ?? 1;
      const heatId = newD1Id();
      const { registrationIds: _ignored, ...heat } = body.data;
      await DB.batch([
        DB.prepare(`INSERT INTO zero3_heats(id,event_id,category,name,"order",proof_id,battery_order) VALUES(?,?,?,?,?,?,?)`)
          .bind(heatId, heatMatch[1], heat.category, heat.name.trim(), proposedOrder, heat.proofId, heat.order),
        ...registrations.map((registration) => DB.prepare(`INSERT INTO zero3_heat_entries
          (heat_id,registration_id,lane_label) VALUES(?,?,?)`)
          .bind(heatId, registration.id, registration.lane_label)),
      ]);
      const created = await DB.prepare("SELECT * FROM zero3_heats WHERE id=?").bind(heatId).first<HeatRow>();
      const proofRow = await DB.prepare("SELECT proof_order,name FROM zero3_proofs WHERE id=?")
        .bind(created!.proof_id).first<{proof_order:number;name:string}>();
      const response = {
        id:created!.id,eventId: created!.event_id,category:created!.category,
        proofId:created!.proof_id,proofName:proofRow?.name??null,proofOrder:proofRow?.proof_order??null,
        name:created!.name,order:created!.battery_order??created!.order,
        registrations: await Promise.all(registrations.map((row) => registrationDto(DB, row))),
      };
      res.status(201).json(CreateZero3HeatResponse.parse(response));
    } catch {
      const occupied = proposedOrder === null ? null : await DB.prepare(`SELECT id FROM zero3_heats
        WHERE event_id=? AND category=? AND "order"=?`)
        .bind(heatMatch[1], body.data.category, proposedOrder).first<{ id: string }>().catch(() => null);
      if (occupied) {
        d1ApiError(req,res,409,"HEAT_ORDER_CONFLICT",
          `A ordem ${proposedOrder} já está ocupada nesta categoria do evento.`);
      } else {
        d1ApiError(req,res,503,"DATABASE_UNAVAILABLE",
          "Não foi possível criar a bateria legada. A causa não foi uma ordem ocupada.");
      }
    }
    return true;
  }

  const heatProofMatch = route.match(/^\/events\/([^/]+)\/heats\/([^/]+)\/proof$/);
  if (heatProofMatch && req.method === "PUT") {
    if (!await requireD1Member(req,res,DB,EVENT_ROLES)) return true;
    const params=UpdateZero3HeatProofParams.safeParse({eventId:heatProofMatch[1],heatId:heatProofMatch[2]});
    const body=UpdateZero3HeatProofBody.safeParse(req.body);
    if(!params.success||!body.success){res.status(400).json({error:!params.success?params.error.message:body.error?.message??"Prova inválida."});return true;}
    try {
      const heat=await DB.prepare(`SELECT id,event_id,category,name,"order",proof_id
        FROM zero3_heats WHERE id=? AND event_id=?`)
        .bind(params.data.heatId,params.data.eventId)
        .first<{id:string;event_id:string;category:string;name:string;order:number;proof_id:string|null}>();
      if(!heat){res.status(404).json({error:"Bateria não encontrada neste evento."});return true;}
      if(heat.proof_id){res.status(409).json({error:"Esta bateria já está vinculada a uma prova e não pode ser reatribuída."});return true;}
      const proof=await DB.prepare("SELECT id,proof_order,name FROM zero3_proofs WHERE id=? AND event_id=?")
        .bind(body.data.proofId,params.data.eventId)
        .first<{id:string;proof_order:number;name:string}>();
      if(!proof){res.status(400).json({error:"A prova precisa pertencer ao mesmo evento."});return true;}
      const results=await DB.prepare("SELECT COUNT(*) AS count FROM zero3_results WHERE heat_id=?")
        .bind(heat.id).first<{count:number}>();
      if((results?.count??0)>0){res.status(409).json({error:"A bateria já possui resultados sem vínculo de prova. Ela foi preservada; crie uma nova bateria para evitar reinterpretar o histórico."});return true;}
      const saved=await DB.prepare(`UPDATE zero3_heats SET proof_id=?,battery_order=?
        WHERE id=? AND event_id=? AND proof_id IS NULL`)
        .bind(proof.id,heat.order,heat.id,params.data.eventId).run();
      if((saved.meta.changes??0)!==1){res.status(409).json({error:"A bateria foi alterada por outra operação."});return true;}
      const entries=await DB.prepare(`SELECT r.*,he.lane_label AS heat_lane_label FROM zero3_heat_entries he
        JOIN zero3_registrations r ON r.id=he.registration_id WHERE he.heat_id=?`)
        .bind(heat.id).all<RegistrationRow&{heat_lane_label:string|null}>();
      res.json(UpdateZero3HeatProofResponse.parse({
        id:heat.id,eventId:heat.event_id,category:heat.category,proofId:proof.id,
        proofName:proof.name,proofOrder:proof.proof_order,name:heat.name,order:heat.order,
        registrations:await Promise.all(entries.results.map(async entry=>({...await registrationDto(DB,entry),laneLabel:entry.heat_lane_label}))),
      }));
    } catch { internalError(req,res,"Não foi possível vincular a bateria à prova."); }
    return true;
  }

  if (route === "/members" && req.method === "GET") {
    if (!await requireD1Member(req, res, DB, ADMIN)) return true;
    try {
      const members = await DB.prepare("SELECT email,role,active FROM zero3_members ORDER BY email")
        .all<{ email: string; role: string; active: number }>();
      res.json(ListZero3MembersResponse.parse(members.results.map((row) => ({
        email: row.email, role: row.role, active: row.active === 1,
      }))));
    } catch { internalError(req, res, "Não foi possível consultar os membros."); }
    return true;
  }

  if (route === "/members" && req.method === "PUT") {
    const requester = await requireD1Member(req, res, DB, ADMIN);
    if (!requester) return true;
    const body = SetZero3MemberRoleBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const email = body.data.email.trim().toLowerCase();
    try {
      if (requester.email.toLowerCase() === email && body.data.role !== "ADMIN" && body.data.active) {
        const activeAdmins = await DB.prepare("SELECT COUNT(*) AS count FROM zero3_members WHERE role='ADMIN' AND active=1")
          .first<{ count: number }>();
        if ((activeAdmins?.count ?? 0) <= 1) { res.status(400).json({ error: "Mantenha ao menos um administrador ativo." }); return true; }
      }
      const stamp = d1IsoNow();
      await DB.prepare(`INSERT INTO zero3_members(email,role,active,updated_at)
        VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET
        role=excluded.role,active=excluded.active,updated_at=excluded.updated_at`)
        .bind(email, body.data.role, body.data.active ? 1 : 0, stamp).run();
      const row = await DB.prepare("SELECT email,role,active FROM zero3_members WHERE email=?").bind(email)
        .first<{ email: string; role: string; active: number }>();
      res.json(SetZero3MemberRoleResponse.parse({
        email: row!.email, role: row!.role, active: row!.active === 1,
      }));
    } catch { internalError(req, res, "Não foi possível atualizar o membro."); }
    return true;
  }

  return false;
}
