import { calculateCategoryLeaderboard, type ScoreProof, type ScoreRegistration, type ScoreResult } from "./zero3-scoring";
import { d1IsoNow, d1JsonArray } from "./d1-staging-shared";

export type D1ActiveBattery = {
  eventId: string;
  proofId: string;
  proofOrder: number;
  proofName: string;
  order: number;
  name: string;
  categories: string[];
  heatIds: string[];
};

type ActiveHeatRow = {
  category: string;
  heat_id: string | null;
  heat_name: string | null;
  proof_id: string | null;
  proof_order: number | null;
  proof_name: string | null;
  battery_order: number | null;
  heat_order: number | null;
  updated_at: string;
};

export class BatteryConflict extends Error {
  constructor(message: string, readonly status = 409, readonly code = "BATTERY_CONFLICT") {
    super(message);
    this.name = "BatteryConflict";
  }
}

export async function readD1ActiveBattery(DB: D1Database, eventId: string): Promise<D1ActiveBattery | null> {
  const selected = await DB.prepare(`SELECT ah.category,ah.heat_id,ah.updated_at,
      h.name AS heat_name,h.proof_id,h.battery_order,h."order" AS heat_order,
      p.proof_order,p.name AS proof_name
    FROM zero3_active_heats ah
    LEFT JOIN zero3_heats h ON h.id=ah.heat_id
    LEFT JOIN zero3_proofs p ON p.id=h.proof_id
    WHERE ah.event_id=? AND ah.heat_id IS NOT NULL`)
    .bind(eventId).all<ActiveHeatRow>();
  if (!selected.results.length) return null;

  const first = selected.results[0]!;
  const order = first.battery_order ?? first.heat_order;
  if (!first.proof_id || !first.proof_order || !first.proof_name || !order) return null;
  if (selected.results.some((row) =>
    row.proof_id !== first.proof_id ||
    (row.battery_order ?? row.heat_order) !== order ||
    !row.heat_id
  )) return null;

  const group = await DB.prepare(`SELECT id,category,name
    FROM zero3_heats
    WHERE event_id=? AND proof_id=? AND COALESCE(battery_order,"order")=?
    ORDER BY category`)
    .bind(eventId, first.proof_id, order)
    .all<{id:string;category:string;name:string}>();
  const heatIds = group.results.map((row) => row.id);
  if (!heatIds.length || selected.results.some((row) => !heatIds.includes(row.heat_id!))) return null;
  return {
    eventId,
    proofId: first.proof_id,
    proofOrder: first.proof_order,
    proofName: first.proof_name,
    order,
    name: first.heat_name || `Bateria ${String(order).padStart(2, "0")}`,
    categories: group.results.map((row) => row.category),
    heatIds,
  };
}

