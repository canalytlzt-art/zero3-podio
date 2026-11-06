import {
  calculateAllResultPlacements,
  type ScoreProof,
  type ScoreRegistration,
  type ScoreResult,
  type ScoreTieBreakResolution,
} from "./zero3-scoring";

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
  ties: ReturnType<typeof calculateAllResultPlacements>["leaderboards"][number]["ties"];
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
  persistedTieBreaks?: ScoreTieBreakResolution[];
  tieBreaksOverride?: ScoreTieBreakResolution[];
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
        rawValue: numericValue(row.publishedRawValue) === null ? null : row.publishedRawValue,
        status: row.publishedStatus,
        category: row.category,
        revision: row.publishedRevision,
        elapsedMs: row.publishedElapsedMs,
      });
    }

    if (!["VALIDATED", "DNS", "DNF"].includes(row.status)) continue;
    reviewedCellKeys.add(cellKey);

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

    if (row.status === "VALIDATED" && numericValue(row.rawValue) === 0) {
      const cancelledResult: RankingPublicationSnapshotResult = {
        id: row.id,
        registrationId: row.registrationId,
        proofId: row.proofId,
        rawValue: row.rawValue,
        status: "DNF",
        category: row.category,
        revision: row.revision,
        elapsedMs: row.elapsedMs,
      };
      baseByCell.set(cellKey, cancelledResult);
      issues.push({
        code: "EXCEPTION_RULE_PENDING",
        message: "A marca 0 representa Prova cancelada. O valor foi preservado sem pontos; os demais resultados válidos ainda podem ser publicados.",
        blocking: false,
        resultId: row.id,
      });
      continue;
    }

    if (samePublishedValue(row)) continue;

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
      rawValue: numericValue(row.rawValue) === null ? null : row.rawValue,
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
  const selectedTieBreaks = input.tieBreaksOverride ?? input.persistedTieBreaks ?? [];
  const calculated = calculateAllResultPlacements({
    eventId: input.eventId,
    categories: [...new Set(activeRegistrations.map((registration) => registration.category))],
    eventStatus: input.eventStatus,
    proofs,
    registrations: activeRegistrations,
    results: scoreResults,
    tieBreaks: selectedTieBreaks,
  });
  const ties = calculated.leaderboards.flatMap((board) => board.ties);
  const appliedTieBreaks = ties.flatMap((tie) =>
    tie.orderedRegistrationIds
      ? [{ key: tie.key, orderedRegistrationIds: tie.orderedRegistrationIds }]
      : [],
  );
  if (input.tieBreaksOverride !== undefined) {
    const appliedKeys = new Set(appliedTieBreaks.map((item) => item.key));
    const submittedKeys = input.tieBreaksOverride.map((item) => item.key);
    if (
      new Set(submittedKeys).size !== submittedKeys.length ||
      submittedKeys.some((key) => !appliedKeys.has(key)) ||
      appliedTieBreaks.length !== input.tieBreaksOverride.length
    ) {
      issues.push({
        code: "TIE_BREAK_RESOLUTION_INVALID",
        message: "A ordem manual precisa corresponder exatamente aos participantes do empate atual.",
        blocking: true,
        resultId: null,
      });
    }
  }
  for (const board of calculated.leaderboards) {
    if (board.status === "EXCEPTION_RULE_PENDING") {
      const hasOtherUnresolvedException = [...baseByCell.values()].some((result) =>
        result.category === board.category &&
        (result.status === "DNS" || result.status === "DNF") &&
        numericValue(result.rawValue) !== 0,
      );
      issues.push({
        code: "EXCEPTION_RULE_PENDING",
        message: hasOtherUnresolvedException
          ? `A categoria ${board.category} tem exceção sem regra oficial de pontuação.`
          : `A categoria ${board.category} tem prova cancelada sem regra numérica; as demais marcas válidas podem ser publicadas.`,
        blocking: hasOtherUnresolvedException,
        resultId: null,
      });
    }
    for (const tie of board.ties) {
      const scope = tie.scope === "OVERALL"
        ? "soma total"
        : tie.proofName || `Prova ${tie.proofOrder ?? ""}`;
      const conditionDistance = tie.conditionDistance
        ? ` · Condition empatado em ${tie.conditionDistance.exactValue} ${tie.conditionDistance.unit}`
        : "";
      issues.push({
        code: tie.orderedRegistrationIds ? "TIE_MANUAL_ORDER_APPLIED" : "TIE_SHARED_PLACEMENT",
        message: `Empate exato em ${scope} · ${tie.category} · ${tie.value}${conditionDistance}: ${tie.orderedRegistrationIds ? "ordem manual aplicada" : "participantes compartilham colocação e pontos"}. A publicação continua disponível.`,
        blocking: false,
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
    proofs,
    registrations: activeRegistrations.map((registration) => ({
      id: registration.id,
      category: registration.category,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    results: [...baseByCell.values()].sort((a, b) =>
      `${a.registrationId}:${a.proofId ?? ""}`.localeCompare(`${b.registrationId}:${b.proofId ?? ""}`),
    ),
    tieBreaks: appliedTieBreaks.slice().sort((a, b) =>
      a.key.localeCompare(b.key) ||
      a.orderedRegistrationIds.join("\u0000").localeCompare(b.orderedRegistrationIds.join("\u0000")),
    ),
  });
  const fingerprint = await sha256(fingerprintMaterial);
  const blockingIssue = issues.some((issue) => issue.blocking);
  return {
    version: input.version,
    fingerprint,
    eligibleResultCount: candidates.length,
    partialResultCount,
    resultStates,
    ties,
    affected: [...affectedCounts.values()].map(({ proof, category, count }) => ({
      proofId: proof.id,
      proofOrder: proof.order,
      proofName: proof.name,
      category,
      resultCount: count,
    })).sort((a, b) => a.proofOrder - b.proofOrder || a.category.localeCompare(b.category)),
    issues,
    canPublish: (candidates.length > 0 || ties.length > 0) && !blockingIssue,
    results: [...baseByCell.values()],
    candidates,
    leaderboards: calculated.leaderboards,
  };
}
