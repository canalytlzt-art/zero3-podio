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
  DeleteZero3AthleteParams,
  DeleteZero3AthleteResponse,
  ListZero3AthletesResponse,
  ListZero3HeatsParams,
  ListZero3HeatsResponse,
  ListZero3MembersResponse,
  SetZero3ActiveHeatBody,
  SetZero3ActiveHeatParams,
  SetZero3ActiveHeatResponse,
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

type EventRow = {
  id: string; name: string; proof_name: string; status: string;
  preparation_seconds: number; created_at: string;
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
type HeatRow = { id: string; event_id: string; category: string; name: string; order: number };

const ADMIN = ["ADMIN"] as const;
const EVENT_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;
const RESULT_ROLES = ["ADMIN", "JUIZ_CHEFE", "JUIZ"] as const;

const eventDto = (row: EventRow) => ({
  id: row.id, name: row.name, proofName: row.proof_name, status: row.status,
  preparationSeconds: row.preparation_seconds, createdAt: d1Date(row.created_at),
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

  if (route === "/events" && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const parsed = CreateZero3EventBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return true; }
    const eventId = newD1Id();
    const stamp = d1IsoNow();
    const proofName = parsed.data.proofName?.trim() || "4 provas — configuração pendente";
    try {
      const statements: D1PreparedStatement[] = [
        DB.prepare(`INSERT INTO zero3_events
          (id,name,proof_name,status,preparation_seconds,created_at) VALUES(?,?,?,'PLANNED',?,?)`)
          .bind(eventId, parsed.data.name.trim(), proofName, parsed.data.preparationSeconds, stamp),
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
    const fields: Array<[string, unknown]> = [];
    if (body.data.name !== undefined) fields.push(["name", body.data.name.trim()]);
    if (body.data.proofName !== undefined) fields.push(["proof_name", body.data.proofName.trim()]);
    if (body.data.status !== undefined) fields.push(["status", body.data.status]);
    if (body.data.preparationSeconds !== undefined) fields.push(["preparation_seconds", body.data.preparationSeconds]);
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
      const updated = await DB.prepare("UPDATE zero3_athletes SET full_name=? WHERE id=?")
        .bind(body.data.fullName, params.data.athleteId).run();
      if ((updated.meta.changes ?? 0) !== 1) { res.status(404).json({ error: "Atleta não encontrado." }); return true; }
      const row = await DB.prepare("SELECT * FROM zero3_athletes WHERE id=?").bind(params.data.athleteId).first<AthleteRow>();
      res.json(UpdateZero3AthleteResponse.parse(athleteDto(row!)));
    } catch { internalError(req, res, "Não foi possível atualizar o atleta."); }
    return true;
  }

  if (athleteMatch && req.method === "DELETE") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = DeleteZero3AthleteParams.safeParse({ athleteId: athleteMatch[1] });
    if (!params.success) { res.status(400).json({ error: params.error.message }); return true; }
    try {
      const row = await DB.prepare("SELECT id FROM zero3_athletes WHERE id=?").bind(params.data.athleteId).first<{ id: string }>();
      if (!row) { res.status(404).json({ error: "Atleta não encontrado." }); return true; }
      const linked = await DB.prepare(`SELECT
        EXISTS(SELECT 1 FROM zero3_registration_members WHERE athlete_id=?) AS member_link,
        EXISTS(SELECT 1 FROM zero3_registrations r, json_each(r.athlete_ids) j WHERE j.value=?) AS registration_link,
        EXISTS(SELECT 1 FROM zero3_import_people WHERE athlete_id=?) AS import_link`)
        .bind(params.data.athleteId, params.data.athleteId, params.data.athleteId)
        .first<{ member_link: number; registration_link: number; import_link: number }>();
      if (linked && (linked.member_link || linked.registration_link || linked.import_link)) {
        const links = [
          linked.member_link || linked.registration_link ? "inscrições/equipes" : "",
          linked.import_link ? "histórico de importação" : "",
        ].filter(Boolean).join(" e ");
        res.status(409).json({ code: "ATHLETE_HAS_LINKS", error: `Não é possível excluir: atleta possui vínculo em ${links}. Remova ou preserve os vínculos primeiro.` });
        return true;
      }
      const deleted = await DB.prepare("DELETE FROM zero3_athletes WHERE id=?").bind(params.data.athleteId).run();
      if ((deleted.meta.changes ?? 0) !== 1) { res.status(409).json({ error: "O atleta foi alterado por outra operação." }); return true; }
      res.json(DeleteZero3AthleteResponse.parse({ id: params.data.athleteId, deleted: true }));
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
      if (body.data.heatId) {
        const heat = await DB.prepare("SELECT name FROM zero3_heats WHERE id=? AND event_id=? AND category=?")
          .bind(body.data.heatId, params.data.eventId, params.data.category).first<{ name: string }>();
        if (!heat) { res.status(400).json({ error: "A bateria precisa pertencer ao evento e à categoria selecionados." }); return true; }
        heatName = heat.name;
      }
      const stamp = d1IsoNow();
      await DB.prepare(`INSERT INTO zero3_active_heats(event_id,category,heat_id,updated_at)
        VALUES(?,?,?,?) ON CONFLICT(event_id,category) DO UPDATE SET
        heat_id=excluded.heat_id,updated_at=excluded.updated_at`)
        .bind(params.data.eventId, params.data.category, body.data.heatId, stamp).run();
      res.json(SetZero3ActiveHeatResponse.parse({
        eventId: params.data.eventId, category: params.data.category,
        heatId: body.data.heatId, heatName, updatedAt: new Date(stamp),
      }));
    } catch { internalError(req, res, "Não foi possível selecionar a bateria ativa."); }
    return true;
  }

  const registrationsMatch = route.match(/^\/events\/([^/]+)\/registrations$/);
  if (registrationsMatch && req.method === "POST") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const body = CreateZero3RegistrationBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return true; }
    const eventId = registrationsMatch[1];
    const athleteIds = body.data.athleteIds;
    if (new Set(athleteIds).size !== athleteIds.length) { res.status(400).json({ error: "Há atletas duplicados nesta inscrição." }); return true; }
    if (athleteIds.length > 2) { res.status(400).json({ error: "Uma inscrição pode conter no máximo dois atletas." }); return true; }
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
      const teamName = body.data.teamName?.trim() || null;
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
  if (registrationMatch && req.method === "PATCH") {
    if (!await requireD1Member(req, res, DB, EVENT_ROLES)) return true;
    const params = UpdateZero3RegistrationParams.safeParse({ eventId: registrationMatch[1], registrationId: registrationMatch[2] });
    const body = UpdateZero3RegistrationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: !params.success ? params.error.message : body.error?.message ?? "Informe o nome da equipe." });
      return true;
    }
    try {
      const update = await DB.prepare(`UPDATE zero3_registrations SET team_name=?
        WHERE id=? AND event_id=?`)
        .bind(body.data.teamName?.trim() || null, params.data.registrationId, params.data.eventId).run();
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
      const heats = await DB.prepare("SELECT * FROM zero3_heats WHERE event_id=? ORDER BY \"order\"")
        .bind(params.data.eventId).all<HeatRow>();
      const payload = [];
      for (const heat of heats.results) {
        const entries = await DB.prepare(`SELECT r.*, he.lane_label AS heat_lane_label
          FROM zero3_heat_entries he JOIN zero3_registrations r ON r.id=he.registration_id
          WHERE he.heat_id=? ORDER BY he.assigned_at`)
          .bind(heat.id).all<RegistrationRow & { heat_lane_label: string | null }>();
        payload.push({
          ...heat,
          eventId: heat.event_id,
          order: heat.order,
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
    if (new Set(registrationIds).size !== registrationIds.length) { res.status(400).json({ error: "Há inscrições duplicadas na bateria." }); return true; }
    try {
      const rows = registrationIds.length
        ? await DB.prepare(`SELECT * FROM zero3_registrations WHERE event_id=? AND category=?
          AND id IN (${registrationIds.map(() => "?").join(",")})`)
          .bind(heatMatch[1], body.data.category, ...registrationIds).all<RegistrationRow>()
        : { results: [] as RegistrationRow[] };
      if (rows.results.length !== registrationIds.length) {
        res.status(400).json({ error: "Cada inscrição precisa pertencer ao evento e categoria da bateria." }); return true;
      }
      const heatId = newD1Id();
      const { registrationIds: _ignored, ...heat } = body.data;
      await DB.batch([
        DB.prepare(`INSERT INTO zero3_heats(id,event_id,category,name,"order") VALUES(?,?,?,?,?)`)
          .bind(heatId, heatMatch[1], heat.category, heat.name.trim(), heat.order),
        ...rows.results.map((registration) => DB.prepare(`INSERT INTO zero3_heat_entries
          (heat_id,registration_id,lane_label) VALUES(?,?,?)`)
          .bind(heatId, registration.id, registration.lane_label)),
      ]);
      const created = await DB.prepare("SELECT * FROM zero3_heats WHERE id=?").bind(heatId).first<HeatRow>();
      const response = {
        ...created, eventId: created!.event_id, order: created!.order,
        registrations: await Promise.all(rows.results.map((row) => registrationDto(DB, row))),
      };
      res.status(201).json(CreateZero3HeatResponse.parse(response));
    } catch { d1ApiError(req, res, 409, "HEAT_CONFLICT", "A ordem da bateria já está ocupada ou a operação conflitou."); }
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