export async function selectD1ActiveBattery(
  DB: D1Database,
  eventId: string,
  heatId: string | null,
): Promise<{eventId:string;proofId:string|null;proofOrder:number|null;proofName:string|null;order:number|null;name:string|null;categories:string[];updatedAt:Date}> {
  const event = await DB.prepare("SELECT id,categories FROM zero3_events WHERE id=?")
    .bind(eventId).first<{id:string;categories:string}>();
  if (!event) throw new BatteryConflict("Evento não encontrado.", 404, "EVENT_NOT_FOUND");

  let next: D1ActiveBattery | null = null;
  if (heatId) {
    const row = await DB.prepare(`SELECT h.id,h.event_id,h.category,h.name,h.proof_id,
        h.battery_order,h."order" AS heat_order,p.proof_order,p.name AS proof_name
      FROM zero3_heats h LEFT JOIN zero3_proofs p ON p.id=h.proof_id
      WHERE h.id=? AND h.event_id=?`)
      .bind(heatId, eventId)
      .first<{
        id:string;event_id:string;category:string;name:string;proof_id:string|null;
        battery_order:number|null;heat_order:number;proof_order:number|null;proof_name:string|null;
      }>();
    if (!row) throw new BatteryConflict("A bateria não pertence a este evento.", 400, "HEAT_NOT_IN_EVENT");
    if (!row.proof_id || !row.proof_order || !row.proof_name) {
      throw new BatteryConflict("Vincule esta bateria a uma prova antes de colocá-la na TV.", 400, "HEAT_PROOF_REQUIRED");
    }
    const order = row.battery_order ?? row.heat_order;
    const children = await DB.prepare(`SELECT id,category,name FROM zero3_heats
      WHERE event_id=? AND proof_id=? AND COALESCE(battery_order,"order")=? ORDER BY category`)
      .bind(eventId, row.proof_id, order)
      .all<{id:string;category:string;name:string}>();
    next = {
      eventId, proofId: row.proof_id, proofOrder: row.proof_order,
      proofName: row.proof_name, order, name: row.name,
      categories: children.results.map((heat) => heat.category),
      heatIds: children.results.map((heat) => heat.id),
    };
  }

  const categories = d1JsonArray(event.categories);
  const byCategory = new Map<string,string>();
  if (next) {
    const children = await DB.prepare(`SELECT id,category FROM zero3_heats
      WHERE event_id=? AND proof_id=? AND COALESCE(battery_order,"order")=?`)
      .bind(eventId,next.proofId,next.order)
      .all<{id:string;category:string}>();
    for (const child of children.results) byCategory.set(child.category, child.id);
  }
  const stamp = d1IsoNow();
  await DB.batch(categories.map((category) => DB.prepare(`INSERT INTO zero3_active_heats(event_id,category,heat_id,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(event_id,category) DO UPDATE SET
    heat_id=excluded.heat_id,updated_at=excluded.updated_at`)
    .bind(eventId, category, byCategory.get(category) ?? null, stamp)));

  return {
    eventId,
    proofId: next?.proofId ?? null,
    proofOrder: next?.proofOrder ?? null,
    proofName: next?.proofName ?? null,
    order: next?.order ?? null,
    name: next?.name ?? null,
    categories: next?.categories ?? [],
    updatedAt: new Date(stamp),
  };
}

export type BatteryRegistration = ScoreRegistration & {heatId:string;athleteIds?:string[];heatName?:string};
export type BatteryResult = ScoreResult & {
  heatId:string|null;
  elapsedMs?:number|null;
  revision?:number;
  capturedAt?:string;
};
export type BatteryProof = ScoreProof & {configured:boolean};

export type BatteryReadinessResult = {
  id:string;
  registrationId:string;
  heatId:string;
  proofId:string|null;
  status:string;
  rawValue:string|number|null;
  elapsedMs?:number|null;
  revision?:number;
  capturedAt?:string;
};

export type BatteryReadinessRegistration = BatteryRegistration;

export type BatteryReadinessIssue = {
  registrationId:string;
  category:string;
  teamName:string|null;
  athleteNames:string[];
  laneLabel:string|null;
  heatId:string;
  resultId:string|null;
  resultStatus:string|null;
  code:"MISSING"|"NEEDS_REVIEW"|"INVALID_VALUE"|"WRONG_HEAT"|"UNSUPPORTED_STATUS";
  message:string;
};

export function evaluateBatteryReadiness(input:{
  proof:BatteryProof;
  registrations:readonly BatteryReadinessRegistration[];
  results:readonly BatteryReadinessResult[];
}):{expectedCount:number;reviewedCount:number;ready:boolean;issues:BatteryReadinessIssue[]} {
  const issues:BatteryReadinessIssue[]=[];
  for(const registration of input.registrations){
    const result=input.results.find(item=>item.registrationId===registration.id&&item.proofId===input.proof.id);
    let code:BatteryReadinessIssue["code"]|null=null;
    let message="";
    if(!result){
      code="MISSING";
      message="Resultado faltando";
    }else if(result.heatId!==registration.heatId){
      code="WRONG_HEAT";
      message="Resultado vinculado a outra bateria";
    }else if(result.status==="PROVISIONAL"){
      code="NEEDS_REVIEW";
      message="Aguardando revisão";
    }else if(result.status==="VALIDATED"){
      const value=result.rawValue;
      const number=value===null||value===""?Number.NaN:Number(value);
      if(!input.proof.configured||!Number.isFinite(number)||number<0){
        code="INVALID_VALUE";
        message="Resultado validado sem valor válido para a prova";
      }
    }else if(result.status!=="DNS"&&result.status!=="DNF"){
      code="UNSUPPORTED_STATUS";
      message="O status não é uma exceção oficial";
    }
    if(code)issues.push({
      registrationId:registration.id,category:registration.category,
      teamName:registration.teamName,athleteNames:registration.athleteNames,
      laneLabel:registration.laneLabel,heatId:registration.heatId,
      resultId:result?.id??null,resultStatus:result?.status??null,code,message,
    });
  }
  const expectedCount=input.registrations.length;
  const reviewedCount=expectedCount-issues.length;
  return {expectedCount,reviewedCount,ready:expectedCount>0&&issues.length===0,issues};
}

