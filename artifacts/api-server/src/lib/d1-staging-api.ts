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
  GetZero3RankingPublicationParams,
  GetZero3RankingPublicationResponse,
  ListZero3EventsResponse,
  ListZero3ProofsResponse,
  ListZero3RegistrationsResponse,
  UpdateZero3ResultBody,
  UpdateZero3ResultParams,
  UpdateZero3ResultResponse,
  PublishZero3RankingBody,
  PublishZero3RankingResponse,
} from "@workspace/api-zod";
import { hasSignedInUserSession } from "./auth-session";
import { workerLogger } from "./worker-logger";
import { isD1SchemaNotReady } from "./d1-staging-shared";
import { calculateAllResultPlacements } from "./zero3-scoring";
import {
  buildBatteryLeaderboards,
  evaluateBatteryReadiness,
  fingerprintBatteryPublicationState,
  groupD1HeatsByProofAndOrder,
  type BatteryRegistration,
  type BatteryResult,
} from "./d1-staging-batteries";
import { handleD1StagingAdmin } from "./d1-staging-admin";
import { handleD1StagingControls } from "./d1-staging-controls";
import { handleD1StagingRoster } from "./d1-staging-roster";
import {
  listD1EventBatteries,
  handleD1StagingEventBatteries,
} from "./d1-staging-event-batteries";
import { advanceD1TimerPreparation, d1TimerDto } from "./d1-staging-timer";
import { resolveZero3DisplayTeamName } from "./zero3-team-name";
import { buildRankingPublicationPlan } from "./zero3-ranking-publication";

