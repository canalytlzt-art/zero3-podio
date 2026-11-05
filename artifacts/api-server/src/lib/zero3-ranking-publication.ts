import { calculateAllResultPlacements, type ScoreProof, type ScoreRegistration, type ScoreResult } from "./zero3-scoring";

export type RankingPublicationProof = ScoreProof;
export type RankingPublicationRegistration = ScoreRegistration & { active: boolean };

export type RankingPublicationResult = {
  id: string;
  registrationId: string;
  proofId: string | null;
  category: string;
  status: string;
  rawValue: string | number | null;
  elapsedMs: number | null;
  revision: number;
  publishedStatus: string | null;
  publishedRawValue: string | number | null;
  publishedElapsedMs: number | null;
  publishedRevision: number | null;
  associationValid: boolean;
};

export type RankingPublicationIssue = {
  code: string;
  message: string;
  blocking: boolean;
  resultId: string | null;
};

export type RankingPublicationSnapshotResult = ScoreResult & {
  category: string;
  revision: number;
  elapsedMs: number | null;
};

export type RankingPublicationPlan = {
  version: number;
  fingerprint: string;
  eligibleResultCount: number;
  partialResultCount: number;
  resultStates: Array<{
    resultId: string;
    revision: number;
    state: "PARCIAL" | "REVISADO" | "PUBLICADO";
    previouslyPublished: boolean;
  }>;
  affected: Array<{
    proofId: string;
    proofOrder: number;
    proofName: string;
    category: string;
    resultCount: number;
  }>;
  issues: RankingPublicationIssue[];
  canPublish: boolean;
  results: RankingPublicationSnapshotResult[];
  candidates: RankingPublicationSnapshotResult[];
  leaderboards: ReturnType<typeof calculateAllResultPlacements>["leaderboards"];
};

const numericValue = (value: string | number | null) => {
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
};

const samePublishedValue = (row: RankingPublicationResult) =>
  row.publishedRevision === row.revision &&
  row.publishedStatus === row.status &&
  (row.publishedRawValue === null || row.rawValue === null
    ? row.publishedRawValue === row.rawValue
    : Number(row.publishedRawValue) === Number(row.rawValue)) &&
  row.publishedElapsedMs === row.elapsedMs;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds an immutable event-wide official snapshot. Current reviewed rows are
 * overlays; an earlier published value remains the baseline until a new
 * revision is explicitly published.
 */