export function canonicalBatteryPublicationState(
  registrations:readonly (BatteryRegistration & {athleteIds?:string[]})[],
  results:readonly BatteryReadinessResult[],
  proof?:BatteryProof,
):string {
  return JSON.stringify({
    proof:proof?{
      id:proof.id,order:proof.order,name:proof.name,metricType:proof.metricType,
      unit:proof.unit,direction:proof.direction,configured:proof.configured,
    }:null,
    registrations:registrations.map(registration=>({
      id:registration.id,heatId:registration.heatId,category:registration.category,
      heatName:registration.heatName??null,
      laneLabel:registration.laneLabel,teamName:registration.teamName,
      athleteNames:registration.athleteNames,athleteIds:registration.athleteIds??[],
    })).sort((a,b)=>a.id.localeCompare(b.id)),
    results:results.map(result=>({
      id:result.id,registrationId:result.registrationId,heatId:result.heatId,
      proofId:result.proofId,status:result.status,rawValue:result.rawValue,
      elapsedMs:result.elapsedMs??null,revision:result.revision??0,
      capturedAt:result.capturedAt??null,
    })).sort((a,b)=>a.id.localeCompare(b.id)),
  });
}

export async function fingerprintBatteryPublicationState(
  registrations:readonly (BatteryRegistration & {athleteIds?:string[]})[],
  results:readonly BatteryReadinessResult[],
  proof?:BatteryProof,
):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(
    canonicalBatteryPublicationState(registrations,results,proof),
  ));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

export type D1HeatGroupRow = {
  proof_id:string|null;
  battery_order:number|null;
  order:number;
};

export function groupD1HeatsByProofAndOrder<T extends D1HeatGroupRow>(rows:readonly T[]):Map<string,T[]> {
  const groups=new Map<string,T[]>();
  for(const row of rows){
    if(!row.proof_id)continue;
    const order=row.battery_order??row.order;
    const key=`${row.proof_id}:${order}`;
    const group=groups.get(key)??[];
    group.push(row);
    groups.set(key,group);
  }
  return groups;
}

export function buildBatteryLeaderboards(input: {
  proof: BatteryProof;
  registrations: BatteryRegistration[];
  results: BatteryResult[];
  eventStatus: string;
}) {
  const categories = [...new Set(input.registrations.map((registration) => registration.category))];
  const leaderboards = categories.map((category) => calculateCategoryLeaderboard({
    category,
    eventStatus: input.eventStatus,
    proofs: [input.proof],
    registrations: input.registrations,
    results: input.results.filter((result) =>
      input.registrations.some((registration) => registration.id === result.registrationId) &&
      result.proofId === input.proof.id
    ),
  }));
  const resultByRegistration = new Map(input.results
    .filter((result) => result.proofId === input.proof.id)
    .map((result) => [result.registrationId, result]));
  let pendingResultCount = input.registrations.filter((registration) => {
    const result = resultByRegistration.get(registration.id);
    return !result || result.status === "PROVISIONAL" || result.status === "PARTIAL";
  }).length;
  if (!input.proof.configured) pendingResultCount = Math.max(pendingResultCount, input.registrations.length);
  const tiePendingCount = leaderboards.reduce((count,leaderboard) =>
    count+leaderboard.entries.filter(entry=>entry.proofScores.some(score=>score.status==="TIE_RULE_PENDING")).length,0);
  pendingResultCount = Math.max(pendingResultCount,tiePendingCount);
  return { categories, leaderboards, pendingResultCount };
}