type D1Env = { DB: D1Database };
type Member = { clerk_user_id: string; email: string; role: string; active: number };
type EventRow = {
  id: string; name: string; proof_name: string; status: string;
  preparation_seconds: number; categories: string; created_at: string;
};
type ProofRow = {
  id: string; event_id: string; proof_order: number; name: string;
  metric_type: string; unit: string | null; direction: string | null;
  created_at: string; updated_at: string;
};
type RegistrationRow = {
  id: string; event_id: string; category: string; team_name: string | null;
  athlete_ids: string; lane_label: string | null; confirmation_status: string; created_at: string;
};
type ResultRow = {
  id: string; event_id: string; registration_id: string; proof_id: string | null;
  heat_id: string | null; battery_id: string | null; category: string; lane_label: string | null;
  athlete_ids_snapshot: string; athlete_names_snapshot: string;
  team_name_snapshot: string | null; elapsed_ms: number | null;
  raw_value: string | null; sync_error_ms: number | null; status: string;
  published_status: string | null; published_elapsed_ms: number | null;
  published_raw_value: string | null; published_revision: number | null;
  idempotency_key: string; captured_at: string; revision: number;
};
type HeatPublicationRow = {
  event_id:string;
  proof_id:string;
  battery_order:number;
  version:number;
  result_fingerprint:string;
  result_count:number;
  results_json:string;
  leaderboards_json:string;
  published_at:string;
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
const d1PublicationChangedRowsGuard = (DB: D1Database, eventId: string, expected: number) =>
  DB.prepare(`INSERT INTO zero3_batteries(id,event_id,battery_order,name)
    SELECT ?,?,0,'__ZERO3_PUBLICATION_GUARD__' WHERE changes()<>?`)
    .bind(id(), eventId, expected);

function isD1ConstraintConflict(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /constraint failed|constraint violation|foreign key|unique constraint/i.test(message);
}

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
    preparationSeconds: row.preparation_seconds,
    categories: jsonArray(row.categories),
    createdAt: date(row.created_at),
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
    batteryOperationsEnabled: true, activeBattery: null, completedBatteries: [], batteryTimers: [],
  });

  const [proofResult, regResult, resultResult, athleteResult, podiumResult, activeResult, heatResult, heatEntryResult, heatRunResult, publicationResult] = await Promise.all([
    DB.prepare("SELECT * FROM zero3_proofs WHERE event_id = ? ORDER BY proof_order").bind(event.id).all<ProofRow>(),
    DB.prepare("SELECT * FROM zero3_registrations WHERE event_id = ? ORDER BY created_at").bind(event.id).all<RegistrationRow>(),
    DB.prepare("SELECT * FROM zero3_results WHERE event_id = ? ORDER BY captured_at DESC").bind(event.id).all<ResultRow>(),
    DB.prepare("SELECT id, full_name FROM zero3_athletes").all<{id: string; full_name: string}>(),
    DB.prepare("SELECT * FROM zero3_podium_versions WHERE event_id = ? AND published = 1 ORDER BY version DESC").bind(event.id).all<{
      category: string; registration_ids: string;
    }>(),
    DB.prepare(`SELECT ah.category,ah.heat_id,ah.updated_at,h.name AS heat_name,
      h.proof_id,h.battery_order,h."order" AS heat_order,p.proof_order,p.name AS proof_name
      FROM zero3_active_heats ah LEFT JOIN zero3_heats h ON h.id=ah.heat_id
      LEFT JOIN zero3_proofs p ON p.id=h.proof_id WHERE ah.event_id=?`)
      .bind(event.id).all<{
      category: string; heat_id: string | null; updated_at: string; heat_name: string | null;
      proof_id:string|null;battery_order:number|null;heat_order:number|null;
      proof_order:number|null;proof_name:string|null;
    }>(),
    DB.prepare(`SELECT h.id,h.event_id,h.category,h.name,h."order",h.proof_id,h.battery_order,
      p.proof_order,p.name AS proof_name
      FROM zero3_heats h LEFT JOIN zero3_proofs p ON p.id=h.proof_id
      WHERE h.event_id=? ORDER BY p.proof_order,COALESCE(h.battery_order,h."order"),h.category`)
      .bind(event.id).all<{
        id:string;event_id:string;category:string;name:string;order:number;proof_id:string|null;
        battery_order:number|null;proof_order:number|null;proof_name:string|null;
      }>(),
    DB.prepare(`SELECT he.heat_id,he.registration_id,he.lane_label
      FROM zero3_heat_entries he JOIN zero3_heats h ON h.id=he.heat_id
      JOIN zero3_registrations r ON r.id=he.registration_id
      WHERE h.event_id=? AND r.confirmation_status<>'CANCELLED' ORDER BY he.assigned_at`)
      .bind(event.id).all<{heat_id:string;registration_id:string;lane_label:string|null}>(),
    DB.prepare("SELECT * FROM zero3_heat_runs WHERE event_id=?")
      .bind(event.id).all<{
        event_id:string;proof_id:string;battery_order:number;state:string;elapsed_ms:number;
        started_at:string|null;preparation_ends_at:string|null;version:number;
        last_command_id:string|null;updated_at:string;
      }>(),
    DB.prepare(`SELECT * FROM zero3_heat_publications
      WHERE event_id=? ORDER BY proof_id,battery_order,version DESC`)
      .bind(event.id).all<HeatPublicationRow>(),
  ]);
  const proofs = proofResult.results;
  const registrations = regResult.results.filter((row) => row.confirmation_status !== "CANCELLED");
  const activeRegistrationIds = new Set(registrations.map((row) => row.id));
  const results = resultResult.results.filter((row) => activeRegistrationIds.has(row.registration_id));
  const athleteNames = new Map(athleteResult.results.map((athlete) => [athlete.id, athlete.full_name]));
  const registrationsDto = registrations.map((reg) => ({
    id: reg.id, category: reg.category, teamName: reg.team_name,
    laneLabel: reg.lane_label, athleteNames: jsonArray(reg.athlete_ids).map((athleteId) => athleteNames.get(athleteId) ?? "Atleta removido"),
  }));
  const registrationsById = new Map(registrationsDto.map((reg) => [reg.id, reg]));
  const registrationRowsById = new Map(registrations.map((reg) => [reg.id, reg]));
  const now = new Date();
  const batteryTimers = await Promise.all(heatRunResult.results.map((run) =>
    advanceD1TimerPreparation(DB, run, now)));
  const heatRows = heatResult.results;
  const entriesByHeat = new Map<string, Array<BatteryRegistration>>();
  for (const entry of heatEntryResult.results) {
    const reg = registrationsById.get(entry.registration_id);
    const sourceReg = registrationRowsById.get(entry.registration_id);
    if (!reg) continue;
    const list = entriesByHeat.get(entry.heat_id) ?? [];
    list.push({
      ...reg,
      laneLabel: entry.lane_label ?? reg.laneLabel,
      heatId: entry.heat_id,
      athleteIds: sourceReg ? jsonArray(sourceReg.athlete_ids) : [],
      heatName: heatRows.find(heat=>heat.id===entry.heat_id)?.name,
    });
    entriesByHeat.set(entry.heat_id, list);
  }
  const batteryGroups = groupD1HeatsByProofAndOrder(heatRows);
  const runByKey = new Map(batteryTimers.map((run) => [`${run.proof_id}:${run.battery_order}`, run]));
  const publicationByKey = new Map<string,HeatPublicationRow>();
  for (const row of publicationResult.results) {
    const key=`${row.proof_id}:${row.battery_order}`;
    if(!publicationByKey.has(key))publicationByKey.set(key,row);
  }
  const batteryFingerprintByKey = new Map<string,string>();
  for (const [key,group] of batteryGroups) {
    const first=group[0];
    if(!first?.proof_id)continue;
    const heatIds=new Set(group.map(heat=>heat.id));
    const groupRegistrations=group.flatMap(heat=>entriesByHeat.get(heat.id)??[]);
    const groupProof=proofs.find(proof=>proof.id===first.proof_id);
    const fingerprintProof=groupProof?{
      id:groupProof.id,order:groupProof.proof_order,name:groupProof.name,
      metricType:groupProof.metric_type,unit:groupProof.unit,direction:groupProof.direction,
      configured:groupProof.metric_type!=="UNCONFIGURED"&&Boolean(groupProof.name.trim())&&
        (groupProof.direction==="LOWER"||groupProof.direction==="HIGHER"),
    }:undefined;
    const groupResults=results.filter(result=>result.proof_id===first.proof_id&&result.registration_id&&
      (result.heat_id?heatIds.has(result.heat_id):groupRegistrations.some(reg=>reg.id===result.registration_id)))
      .map((result):BatteryResult=>({
        id:result.id,registrationId:result.registration_id,proofId:result.proof_id,
        rawValue:result.raw_value,status:result.status,heatId:result.heat_id,
        elapsedMs:result.elapsed_ms,revision:result.revision,capturedAt:result.captured_at,
      }));
    batteryFingerprintByKey.set(key,await fingerprintBatteryPublicationState(groupRegistrations,groupResults.map(result=>({
      id:result.id,
      registrationId:result.registrationId,
      heatId:result.heatId??"",
      proofId:result.proofId,
      status:result.status,
      rawValue:result.rawValue,
      elapsedMs:result.elapsedMs,
      revision:result.revision,
      capturedAt:result.capturedAt,
    })),fingerprintProof));
  }
  const eventBatteries=await listD1EventBatteries(DB,event.id,now)??[];
  const eventLeaderboardResults = results.flatMap((row) =>
    row.published_status && row.published_status !== "PROVISIONAL"
      ? [{
          id: row.id,
          registrationId: row.registration_id,
          proofId: row.proof_id,
          rawValue: row.published_raw_value,
          status: row.published_status,
        }]
      : [],
  );
  const scoring = calculateAllResultPlacements({
    categories: jsonArray(event.categories),
    eventStatus: event.status,
    proofs: proofs.map((proof) => ({
      id: proof.id, order: proof.proof_order, name: proof.name,
      metricType: proof.metric_type, unit: proof.unit, direction: proof.direction,
    })),
    registrations: registrationsDto,
    results: eventLeaderboardResults,
  });
  const placement = scoring.placements;
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
      heatId: row.heat_id, batteryId: row.battery_id, category: row.category, laneLabel: row.lane_label,
      elapsedMs: row.elapsed_ms, proofId: row.proof_id,
      rawValue: row.raw_value === null ? null : Number(row.raw_value),
      placement: p?.placement ?? null, points: p?.points ?? null,
      tieRulePending: p?.tiePending ?? false, syncErrorMs: row.sync_error_ms,
      status: row.status, capturedAt: date(row.captured_at), revision: row.revision,
       publishedRevision: row.published_revision,
      names: snapshotNames.length ? snapshotNames : reg?.athleteNames ?? [],
      teamName: resolveZero3DisplayTeamName(reg?.teamName, row.team_name_snapshot, Boolean(reg)),
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
  const selectedRows = activeResult.results.filter((row) => row.heat_id);
  const firstSelected = selectedRows[0];
  const selectedOrder = firstSelected ? (firstSelected.battery_order ?? firstSelected.heat_order) : null;
  const consistentSelection = Boolean(firstSelected?.proof_id && selectedOrder !== null &&
    selectedRows.every((row) => row.proof_id === firstSelected.proof_id &&
      (row.battery_order ?? row.heat_order) === selectedOrder));
  const activeKey = consistentSelection ? `${firstSelected!.proof_id}:${selectedOrder}` : null;
  const activeRows = activeKey ? batteryGroups.get(activeKey) ?? [] : [];
  const batteryView = (group: typeof heatRows, state: string) => {
    if (!group.length || !group[0]?.proof_id) return null;
    const first = group[0];
    const proof = proofs.find((item) => item.id === first.proof_id);
    if (!proof) return null;
    const order = first.battery_order ?? first.order;
    const groupRegistrations = group.flatMap((heat) => entriesByHeat.get(heat.id) ?? []);
    const groupHeatIds = new Set(group.map((heat) => heat.id));
    const groupResults = results
      .filter((result) => result.proof_id === proof.id && result.heat_id && groupHeatIds.has(result.heat_id))
      .map((result): BatteryResult => ({
        id: result.id,
        registrationId: result.registration_id,
        proofId: result.proof_id,
        rawValue: result.raw_value,
        status: result.status,
        heatId: result.heat_id,
        elapsedMs: result.elapsed_ms,
        revision: result.revision,
        capturedAt: result.captured_at,
      }));
    const scoreProof = {
      id: proof.id, order: proof.proof_order, name: proof.name,
      metricType: proof.metric_type, unit: proof.unit, direction: proof.direction,
      configured: proof.metric_type !== "UNCONFIGURED" && Boolean(proof.name.trim()) &&
        (proof.direction === "LOWER" || proof.direction === "HIGHER"),
    };
    const scoring = buildBatteryLeaderboards({
      proof: scoreProof,
      registrations: groupRegistrations,
      results: groupResults,
      eventStatus: event.status,
    });
    const readiness=evaluateBatteryReadiness({
      proof:scoreProof,
      registrations:groupRegistrations,
      results:groupResults.map(result=>({
        id:result.id,registrationId:result.registrationId,heatId:result.heatId??"",
        proofId:result.proofId,status:result.status,rawValue:result.rawValue,
        elapsedMs:result.elapsedMs,revision:result.revision,capturedAt:result.capturedAt,
      })),
    });
    const groupKey=`${proof.id}:${order}`;
    const publication=publicationByKey.get(groupKey);
    const currentFingerprint=batteryFingerprintByKey.get(groupKey)??null;
    const finalizationCurrent=Boolean(publication&&currentFingerprint===publication.result_fingerprint);
    let displayResults=resultDtos.filter((result) => result.proofId === proof.id && result.heatId && groupHeatIds.has(result.heatId));
    let displayLeaderboards=scoring.leaderboards;
    if(publication){
      try {
        const storedResults=JSON.parse(publication.results_json) as typeof displayResults;
        displayResults=storedResults.map(result=>({...result,capturedAt:date(result.capturedAt?.toString())}));
        displayLeaderboards=JSON.parse(publication.leaderboards_json) as typeof scoring.leaderboards;
      } catch (cause) {
        workerLogger.error({requestId:"unknown"},"Battery publication snapshot could not be decoded");
        throw new Error("Publicação de bateria armazenada está inválida.",{cause});
      }
    }
    const displayCategories=publication
      ?[...new Set(displayResults.map(result=>result.category))]
        .sort((a,b)=>{
          const order=jsonArray(event.categories);
          return (order.indexOf(a)<0?Number.MAX_SAFE_INTEGER:order.indexOf(a))-
            (order.indexOf(b)<0?Number.MAX_SAFE_INTEGER:order.indexOf(b))||a.localeCompare(b);
        })
      :scoring.categories;
    return {
      eventId: event.id,
      proofId: proof.id,
      proofOrder: proof.proof_order,
      proofName: proof.name,
      order,
      name: `Bateria ${String(order).padStart(2,"0")}`,
      heatIds: group.map((heat) => heat.id),
      categories: displayCategories,
      registrations: groupRegistrations.map((registration) => ({
        heatId: registration.heatId,
        id: registration.id,
        category: registration.category,
        teamName: registration.teamName,
        laneLabel: registration.laneLabel,
        athleteNames: registration.athleteNames,
      })),
       results: displayResults,
       leaderboards: displayLeaderboards,
      state,
       pendingResultCount: Math.max(scoring.pendingResultCount,readiness.issues.length),
       reviewedResultCount:readiness.reviewedCount,
       expectedResultCount:readiness.expectedCount,
       finalized:Boolean(publication),
       finalizationCurrent,
       finalizationVersion:publication?.version??null,
       finalizedAt:date(publication?.published_at),
       finalizationFingerprint:currentFingerprint,
    };
  };
  const activeRun = activeKey ? runByKey.get(activeKey) : undefined;
  const activeBattery = activeRows.length
    ? batteryView(activeRows, activeRun?.state ?? "IDLE")
    : null;
  const completedBatteries = [...batteryGroups.entries()]
    .filter(([key,group])=>Boolean(group[0]?.proof_id&&publicationByKey.has(key)))
    .map(([,group])=>{
      const snapshot=batteryView(group,"FINISHED");
      if(!snapshot)return null;
      return {
        proofId:snapshot.proofId,proofOrder:snapshot.proofOrder,proofName:snapshot.proofName,
        order:snapshot.order,name:snapshot.name,categories:snapshot.categories,
        results:snapshot.results,leaderboards:snapshot.leaderboards,pendingResultCount:snapshot.pendingResultCount,
        finalized:snapshot.finalized,finalizationCurrent:snapshot.finalizationCurrent,
        finalizationVersion:snapshot.finalizationVersion!,finalizedAt:snapshot.finalizedAt!,
      };
    }).filter((item):item is NonNullable<typeof item>=>Boolean(item))
    .sort((a,b)=>a.proofOrder-b.proofOrder||a.order-b.order);
   const timer = activeBattery ? (() => {
    const timer = activeRun ?? {
      event_id:event.id,proof_id:activeBattery.proofId,battery_order:activeBattery.order,
      state:"IDLE",elapsed_ms:0,started_at:null,preparation_ends_at:null,
      version:0,last_command_id:null,updated_at:now.toISOString(),
    };
    return d1TimerDto(timer,event.id,event.preparation_seconds,now);
   })() : undefined;
  const activeSelection=await DB.prepare("SELECT battery_id FROM zero3_active_batteries WHERE event_id=?")
    .bind(event.id).first<{battery_id:string|null}>();
  const selectedEventBattery=activeSelection?.battery_id
    ?eventBatteries.find(item=>item.id===activeSelection.battery_id&&!item.operationalFinalized)??null:null;
  const eventBatteryToPublic=(battery:typeof eventBatteries[number])=>{
    const firstProof=battery.proofs[0];
    return {
      eventId:battery.eventId,batteryId:battery.id,
      proofId:firstProof?.id??"",proofOrder:firstProof?.order??1,proofName:firstProof?.name??"",
      order:battery.order,name:battery.name,heatIds:[],categories:battery.categories,
      registrations:battery.registrations.map(reg=>({...reg,heatId:null,batteryId:battery.id})),
      results:battery.results,leaderboards:battery.proofLeaderboards[0]?.leaderboards??[],
      state:battery.state,pendingResultCount:battery.pendingResultCount,
      reviewedResultCount:battery.reviewedResultCount,expectedResultCount:battery.expectedResultCount,
      elapsedMs:battery.elapsedMs,
      finalized:battery.finalized,finalizationCurrent:battery.finalizationCurrent,
      finalizationVersion:battery.finalizationVersion,finalizedAt:battery.finalizedAt,
      operationalFinalized:battery.operationalFinalized,
      operationalFinalizedAt:battery.operationalFinalizedAt,
      finalizationFingerprint:battery.finalizationFingerprint,
      proofs:battery.proofs,proofLeaderboards:battery.proofLeaderboards,
      eventElapsedMs:battery.eventElapsedMs,eventLimitMs:battery.eventLimitMs,
      preparationEndsAt:battery.preparationEndsAt,
      preparationStartedAt:battery.preparationStartedAt,
      firstStartedAt:battery.firstStartedAt,stoppedAt:battery.stoppedAt,
    };
  };
  const activeEventBattery=selectedEventBattery?eventBatteryToPublic(selectedEventBattery):null;
  const eventBatteryTimer=(battery:typeof eventBatteries[number])=>({
    eventId:event.id,state:battery.state,elapsedMs:battery.elapsedMs,
    preparationRemainingMs:battery.preparationRemainingMs,
    preparationSeconds:battery.preparationSeconds,startedAt:battery.startedAt,
    preparationEndsAt:battery.preparationEndsAt,version:battery.timerVersion,
    preparationStartedAt:battery.preparationStartedAt,
    firstStartedAt:battery.firstStartedAt,stoppedAt:battery.stoppedAt,
    updatedAt:battery.updatedAt,proofId:null,batteryOrder:battery.order,
    batteryId:battery.id,eventElapsedMs:battery.eventElapsedMs,eventLimitMs:battery.eventLimitMs,
  });
  const activeEventTimer=selectedEventBattery?eventBatteryTimer(selectedEventBattery):undefined;
  const activeHeats = jsonArray(event.categories).map((category) => {
    const row = activeResult.results.find((item) => item.category === category);
    return {
      eventId:event.id,category,heatId:row?.heat_id??null,heatName:row?.heat_name??null,
      proofId:row?.proof_id??null,proofOrder:row?.proof_order??null,
      batteryOrder:row?.battery_order??row?.heat_order??null,
      updatedAt:date(row?.updated_at)??new Date(0),
    };
  });
  return GetZero3PublicBoardResponse.parse({
    serverTime: now, event: eventDto(event),
    timer: activeEventBattery ? activeEventTimer : eventBatteries.length ? undefined : timer,
    results: resultDtos, proofs: proofs.map(proofDto),
    registrations: registrationsDto,
    leaderboards: scoring.leaderboards, podiums, activeHeats,
    batteryOperationsEnabled:true,batteryModel:"EVENT",
    activeBattery:activeEventBattery,
    completedEventBatteries:eventBatteries.filter(item=>item.operationalFinalized||item.finalized),
    completedBatteries,
    batteryTimers:eventBatteries.map(eventBatteryTimer),
  });
}

