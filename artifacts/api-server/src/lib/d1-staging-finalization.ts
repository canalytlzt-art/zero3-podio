import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import {
  FinalizeZero3BatteryBody,
  FinalizeZero3BatteryParams,
  FinalizeZero3BatteryResponse,
} from "@workspace/api-zod";
import {
  buildBatteryLeaderboards,
  evaluateBatteryReadiness,
  fingerprintBatteryPublicationState,
  readD1ActiveBattery,
  type BatteryProof,
  type BatteryReadinessRegistration,
  type BatteryReadinessResult,
} from "./d1-staging-batteries";
import {
  d1ApiError,
  d1JsonArray,
  requireD1Member,
} from "./d1-staging-shared";
import { resolveZero3DisplayTeamName } from "./zero3-team-name";

type ProofRow = {
  id: string;
  event_id: string;
  proof_order: number;
  name: string;
  metric_type: string;
  unit: string | null;
  direction: string | null;
};
type ExpectedRow = {
  heat_id: string;
  registration_id: string;
  category: string;
  team_name: string | null;
  athlete_ids: string;
  registration_lane_label: string | null;
  heat_lane_label: string | null;
};
type ResultRow = {
  id: string;
  event_id: string;
  registration_id: string;
  proof_id: string | null;
  heat_id: string;
  category: string;
  lane_label: string | null;
  athlete_names_snapshot: string;
  team_name_snapshot: string | null;
  elapsed_ms: number | null;
  raw_value: string | null;
  sync_error_ms: number | null;
  status: string;
  captured_at: string;
  revision: number;
};
type PublicationRow = {
  id: string;
  event_id: string;
  proof_id: string;
  battery_order: number;
  version: number;
  result_fingerprint: string;
  result_count: number;
  results_json: string;
  leaderboards_json: string;
  published_at: string;
};

const finalizerRoles = ["ADMIN", "JUIZ_CHEFE"] as const;

function toReadinessResult(row: ResultRow): BatteryReadinessResult {
  return {
    id: row.id,
    registrationId: row.registration_id,
    heatId: row.heat_id,
    proofId: row.proof_id,
    status: row.status,
    rawValue: row.raw_value,
    elapsedMs: row.elapsed_ms,
    revision: row.revision,
    capturedAt: row.captured_at,
  };
}