export async function buildRankingPublicationPlan(input: {
  eventId: string;
  eventStatus: string;
  version: number;
  proofs: RankingPublicationProof[];
  registrations: RankingPublicationRegistration[];
  results: RankingPublicationResult[];
}): Promise<RankingPublicationPlan> {
  const proofs = input.proofs.slice().sort((a, b) => a.order - b.order);
  const activeRegistrations = input.registrations.filter((registration) => registration.active);
  const proofById = new Map(proofs.map((proof) => [proof.id, proof]));
  const registrationById = new Map(activeRegistrations.map((registration) => [registration.id, registration]));
  const issues: RankingPublicationIssue[] = [];
  const baseByCell = new Map<string, RankingPublicationSnapshotResult>();
  const candidates: RankingPublicationSnapshotResult[] = [];
  const reviewedCellKeys = new Set<string>();
  const affectedCounts = new Map<string, { proof: RankingPublicationProof; category: string; count: number }>();

  for (const proof of proofs) {
    if (
      proof.metricType === "UNCONFIGURED" ||
      !proof.name.trim() ||
      (proof.direction !== "LOWER" && proof.direction !== "HIGHER")
    ) {
      issues.push({
        code: "PROOF_CONFIGURATION_PENDING",
        message: `${proof.name.trim() || `Prova ${proof.order}`} ainda não tem métrica, unidade/direção válidas.`,
        blocking: false,
        resultId: null,
      });
    }
  }

  for (const row of input.results) {
    const registration = registrationById.get(row.registrationId);
    const proof = row.proofId ? proofById.get(row.proofId) : undefined;
    const cellKey = `${row.registrationId}:${row.proofId ?? ""}`;

    if (row.publishedStatus && row.publishedRevision !== null) {
      baseByCell.set(cellKey, {
        id: row.id,
        registrationId: row.registrationId,
        proofId: row.proofId,
        rawValue: row.publishedRawValue,
        status: row.publishedStatus,
        category: row.category,
        revision: row.publishedRevision,
        elapsedMs: row.publishedElapsedMs,
      });
    }

    if (!["VALIDATED", "DNS", "DNF"].includes(row.status)) continue;
    reviewedCellKeys.add(cellKey);
    if (samePublishedValue(row)) continue;

    if (
      !registration ||
      !proof ||
      registration.category !== row.category ||
      !row.associationValid
    ) {
      issues.push({
        code: "RESULT_ASSOCIATION_INVALID",
        message: "Há um resultado revisado sem vínculo válido com inscrição, categoria, prova e bateria.",
        blocking: true,
        resultId: row.id,
      });
      continue;
    }

    if (row.status === "DNS" || row.status === "DNF") {
      issues.push({
        code: "EXCEPTION_RULE_PENDING",
        message: `${row.status} ainda não tem regra de pontuação configurada para esta publicação.`,
        blocking: true,
        resultId: row.id,
      });
      continue;
    }

    if (
      proof.metricType === "UNCONFIGURED" ||
      !proof.name.trim() ||
      (proof.direction !== "LOWER" && proof.direction !== "HIGHER") ||
      numericValue(row.rawValue) === null
    ) {
      issues.push({
        code: "RESULT_CONFIGURATION_INVALID",
        message: "O resultado revisado usa uma prova sem regra válida ou não tem valor numérico.",
        blocking: true,
        resultId: row.id,
      });
      continue;
    }

    const candidate: RankingPublicationSnapshotResult = {
      id: row.id,
      registrationId: row.registrationId,
      proofId: row.proofId,
      rawValue: numericValue(row.rawValue),
      status: "VALIDATED",
      category: row.category,
      revision: row.revision,
      elapsedMs: row.elapsedMs,
    };
    candidates.push(candidate);
    baseByCell.set(cellKey, candidate);
    const groupKey = `${proof.id}:${row.category}`;
    const group = affectedCounts.get(groupKey);
    affectedCounts.set(groupKey, {
      proof,
      category: row.category,
      count: (group?.count ?? 0) + 1,
    });
  }

  const scoreResults: ScoreResult[] = [...baseByCell.values()].map((result) => ({
    id: result.id,
    registrationId: result.registrationId,
    proofId: result.proofId,
    rawValue: result.rawValue,
    status: result.status,
  }));
  const calculated = calculateAllResultPlacements({
    categories: [...new Set(activeRegistrations.map((registration) => registration.category))],
    eventStatus: input.eventStatus,
    proofs,
    registrations: activeRegistrations,
    results: scoreResults,
  });
  for (const board of calculated.leaderboards) {
    if (board.status === "TIE_RULE_PENDING") {
      issues.push({
        code: "TIE_RULE_PENDING",
        message: `A categoria ${board.category} contém empate sem regra oficial de desempate.`,
        blocking: true,
        resultId: null,
      });
    }
    if (board.status === "EXCEPTION_RULE_PENDING") {
      issues.push({
        code: "EXCEPTION_RULE_PENDING",
        message: `A categoria ${board.category} tem exceção sem regra oficial de pontuação.`,
        blocking: true,
        resultId: null,
      });
    }
  }

  const expectedCells = activeRegistrations.length * proofs.length;
  const partialResultCount = Math.max(0, expectedCells - reviewedCellKeys.size);
  const resultStates = input.results.map((row) => ({
    resultId: row.id,
    revision: row.revision,
    state: row.status === "PROVISIONAL"
      ? "PARCIAL" as const
      : samePublishedValue(row)
        ? "PUBLICADO" as const
        : "REVISADO" as const,
    previouslyPublished: Boolean(row.publishedStatus),
  }));
  const fingerprintMaterial = JSON.stringify({
    eventId: input.eventId,
    version: input.version,
    proofs,
    registrations: activeRegistrations.map((registration) => ({
      id: registration.id,
      category: registration.category,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    results: [...baseByCell.values()].sort((a, b) =>
      `${a.registrationId}:${a.proofId ?? ""}`.localeCompare(`${b.registrationId}:${b.proofId ?? ""}`),
    ),
    candidates: candidates.map(({ id, revision }) => ({ id, revision })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const fingerprint = await sha256(fingerprintMaterial);
  const blockingIssue = issues.some((issue) => issue.blocking);
  return {
    version: input.version,
    fingerprint,
    eligibleResultCount: candidates.length,
    partialResultCount,
    resultStates,
    affected: [...affectedCounts.values()].map(({ proof, category, count }) => ({
      proofId: proof.id,
      proofOrder: proof.order,
      proofName: proof.name,
      category,
      resultCount: count,
    })).sort((a, b) => a.proofOrder - b.proofOrder || a.category.localeCompare(b.category)),
    issues,
    canPublish: candidates.length > 0 && !blockingIssue,
    results: [...baseByCell.values()],
    candidates,
    leaderboards: calculated.leaderboards,
  };
}