function captureDto(row: ResultRow, reg: RegistrationRow, names: string[], placement?: {placement: number|null; points: number|null; tiePending: boolean}) {
  return {
    id: row.id, eventId: row.event_id, registrationId: row.registration_id,
    heatId: row.heat_id, batteryId: row.battery_id, category: row.category, laneLabel: row.lane_label,
    elapsedMs: row.elapsed_ms, proofId: row.proof_id,
    rawValue: row.raw_value === null ? null : Number(row.raw_value),
    placement: placement?.placement ?? null, points: placement?.points ?? null,
    tieRulePending: placement?.tiePending ?? false, syncErrorMs: row.sync_error_ms,
    status: row.status, capturedAt: date(row.captured_at), revision: row.revision,
    publishedRevision: row.published_revision,
     names, teamName: reg.team_name, heatName: null,
  };
}

async function loadD1RankingPublicationState(DB: D1Database, eventId: string) {
  const [event, proofRows, registrationRows, resultRows, athleteRows, batteries, batteryEntries, heats, heatEntries, latest] =
    await Promise.all([
      DB.prepare("SELECT * FROM zero3_events WHERE id=? LIMIT 1").bind(eventId).first<EventRow>(),
      DB.prepare("SELECT * FROM zero3_proofs WHERE event_id=? ORDER BY proof_order").bind(eventId).all<ProofRow>(),
      DB.prepare("SELECT * FROM zero3_registrations WHERE event_id=? AND confirmation_status<>'CANCELLED' ORDER BY created_at").bind(eventId).all<RegistrationRow>(),
      DB.prepare("SELECT * FROM zero3_results WHERE event_id=? ORDER BY captured_at").bind(eventId).all<ResultRow>(),
      DB.prepare("SELECT id,full_name FROM zero3_athletes").all<{id:string;full_name:string}>(),
      DB.prepare("SELECT id,event_id FROM zero3_batteries WHERE event_id=?").bind(eventId).all<{id:string;event_id:string}>(),
      DB.prepare(`SELECT be.battery_id,be.registration_id FROM zero3_battery_entries be
        JOIN zero3_batteries b ON b.id=be.battery_id WHERE b.event_id=?`).bind(eventId)
        .all<{battery_id:string;registration_id:string}>(),
      DB.prepare("SELECT id,event_id,proof_id,category FROM zero3_heats WHERE event_id=?").bind(eventId)
        .all<{id:string;event_id:string;proof_id:string|null;category:string}>(),
      DB.prepare(`SELECT he.heat_id,he.registration_id FROM zero3_heat_entries he
        JOIN zero3_heats h ON h.id=he.heat_id WHERE h.event_id=?`).bind(eventId)
        .all<{heat_id:string;registration_id:string}>(),
      DB.prepare(`SELECT id,version,fingerprint,result_count,published_at,published_by
        FROM zero3_ranking_publications WHERE event_id=? ORDER BY version DESC LIMIT 1`)
        .bind(eventId).first<{
          id:string;version:number;fingerprint:string;result_count:number;
          published_at:string;published_by:string;
        }>(),
    ]);
  if (!event) return null;

  const registrations = registrationRows.results.map((row) => {
    const athleteIds = jsonArray(row.athlete_ids);
    return {
      id: row.id,
      category: row.category,
      teamName: row.team_name,
      athleteNames: athleteIds.map((athleteId) =>
        athleteRows.results.find((athlete) => athlete.id === athleteId)?.full_name ?? "Atleta removido",
      ),
      laneLabel: row.lane_label,
      active: row.confirmation_status !== "CANCELLED",
    };
  });
  const registrationById = new Map(registrationRows.results.map((row) => [row.id, row]));
  const proofById = new Map(proofRows.results.map((row) => [row.id, row]));
  const heatById = new Map(heats.results.map((row) => [row.id, row]));
  const batteryIds = new Set(batteries.results.map((row) => row.id));
  const batteryEntryKeys = new Set(batteryEntries.results.map((row) => `${row.battery_id}:${row.registration_id}`));
  const heatEntryKeys = new Set(heatEntries.results.map((row) => `${row.heat_id}:${row.registration_id}`));
  const results = resultRows.results.map((row) => {
    const registration = registrationById.get(row.registration_id);
    const proof = row.proof_id ? proofById.get(row.proof_id) : undefined;
    const heat = row.heat_id ? heatById.get(row.heat_id) : undefined;
    const assignedToBattery = Boolean(
      row.battery_id && batteryIds.has(row.battery_id) &&
      batteryEntryKeys.has(`${row.battery_id}:${row.registration_id}`),
    );
    const assignedToHeat = Boolean(
      row.heat_id && heat?.event_id === eventId && heat.proof_id === row.proof_id &&
      heatEntryKeys.has(`${row.heat_id}:${row.registration_id}`),
    );
    return {
      id: row.id,
      registrationId: row.registration_id,
      proofId: row.proof_id,
      category: row.category,
      status: row.status,
      rawValue: row.raw_value,
      elapsedMs: row.elapsed_ms,
      revision: row.revision,
      publishedStatus: row.published_status,
      publishedRawValue: row.published_raw_value,
      publishedElapsedMs: row.published_elapsed_ms,
      publishedRevision: row.published_revision,
      associationValid: Boolean(
        registration &&
        registration.event_id === eventId &&
        registration.category === row.category &&
        proof?.event_id === eventId &&
        (assignedToBattery || assignedToHeat),
      ),
    };
  });
  const plan = await buildRankingPublicationPlan({
    eventId,
    eventStatus: event.status,
    version: latest?.version ?? 0,
    proofs: proofRows.results.map((row) => ({
      id: row.id,
      order: row.proof_order,
      name: row.name,
      metricType: row.metric_type,
      unit: row.unit,
      direction: row.direction,
    })),
    registrations,
    results,
  });
  return { event, plan, latest, resultRows: resultRows.results };
}