function resultDto(
  row: ResultRow,
  registration: BatteryReadinessRegistration,
  proofId: string,
  proofName: string,
  score: { placement: number | null; points: number | null; status: string } | undefined,
) {
  const snapshotNames = d1JsonArray(row.athlete_names_snapshot);
  const rawValue = row.raw_value === null ? null : Number(row.raw_value);
  return {
    id: row.id,
    eventId: row.event_id,
    registrationId: row.registration_id,
    heatId: row.heat_id,
    category: row.category,
    laneLabel: row.lane_label ?? registration.laneLabel,
    elapsedMs: row.elapsed_ms,
    proofId,
    rawValue,
    placement: score?.placement ?? null,
    points: score?.points ?? null,
    tieRulePending: score?.status === "TIE_RULE_PENDING",
    syncErrorMs: row.sync_error_ms,
    status: row.status,
    capturedAt: new Date(row.captured_at),
    revision: row.revision,
    names: snapshotNames.length ? snapshotNames : registration.athleteNames,
    teamName: resolveZero3DisplayTeamName(registration.teamName, row.team_name_snapshot, true),
    heatName: proofName ? `Prova ${proofName}` : null,
  };
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

const batteryMembershipSql = `SELECT he.registration_id FROM zero3_heats h
  JOIN zero3_heat_entries he ON he.heat_id=h.id
  JOIN zero3_registrations r ON r.id=he.registration_id
  WHERE h.event_id=? AND h.proof_id=? AND COALESCE(h.battery_order,h."order")=?
    AND r.confirmation_status<>'CANCELLED'`;

export function buildBatteryPublicationInsert(input:{
  publicationId:string;eventId:string;proofId:string;batteryOrder:number;version:number;
  fingerprint:string;resultCount:number;resultsJson:string;leaderboardsJson:string;
  publishedBy:string;publishedAt:string;expectedCount:number;
  guardEntries:unknown[];guardResults:unknown[];
}):{sql:string;bindings:unknown[]}{
  const sql=`INSERT INTO zero3_heat_publications
    (id,event_id,proof_id,battery_order,version,result_fingerprint,result_count,results_json,leaderboards_json,published_by,published_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?
    WHERE
      (SELECT COUNT(*) FROM (${batteryMembershipSql}))=?
      AND NOT EXISTS (
        SELECT 1 FROM json_each(?) snapshot
        LEFT JOIN zero3_heat_entries he ON he.heat_id=json_extract(snapshot.value,'$.heatId')
          AND he.registration_id=json_extract(snapshot.value,'$.registrationId')
        LEFT JOIN zero3_heats h ON h.id=he.heat_id
        LEFT JOIN zero3_registrations r ON r.id=he.registration_id
        WHERE he.registration_id IS NULL OR h.event_id IS NOT ?
          OR h.proof_id IS NOT ? OR COALESCE(h.battery_order,h."order") IS NOT ?
          OR r.category IS NOT json_extract(snapshot.value,'$.category')
          OR r.team_name IS NOT json_extract(snapshot.value,'$.teamName')
          OR r.athlete_ids IS NOT json_extract(snapshot.value,'$.athleteIds')
          OR COALESCE(he.lane_label,'') IS NOT COALESCE(json_extract(snapshot.value,'$.laneLabel'),'')
          OR r.confirmation_status='CANCELLED'
      )
      AND (SELECT COUNT(*) FROM zero3_results r
        WHERE r.event_id=? AND r.proof_id=?
          AND r.registration_id IN (${batteryMembershipSql}))
        = (SELECT COUNT(*) FROM json_each(?) snapshot)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(?) snapshot
        LEFT JOIN zero3_results r ON r.id=json_extract(snapshot.value,'$.id')
        WHERE r.id IS NULL OR r.event_id IS NOT ? OR r.proof_id IS NOT ?
          OR r.registration_id IS NOT json_extract(snapshot.value,'$.registrationId')
          OR r.heat_id IS NOT json_extract(snapshot.value,'$.heatId')
          OR r.status IS NOT json_extract(snapshot.value,'$.status')
          OR r.raw_value IS NOT json_extract(snapshot.value,'$.rawValue')
          OR r.elapsed_ms IS NOT json_extract(snapshot.value,'$.elapsedMs')
          OR r.revision IS NOT json_extract(snapshot.value,'$.revision')
          OR r.captured_at IS NOT json_extract(snapshot.value,'$.capturedAt')
      )
    ON CONFLICT DO NOTHING
    RETURNING *`;
  return {
    sql,
    bindings:[
      input.publicationId,input.eventId,input.proofId,input.batteryOrder,input.version,
      input.fingerprint,input.resultCount,input.resultsJson,input.leaderboardsJson,
      input.publishedBy,input.publishedAt,
      input.eventId,input.proofId,input.batteryOrder,input.expectedCount,asJson(input.guardEntries),
      input.eventId,input.proofId,input.batteryOrder,
      input.eventId,input.proofId,
      input.eventId,input.proofId,input.batteryOrder,
      asJson(input.guardResults),asJson(input.guardResults),input.eventId,input.proofId,
    ],
  };
}

export async function handleD1BatteryFinalization(
  req: Request,
  res: Response,
  DB: D1Database,
): Promise<boolean> {
  const route = req.path.slice("/api/zero3".length);
  const match = route.match(/^\/events\/([^/]+)\/batteries\/([^/]+)\/(\d+)\/finalize$/);
  if (!match || req.method !== "POST") return false;

  if (!await requireD1Member(req, res, DB, finalizerRoles)) return true;
  const parsedParams = FinalizeZero3BatteryParams.safeParse({
    eventId: match[1],
    proofId: match[2],
    batteryOrder: Number(match[3]),
  });
  const parsedBody = FinalizeZero3BatteryBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({
      code: "INVALID_FINALIZATION_REQUEST",
      error: !parsedParams.success
        ? parsedParams.error.message
        : parsedBody.success ? "Corpo de finalização inválido." : parsedBody.error.message,
    });
    return true;
  }
  const { eventId, proofId, batteryOrder } = parsedParams.data;

  try {
    const proof = await DB.prepare(`SELECT id,event_id,proof_order,name,metric_type,unit,direction
      FROM zero3_proofs WHERE id=? AND event_id=?`)
      .bind(proofId, eventId).first<ProofRow>();
    if (!proof) {
      d1ApiError(req, res, 404, "PROOF_NOT_FOUND", "A prova não pertence a este evento.");
      return true;
    }
    const configured = proof.metric_type !== "UNCONFIGURED" && Boolean(proof.name.trim()) &&
      (proof.direction === "LOWER" || proof.direction === "HIGHER");
    if (!configured) {
      d1ApiError(req, res, 409, "PROOF_NOT_CONFIGURED", "Configure a métrica oficial da prova antes de finalizar a bateria.");
      return true;
    }

    const heatRows = await DB.prepare(`SELECT id,category,name FROM zero3_heats
      WHERE event_id=? AND proof_id=? AND COALESCE(battery_order,"order")=?
      ORDER BY category`)
      .bind(eventId, proofId, batteryOrder)
      .all<{ id: string; category: string; name: string }>();
    if (!heatRows.results.length) {
      d1ApiError(req, res, 404, "BATTERY_NOT_FOUND", "A bateria não existe para esta prova.");
      return true;
    }
    const activeBattery = await readD1ActiveBattery(DB, eventId);
    if (!activeBattery || activeBattery.proofId !== proofId || activeBattery.order !== batteryOrder) {
      d1ApiError(req, res, 409, "BATTERY_NOT_SELECTED", "Coloque esta bateria na TV antes de finalizá-la.");
      return true;
    }

    const expectedRows = await DB.prepare(`SELECT h.id AS heat_id,r.id AS registration_id,r.category,
        r.team_name,r.athlete_ids,r.lane_label AS registration_lane_label,
        he.lane_label AS heat_lane_label
      FROM zero3_heats h
      JOIN zero3_heat_entries he ON he.heat_id=h.id
      JOIN zero3_registrations r ON r.id=he.registration_id
      WHERE h.event_id=? AND h.proof_id=? AND COALESCE(h.battery_order,h."order")=?
        AND r.confirmation_status<>'CANCELLED'
      ORDER BY r.category,COALESCE(he.lane_label,r.lane_label),r.id`)
      .bind(eventId, proofId, batteryOrder)
      .all<ExpectedRow>();
    if (!expectedRows.results.length) {
      d1ApiError(req, res, 409, "BATTERY_EMPTY", "A bateria não tem inscrições para finalizar.");
      return true;
    }

    const registrations = expectedRows.results.map((row): BatteryReadinessRegistration & { athleteIds: string[] } => ({
      id: row.registration_id,
      heatId: row.heat_id,
      category: row.category,
      teamName: row.team_name,
      athleteNames: [],
      athleteIds: d1JsonArray(row.athlete_ids),
      heatName: heatRows.results.find(heat=>heat.id===row.heat_id)?.name,
      laneLabel: row.heat_lane_label ?? row.registration_lane_label,
    }));
    const athleteIds = [...new Set(registrations.flatMap((registration) => registration.athleteIds ?? []))];
    const athletes = athleteIds.length
      ? await DB.prepare(`SELECT id,full_name FROM zero3_athletes
          WHERE id IN (${athleteIds.map(() => "?").join(",")})`)
        .bind(...athleteIds)
        .all<{ id: string; full_name: string }>()
      : { results: [] as Array<{ id: string; full_name: string }> };
    const athleteNamesById = new Map(athletes.results.map((athlete) => [athlete.id, athlete.full_name]));
    for (const registration of registrations) {
      registration.athleteNames = (registration.athleteIds ?? []).map((id) => athleteNamesById.get(id) ?? "Atleta removido");
    }

    const resultRows = await DB.prepare(`SELECT r.* FROM zero3_results r
      WHERE r.event_id=? AND r.proof_id=?
        AND r.registration_id IN (
          SELECT he.registration_id
          FROM zero3_heats h JOIN zero3_heat_entries he ON he.heat_id=h.id
          JOIN zero3_registrations reg ON reg.id=he.registration_id
          WHERE h.event_id=? AND h.proof_id=? AND COALESCE(h.battery_order,h."order")=?
            AND reg.confirmation_status<>'CANCELLED'
        )
      ORDER BY r.registration_id`)
      .bind(eventId, proofId, eventId, proofId, batteryOrder)
      .all<ResultRow>();
    const readinessResults = resultRows.results.map(toReadinessResult);
    const proofForScoring: BatteryProof = {
      id: proof.id,
      order: proof.proof_order,
      name: proof.name,
      metricType: proof.metric_type,
      unit: proof.unit,
      direction: proof.direction,
      configured,
    };
    const readiness = evaluateBatteryReadiness({
      proof: proofForScoring,
      registrations,
      results: readinessResults,
    });
    if (!readiness.ready) {
      res.status(409).json({
        code: "BATTERY_RESULTS_INCOMPLETE",
        error: `Não é possível finalizar: ${readiness.reviewedCount} de ${readiness.expectedCount} resultados estão revisados.`,
        reviewedCount: readiness.reviewedCount,
        expectedCount: readiness.expectedCount,
        pending: readiness.issues,
      });
      return true;
    }

    const fingerprint = await fingerprintBatteryPublicationState(registrations, readinessResults, proofForScoring);
    if (fingerprint !== parsedBody.data.expectedFingerprint) {
      d1ApiError(req, res, 409, "BATTERY_FINALIZATION_STALE", "Os resultados mudaram desde a confirmação. Atualize a bateria e confira novamente.");
      return true;
    }

    const existing = await DB.prepare(`SELECT * FROM zero3_heat_publications
      WHERE event_id=? AND proof_id=? AND battery_order=? AND result_fingerprint=?`)
      .bind(eventId, proofId, batteryOrder, fingerprint)
      .first<PublicationRow>();
    if (existing) {
      res.json(FinalizeZero3BatteryResponse.parse({
        eventId, proofId, batteryOrder, version: existing.version,
        resultCount: existing.result_count, publishedAt: new Date(existing.published_at),
        fingerprint, alreadyPublished: true,
      }));
      return true;
    }

    const leaderboards = buildBatteryLeaderboards({
      proof: proofForScoring,
      registrations,
      results: readinessResults.map((result) => ({
        id: result.id,
        registrationId: result.registrationId,
        proofId: result.proofId,
        rawValue: result.rawValue,
        status: result.status,
        heatId: result.heatId,
      })),
      eventStatus: "ACTIVE",
    }).leaderboards;
    if (leaderboards.some((leaderboard) => leaderboard.status === "TIE_RULE_PENDING" ||
      leaderboard.entries.some((entry) => entry.status === "TIE_RULE_PENDING"))) {
      d1ApiError(req, res, 409, "BATTERY_TIE_RULE_PENDING", "Resolva o critério oficial de desempate antes de publicar o pódio.");
      return true;
    }

    const scoreByResultId = new Map<string, { placement: number | null; points: number | null; status: string }>();
    for (const leaderboard of leaderboards) {
      for (const entry of leaderboard.entries) {
        const score = entry.proofScores.find((item) => item.proofId === proofId);
        if (score?.resultId) scoreByResultId.set(score.resultId, score);
      }
    }
    const resultByRegistration = new Map(resultRows.results.map((row) => [row.registration_id, row]));
    const heatNameById = new Map(heatRows.results.map((heat) => [heat.id, heat.name]));
    const publishedResults = registrations.map((registration) => {
      const row = resultByRegistration.get(registration.id)!;
      return resultDto(
        row,
        registration,
        proofId,
        heatNameById.get(row.heat_id) ?? proof.name,
        scoreByResultId.get(row.id),
      );
    }).sort((a, b) => a.category.localeCompare(b.category) ||
      (a.laneLabel ?? "").localeCompare(b.laneLabel ?? "") ||
      a.registrationId.localeCompare(b.registrationId));

    const guardEntries = expectedRows.results.map((row) => ({
      heatId: row.heat_id,
      registrationId: row.registration_id,
      category: row.category,
      laneLabel: row.heat_lane_label ?? row.registration_lane_label,
      teamName: row.team_name,
      athleteIds: row.athlete_ids,
    }));
    const guardResults = resultRows.results.map((row) => ({
      id: row.id,
      registrationId: row.registration_id,
      heatId: row.heat_id,
      proofId: row.proof_id,
      status: row.status,
      rawValue: row.raw_value,
      elapsedMs: row.elapsed_ms,
      revision: row.revision,
      capturedAt: row.captured_at,
    }));
    const versionRow = await DB.prepare(`SELECT COALESCE(MAX(version),0)+1 AS next_version
      FROM zero3_heat_publications WHERE event_id=? AND proof_id=? AND battery_order=?`)
      .bind(eventId, proofId, batteryOrder)
      .first<{ next_version: number }>();
    const version = versionRow?.next_version ?? 1;
    const publicationId = crypto.randomUUID();
    const publishedAt = new Date().toISOString();
    const actorId = getAuth(req).userId;
    if (!actorId) {
      d1ApiError(req, res, 401, "AUTHENTICATION_REQUIRED", "A sessão expirou. Entre novamente.");
      return true;
    }
    const insert=buildBatteryPublicationInsert({
      publicationId,eventId,proofId,batteryOrder,version,fingerprint,
      resultCount:readiness.expectedCount,resultsJson:asJson(publishedResults),
      leaderboardsJson:asJson(leaderboards),publishedBy:actorId,publishedAt,
      expectedCount:readiness.expectedCount,guardEntries,guardResults,
    });
    const save = await DB.prepare(insert.sql).bind(...insert.bindings).first<PublicationRow>();

    if (!save) {
      const duplicate = await DB.prepare(`SELECT * FROM zero3_heat_publications
        WHERE event_id=? AND proof_id=? AND battery_order=? AND result_fingerprint=?`)
        .bind(eventId, proofId, batteryOrder, fingerprint)
        .first<PublicationRow>();
      if (duplicate) {
        res.json(FinalizeZero3BatteryResponse.parse({
          eventId, proofId, batteryOrder, version: duplicate.version,
          resultCount: duplicate.result_count, publishedAt: new Date(duplicate.published_at),
          fingerprint, alreadyPublished: true,
        }));
        return true;
      }
      d1ApiError(req, res, 409, "BATTERY_FINALIZATION_STALE", "A bateria foi alterada durante a finalização. Atualize e tente novamente.");
      return true;
    }

    res.json(FinalizeZero3BatteryResponse.parse({
      eventId, proofId, batteryOrder, version: save.version,
      resultCount: save.result_count, publishedAt: new Date(save.published_at),
      fingerprint: save.result_fingerprint, alreadyPublished: false,
    }));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/unique constraint|constraint failed/i.test(message)) {
      const duplicate = await DB.prepare(`SELECT * FROM zero3_heat_publications
        WHERE event_id=? AND proof_id=? AND battery_order=? AND result_fingerprint=?`)
        .bind(eventId, proofId, batteryOrder, parsedBody.data.expectedFingerprint)
        .first<PublicationRow>();
      if (duplicate) {
        res.json(FinalizeZero3BatteryResponse.parse({
          eventId, proofId, batteryOrder, version: duplicate.version,
          resultCount: duplicate.result_count, publishedAt: new Date(duplicate.published_at),
          fingerprint: duplicate.result_fingerprint, alreadyPublished: true,
        }));
        return true;
      }
    }
    d1ApiError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível finalizar e publicar a bateria.");
  }
  return true;
}