export function d1StagingApi(
  DB: D1Database,
  options: { allowRosterApply?: boolean } = {},
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/zero3/")) { next(); return; }
    void (async () => {
      const route = req.path.slice("/api/zero3".length);
      const rankingPublicationMatch = route.match(/^\/events\/([^/]+)\/ranking-publication$/);
      if (rankingPublicationMatch && (req.method === "GET" || req.method === "POST")) {
        const member = await requireD1Role(req, res, DB,
          req.method === "POST" ? ["ADMIN"] : ["ADMIN", "JUIZ_CHEFE"]);
        if (!member) return;
        const params = GetZero3RankingPublicationParams.safeParse({ eventId: rankingPublicationMatch[1] });
        if (!params.success) {
          error(res, 400, "INVALID_REQUEST", params.error.message, req);
          return;
        }
        let publicationFingerprint: string | null = null;
        let publicationStage = "load_publication_state";
        try {
          const state = await loadD1RankingPublicationState(DB, params.data.eventId);
          if (!state) {
            error(res, 404, "EVENT_NOT_FOUND", "Evento não encontrado.", req);
            return;
          }
          publicationFingerprint = state.plan.fingerprint;
          publicationStage = req.method === "GET" ? "return_preview" : "validate_publication";
          if (req.method === "GET") {
            res.json(GetZero3RankingPublicationResponse.parse({
              eventId: params.data.eventId,
              version: state.latest?.version ?? 0,
              publishedAt: state.latest?.published_at ?? null,
              publishedBy: state.latest?.published_by ?? null,
              eligibleResultCount: state.plan.eligibleResultCount,
              partialResultCount: state.plan.partialResultCount,
              affected: state.plan.affected,
              issues: state.plan.issues,
              resultStates: state.plan.resultStates,
              fingerprint: state.plan.fingerprint,
              canPublish: state.plan.canPublish,
            }));
            return;
          }

          const body = PublishZero3RankingBody.safeParse(req.body);
          if (!body.success) {
            error(res, 400, "INVALID_REQUEST", body.error.message, req);
            return;
          }
          const latestVersion = state.latest?.version ?? 0;
          if (
            state.latest &&
            body.data.expectedVersion + 1 === latestVersion &&
            state.latest.fingerprint === body.data.expectedFingerprint
          ) {
            res.json(PublishZero3RankingResponse.parse({
              eventId: params.data.eventId,
              version: state.latest.version,
              resultCount: state.latest.result_count,
              publishedAt: date(state.latest.published_at),
              publishedBy: state.latest.published_by,
              fingerprint: state.latest.fingerprint,
              alreadyPublished: true,
            }));
            return;
          }
          if (
            body.data.expectedVersion !== latestVersion ||
            body.data.expectedFingerprint !== state.plan.fingerprint
          ) {
            res.status(409).json({
              code: "RANKING_PUBLICATION_STALE",
              error: "Os resultados mudaram desde a conferência. Atualize a prévia antes de publicar.",
            });
            return;
          }
          if (!state.plan.canPublish) {
            res.status(400).json({
              code: "RANKING_PUBLICATION_BLOCKED",
              error: state.plan.eligibleResultCount === 0
                ? "Não há resultados revisados novos para publicar."
                : "Há pendências que impedem a publicação do ranking.",
              issues: state.plan.issues,
            });
            return;
          }

          const nextVersion = latestVersion + 1;
          const stamp = new Date().toISOString();
          const candidatesById = new Map(state.plan.candidates.map((candidate) => [candidate.id, candidate]));
          const candidateRows = state.resultRows
            .filter((row) => candidatesById.has(row.id))
            .map((row) => ({
              id: row.id,
              revision: row.revision,
              status: row.status,
              registrationId: row.registration_id,
              proofId: row.proof_id,
              category: row.category,
              rawValue: row.raw_value,
              batteryId: row.battery_id,
              heatId: row.heat_id,
            }));
          const candidateJson = JSON.stringify(candidateRows);
          const insert = DB.prepare(`INSERT INTO zero3_ranking_publications
            (id,event_id,version,fingerprint,result_count,results_json,leaderboards_json,published_by,published_at)
            SELECT ?,?,?,?,?,?,?,?,?
            WHERE COALESCE((SELECT MAX(version) FROM zero3_ranking_publications WHERE event_id=?),0)=?
              AND (SELECT COUNT(*) FROM zero3_results
                WHERE event_id=? AND status IN ('VALIDATED','DNS','DNF')
                  AND (published_revision IS NULL OR revision<>published_revision))=json_array_length(?)
              AND NOT EXISTS (
                SELECT 1 FROM json_each(?) candidate
                LEFT JOIN zero3_results r ON r.id=json_extract(candidate.value,'$.id')
                LEFT JOIN zero3_registrations reg ON reg.id=r.registration_id
                LEFT JOIN zero3_proofs proof ON proof.id=r.proof_id
                WHERE r.id IS NULL
                  OR r.revision<>json_extract(candidate.value,'$.revision')
                  OR r.status<>json_extract(candidate.value,'$.status')
                  OR CAST(r.raw_value AS REAL)<>CAST(json_extract(candidate.value,'$.rawValue') AS REAL)
                  OR r.registration_id<>json_extract(candidate.value,'$.registrationId')
                  OR r.category<>json_extract(candidate.value,'$.category')
                  OR reg.event_id<>r.event_id OR reg.category<>r.category
                  OR proof.event_id<>r.event_id
                  OR reg.confirmation_status='CANCELLED'
                  OR NOT (
                    (r.battery_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM zero3_battery_entries be
                      JOIN zero3_batteries b ON b.id=be.battery_id
                      WHERE be.battery_id=r.battery_id AND be.registration_id=r.registration_id
                        AND b.event_id=r.event_id
                    ))
                    OR
                    (r.heat_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM zero3_heat_entries he
                      JOIN zero3_heats h ON h.id=he.heat_id
                      WHERE he.heat_id=r.heat_id AND he.registration_id=r.registration_id
                        AND h.event_id=r.event_id AND h.proof_id=r.proof_id
                    ))
                  )
              )
            RETURNING id`)
            .bind(
              crypto.randomUUID(), params.data.eventId, nextVersion, state.plan.fingerprint,
              state.plan.results.length, JSON.stringify(state.plan.results),
              JSON.stringify(state.plan.leaderboards), member.clerk_user_id, stamp,
              params.data.eventId, latestVersion, params.data.eventId, candidateJson, candidateJson,
            );
          const update = DB.prepare(`UPDATE zero3_results
            SET published_status=status,published_elapsed_ms=elapsed_ms,
                published_raw_value=raw_value,published_revision=revision
            WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))
              AND EXISTS (
                SELECT 1 FROM zero3_ranking_publications
                WHERE event_id=? AND version=? AND fingerprint=?
              )`).bind(candidateJson, params.data.eventId, nextVersion, state.plan.fingerprint);
          publicationStage = "commit_publication";
          const [insertResult, updateResult] = await DB.batch([
            insert,
            update,
            d1PublicationChangedRowsGuard(DB, params.data.eventId, candidateRows.length),
          ]);
          if ((insertResult.meta.changes ?? 0) !== 1) {
            const duplicate = await DB.prepare(`SELECT id,version,fingerprint,result_count,published_at,published_by
              FROM zero3_ranking_publications WHERE event_id=? AND fingerprint=? LIMIT 1`)
              .bind(params.data.eventId, body.data.expectedFingerprint)
              .first<{id:string;version:number;fingerprint:string;result_count:number;published_at:string;published_by:string}>();
            if (duplicate) {
              res.json(PublishZero3RankingResponse.parse({
                eventId: params.data.eventId,
                version: duplicate.version,
                resultCount: duplicate.result_count,
                publishedAt: date(duplicate.published_at),
                publishedBy: duplicate.published_by,
                fingerprint: duplicate.fingerprint,
                alreadyPublished: true,
              }));
              return;
            }
            res.status(409).json({
              code: "RANKING_PUBLICATION_STALE",
              error: "Os resultados mudaram durante a publicação. Atualize a prévia e tente novamente.",
            });
            return;
          }
          if ((updateResult.meta.changes ?? 0) !== candidateRows.length) {
            error(res, 500, "RANKING_PUBLICATION_INCOMPLETE", "A publicação foi registrada, mas nem todos os resultados foram atualizados.", req);
            return;
          }
          res.json(PublishZero3RankingResponse.parse({
            eventId: params.data.eventId,
            version: nextVersion,
            resultCount: state.plan.results.length,
            publishedAt: date(stamp),
            publishedBy: member.clerk_user_id,
            fingerprint: state.plan.fingerprint,
            alreadyPublished: false,
          }));
        } catch (cause) {
          if (isD1SchemaNotReady(cause)) {
            workerLogger.error({
              error: cause, requestId: requestId(req), method: req.method,
              path: route, stage: publicationStage,
            }, "D1 ranking publication schema is not ready");
            error(res, 503, "D1_SCHEMA_NOT_READY",
              "O schema D1 está desatualizado e precisa das migrations de publicação do ranking.", req);
            return;
          }
          if (isD1ConstraintConflict(cause)) {
            const duplicate = await DB.prepare(`SELECT id,version,fingerprint,result_count,published_at,published_by
              FROM zero3_ranking_publications WHERE event_id=? AND fingerprint=? LIMIT 1`)
              .bind(params.data.eventId, publicationFingerprint).first<{
                id:string;version:number;fingerprint:string;result_count:number;
                published_at:string;published_by:string;
              }>().catch(() => null);
            if (duplicate) {
              res.json(PublishZero3RankingResponse.parse({
                eventId: params.data.eventId,
                version: duplicate.version,
                resultCount: duplicate.result_count,
                publishedAt: date(duplicate.published_at),
                publishedBy: duplicate.published_by,
                fingerprint: duplicate.fingerprint,
                alreadyPublished: true,
              }));
              return;
            }
            res.status(409).json({
              code: "RANKING_PUBLICATION_STALE",
              error: "Os resultados mudaram durante a publicação. Nada foi publicado; atualize a prévia e tente novamente.",
              ...(requestId(req) ? { requestId: requestId(req) } : {}),
            });
            return;
          }
          workerLogger.error({
            error: cause, requestId: requestId(req), method: req.method,
            path: route, stage: "ranking_publication",
          }, "D1 ranking publication failed");
          error(res, 503, "DATABASE_UNAVAILABLE", "Não foi possível preparar ou publicar o ranking.", req);
        }
        return;
      }
      const legacyFinalizeMatch = route.match(/^\/events\/[^/]+\/batteries\/[^/]+\/\d+\/finalize$/);
      const legacyTimerBody = typeof req.body === "object" && req.body !== null
        ? req.body as Record<string, unknown>
        : null;
      const legacyBatteryMutation =
        (req.method === "POST" && /^\/events\/[^/]+\/heats$/.test(route)) ||
        (req.method === "PUT" && /^\/events\/[^/]+\/heats\/[^/]+\/proof$/.test(route)) ||
        (req.method === "PUT" && /^\/events\/[^/]+\/active-heats\/[^/]+$/.test(route)) ||
        (req.method === "PUT" && /^\/events\/[^/]+\/active-battery$/.test(route)) ||
        (req.method === "PUT" && /^\/events\/[^/]+\/timer$/.test(route) && !("expectedBatteryId" in (legacyTimerBody ?? {}))) ||
        (req.method === "POST" && Boolean(legacyFinalizeMatch));
      if (legacyBatteryMutation) {
        const roles = legacyFinalizeMatch
          ? ["ADMIN", "JUIZ_CHEFE"]
          : ["ADMIN", "JUIZ_CHEFE", "JUIZ"];
        if (!await requireD1Role(req, res, DB, roles)) return;
        error(res, 410, "EVENT_BATTERY_MODEL", "Use baterias vinculadas ao evento; as rotas antigas por prova/categoria são somente históricas.", req);
        return;
      }
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
          const rows = await DB.prepare("SELECT * FROM zero3_registrations WHERE event_id=? AND confirmation_status<>'CANCELLED' ORDER BY created_at").bind(registrationsMatch[1]).all<RegistrationRow>();
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
          if (!body.data.proofId || body.data.status !== "PROVISIONAL") {
            res.status(400).json({ error: "Informe a prova; o lançamento inicial deve ser provisório." }); return;
          }
          const proof = await DB.prepare("SELECT * FROM zero3_proofs WHERE id=? AND event_id=?")
            .bind(body.data.proofId, body.data.eventId).first<ProofRow>();
          if (!proof) { res.status(400).json({ error: "Prova inválida para este evento." }); return; }
          const targetBatteryId=body.data.batteryId??null;
          let targetHeatId=body.data.heatId??null;
          let targetLaneLabel=reg.lane_label;
          if(targetBatteryId){
            const battery=await DB.prepare("SELECT id FROM zero3_batteries WHERE id=? AND event_id=?")
              .bind(targetBatteryId,body.data.eventId).first<{id:string}>();
            if(!battery){res.status(400).json({error:"A bateria não pertence a este evento."});return;}
            const assigned=await DB.prepare(`SELECT lane_label FROM zero3_battery_entries
              WHERE battery_id=? AND registration_id=?`)
              .bind(targetBatteryId,reg.id).first<{lane_label:string|null}>();
            if(!assigned){res.status(400).json({error:"A equipe não está atribuída à bateria selecionada."});return;}
            targetLaneLabel=assigned.lane_label??reg.lane_label;
          }else{
            if (!targetHeatId) { res.status(400).json({error:"Informe a bateria do lançamento."}); return; }
            const heat = await DB.prepare(`SELECT id,event_id,proof_id,battery_order,"order" AS heat_order
              FROM zero3_heats WHERE id=? AND event_id=?`)
              .bind(targetHeatId,body.data.eventId)
              .first<{id:string;event_id:string;proof_id:string|null;battery_order:number|null;heat_order:number}>();
            if (!heat || heat.proof_id !== proof.id) {
              res.status(400).json({error:"A bateria não pertence à prova e ao evento informados."}); return;
            }
            const assigned = await DB.prepare(`SELECT lane_label FROM zero3_heat_entries
              WHERE heat_id=? AND registration_id=?`)
              .bind(targetHeatId,reg.id).first<{lane_label:string|null}>();
            if (!assigned) { res.status(400).json({error:"A equipe não está atribuída à bateria selecionada."}); return; }
            targetLaneLabel=assigned.lane_label??reg.lane_label;
          }
          if (proof.metric_type === "UNCONFIGURED" || !proof.name.trim() || !["LOWER","HIGHER"].includes(proof.direction ?? "")) {
            res.status(409).json({ error: "Configure nome, métrica e direção antes de lançar resultados." }); return;
          }
          const rawValue = body.data.rawValue ?? (
            proof.metric_type === "TIME" && body.data.elapsedMs != null
              ? body.data.elapsedMs / 1000
              : null
          );
          if (rawValue == null) {
            res.status(400).json({error:proof.metric_type==="TIME"
              ?"Informe o tempo em segundos ou a captura do cronômetro."
              :"Informe o valor registrado para esta prova."});
            return;
          }
          if (rawValue > 999999999.999) {
            res.status(400).json({ error: "O valor excede a precisão permitida pela prova." }); return;
          }
          const elapsedMs=body.data.elapsedMs ?? (proof.metric_type==="TIME" ? Math.round(rawValue*1000) : null);
          const normalizedRawValue=rawValue.toFixed(3);
          const names = jsonArray(reg.athlete_ids);
          const athleteRows = names.length
            ? (await DB.prepare(`SELECT id,full_name FROM zero3_athletes WHERE id IN (${names.map(() => "?").join(",")})`).bind(...names).all<{id:string;full_name:string}>()).results
            : [];
          const namesById = new Map(athleteRows.map((a) => [a.id, a.full_name]));
          const athleteNames = names.map((athleteId) => namesById.get(athleteId) ?? "Atleta removido");
          const stamp = new Date().toISOString();
          const row = await DB.prepare(`INSERT INTO zero3_results
            (id,event_id,registration_id,proof_id,heat_id,battery_id,category,lane_label,athlete_ids_snapshot,athlete_names_snapshot,team_name_snapshot,elapsed_ms,raw_value,sync_error_ms,status,idempotency_key,captured_at,revision)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PROVISIONAL',?,?,1)
            ON CONFLICT DO NOTHING RETURNING *`)
            .bind(id(), reg.event_id, reg.id, proof.id, targetHeatId, targetBatteryId, reg.category, targetLaneLabel,
              JSON.stringify(names), JSON.stringify(athleteNames), reg.team_name,
              elapsedMs, normalizedRawValue, null, body.data.idempotencyKey, stamp)
            .first<ResultRow>();
          const saved = row ?? await DB.prepare("SELECT * FROM zero3_results WHERE idempotency_key=?")
            .bind(body.data.idempotencyKey).first<ResultRow>();
          if (!saved || saved.event_id !== reg.event_id || saved.registration_id !== reg.id ||
            saved.proof_id !== proof.id || saved.heat_id !== targetHeatId || saved.battery_id !== targetBatteryId ||
            saved.raw_value !== normalizedRawValue || saved.elapsed_ms !== elapsedMs) {
            res.status(409).json({ error: "Já existe um lançamento para esta equipe e prova, ou a chave do envio não corresponde a esta bateria." }); return;
          }
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
          if ((body.data.expectedEventId && current.event_id !== body.data.expectedEventId) ||
            (body.data.expectedProofId && current.proof_id !== body.data.expectedProofId) ||
            (body.data.expectedHeatId && current.heat_id !== body.data.expectedHeatId) ||
            (body.data.expectedBatteryId && current.battery_id !== body.data.expectedBatteryId)) {
            res.status(409).json({ error: "Este resultado não pertence à prova e à bateria abertas. Atualize a lista." }); return;
          }
          if (body.data.expectedRevision !== undefined && current.revision !== body.data.expectedRevision) {
            res.status(409).json({ error: "O resultado foi revisado em outra operação. Atualize a lista antes de corrigir." }); return;
          }
          const stamp = new Date().toISOString();
          const raw = body.data.rawValue === undefined ? current.raw_value : body.data.rawValue === null ? null : body.data.rawValue.toFixed(3);
          const elapsed = body.data.elapsedMs === undefined ? current.elapsed_ms : body.data.elapsedMs;
          const status = body.data.status ?? current.status;
          if (status === "VALIDATED") {
            const proof = current.proof_id
              ? await DB.prepare("SELECT metric_type,name,direction FROM zero3_proofs WHERE id=? AND event_id=?")
                .bind(current.proof_id,current.event_id)
                .first<{metric_type:string;name:string;direction:string|null}>()
              : null;
            const numericValue = raw === null ? Number.NaN : Number(raw);
            if (!proof || proof.metric_type === "UNCONFIGURED" || !proof.name.trim() ||
              !["LOWER","HIGHER"].includes(proof.direction ?? "") ||
              !Number.isFinite(numericValue) || numericValue < 0) {
              res.status(400).json({ error: "Um resultado só pode ser validado com valor válido e regra de prova configurada." }); return;
            }
          }
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
      if (await handleD1StagingEventBatteries(req, res, DB)) return;
      if (await handleD1StagingAdmin(req, res, DB)) return;
      if (await handleD1StagingRoster(req, res, DB, options.allowRosterApply)) return;
      if (await handleD1StagingControls(req, res, DB)) return;
      const diagnosticId = requestId(req) ?? crypto.randomUUID();
      workerLogger.error(
        { requestId: diagnosticId, method: req.method, path: route },
        "D1 staging API route not implemented",
      );
      res.status(501).json({
        code: "D1_ROUTE_NOT_IMPLEMENTED",
        error: "Esta rota ainda não foi migrada para D1 neste staging.",
        requestId: diagnosticId,
      });
    })().catch(() => {
      error(res, 500, "API_INTERNAL_ERROR", "Falha interna da API D1.", req);
    });
  };
}
