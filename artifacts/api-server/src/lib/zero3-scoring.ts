export type ScoreCategory = string;

export type ScoreProof = {
  id: string;
  order: number;
  name: string;
  metricType: string;
  unit: string | null;
  direction: string | null;
};

export type ScoreRegistration = {
  id: string;
  category: string;
  teamName: string | null;
  athleteNames: string[];
  laneLabel: string | null;
};

export type ScoreResult = {
  id: string;
  registrationId: string;
  proofId: string | null;
  rawValue: string | number | null;
  status: string;
};

export type ProofScore = {
  resultId: string | null;
  proofId: string;
  order: number;
  name: string;
  unit: string | null;
  value: number | null;
  status: "MISSING" | "PROVISIONAL" | "PUBLICATION_PENDING" | "VALIDATED" | "DNS" | "DNF" | "CONFIGURATION_PENDING" | "TIE_RULE_PENDING";
  placement: number | null;
  points: number | null;
};

export type LeaderboardEntry = {
  registrationId: string;
  category: ScoreCategory;
  laneLabel: string | null;
  teamName: string | null;
  athleteNames: string[];
  proofScores: ProofScore[];
  completedProofs: number;
  proofCount: number;
  totalPoints: number | null;
  overallPlace: number | null;
  status: "PARTIAL" | "FINAL" | "PUBLICATION_PENDING" | "EXCEPTION_RULE_PENDING" | "TIE_RULE_PENDING" | "CONFIGURATION_PENDING";
};

export type CategoryLeaderboard = {
  category: ScoreCategory;
  proofCount: number;
  status: "PARTIAL" | "FINAL" | "EXCEPTION_RULE_PENDING" | "TIE_RULE_PENDING" | "CONFIGURATION_PENDING";
  entries: LeaderboardEntry[];
};

export type ResultPlacement = {
  placement: number | null;
  points: number | null;
  tiePending: boolean;
};

const configured = (proof: ScoreProof) =>
  proof.metricType !== "UNCONFIGURED" &&
  Boolean(proof.name.trim()) &&
  (proof.direction === "LOWER" || proof.direction === "HIGHER");

const valueOf = (value: ScoreResult["rawValue"]) => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Points are derived from the current validated results every time; corrections
 * therefore replace the previous ranking instead of adding points a second time.
 * Any metric tie blocks points for that proof until an official tie rule exists.
 */
export function calculateCategoryLeaderboard(input: {
  category: ScoreCategory;
  eventStatus: string;
  proofs: ScoreProof[];
  registrations: ScoreRegistration[];
  results: ScoreResult[];
}): CategoryLeaderboard {
  const proofs = input.proofs.slice().sort((a, b) => a.order - b.order);
  const registrations = input.registrations.filter(
    (registration) => registration.category === input.category,
  );
  const results = input.results.filter(
    (result) => result.proofId !== null && result.proofId !== undefined,
  );
  const placementByResultId = new Map<string, ResultPlacement>();
  const proofHasTie = new Set<string>();
  const proofResults = new Map<string, ScoreResult>();

  for (const result of results) {
    if (result.proofId) {
      proofResults.set(`${result.registrationId}:${result.proofId}`, result);
    }
  }

  for (const proof of proofs) {
    if (!configured(proof)) continue;
    const ranked = results
      .filter(
        (result) =>
          result.proofId === proof.id &&
          result.status === "VALIDATED" &&
          valueOf(result.rawValue) !== null &&
          registrations.some((registration) => registration.id === result.registrationId),
      )
      .map((result) => ({ result, value: valueOf(result.rawValue) as number }))
      .sort((a, b) =>
        proof.direction === "LOWER" ? a.value - b.value : b.value - a.value,
      );

    const hasTie = ranked.some(
      (item, index) => index > 0 && item.value === ranked[index - 1]?.value,
    );
    if (hasTie) {
      proofHasTie.add(proof.id);
      for (const item of ranked) {
        placementByResultId.set(item.result.id, {
          placement: null,
          points: null,
          tiePending: true,
        });
      }
      continue;
    }

    ranked.forEach(({ result }, index) => {
      const place = index + 1;
      placementByResultId.set(result.id, {
        placement: place,
        points: place,
        tiePending: false,
      });
    });
  }

  const proofConfigured = proofs.length > 0 && proofs.every(configured);
  const entries: LeaderboardEntry[] = registrations.map((registration) => {
    let completedProofs = 0;
    let scoredProofs = 0;
    let pointSum = 0;
    let entryTiePending = false;
    let entryConfigurationPending = false;
    let entryPublicationPending = false;
    let entryExceptionRulePending = false;

    const proofScores = proofs.map((proof): ProofScore => {
      const result = proofResults.get(`${registration.id}:${proof.id}`);
      const resultValue = result ? valueOf(result.rawValue) : null;
      const isConfigured = configured(proof);
      const placement = result ? placementByResultId.get(result.id) : undefined;
      if (!isConfigured) entryConfigurationPending = true;
      if (placement?.points !== null && placement?.points !== undefined) completedProofs += 1;
      if (placement?.tiePending) entryTiePending = true;
      if (result?.status === "PUBLICATION_PENDING") entryPublicationPending = true;
      if (result?.status === "DNS" || result?.status === "DNF") entryExceptionRulePending = true;
      if (placement?.points !== null && placement?.points !== undefined) {
        scoredProofs += 1;
        pointSum += placement.points;
      }

      let status: ProofScore["status"] = "MISSING";
      if (!isConfigured) status = "CONFIGURATION_PENDING";
      else if (placement?.tiePending) status = "TIE_RULE_PENDING";
      else if (result?.status === "PUBLICATION_PENDING") status = "PUBLICATION_PENDING";
      else if (result?.status === "PROVISIONAL") status = "PROVISIONAL";
      else if (result?.status === "VALIDATED" && placement?.points !== null && placement?.points !== undefined) {
        status = "VALIDATED";
      } else if (result?.status === "DNS") status = "DNS";
      else if (result?.status === "DNF") status = "DNF";
      else if (result?.status === "VALIDATED") status = "MISSING";
      else if (result) status = "PROVISIONAL";

      return {
        resultId: result?.id ?? null,
        proofId: proof.id,
        order: proof.order,
        name: proof.name || `Prova ${proof.order}`,
        unit: proof.unit,
        value: resultValue,
        status,
        placement: placement?.placement ?? null,
        points: placement?.points ?? null,
      };
    });

    const allProofsScored =
      proofConfigured &&
      proofs.length > 0 &&
      proofScores.length === proofs.length &&
      proofScores.every((score) => score.status === "VALIDATED" && score.points !== null);
    return {
      registrationId: registration.id,
      category: input.category,
      laneLabel: registration.laneLabel,
      teamName: registration.teamName,
      athleteNames: registration.athleteNames,
      proofScores,
      completedProofs,
      proofCount: proofs.length,
      totalPoints: scoredProofs > 0 ? pointSum : null,
      overallPlace: null,
      status: entryConfigurationPending
        ? "CONFIGURATION_PENDING"
        : entryTiePending
          ? "TIE_RULE_PENDING"
          : entryExceptionRulePending
            ? "EXCEPTION_RULE_PENDING"
            : entryPublicationPending
              ? "PUBLICATION_PENDING"
              : allProofsScored && input.eventStatus === "FINISHED"
                ? "FINAL"
                : "PARTIAL",
    };
  });

  const allComplete =
    input.eventStatus === "FINISHED" &&
    proofConfigured &&
    entries.length > 0 &&
    entries.every((entry) => entry.status === "FINAL");
  let overallTiePending = false;
  if (allComplete && entries.length > 0) {
    const totals = new Set<number>();
    for (const entry of entries) {
      if (entry.totalPoints === null || totals.has(entry.totalPoints)) {
        overallTiePending = true;
        break;
      }
      totals.add(entry.totalPoints);
    }
  }
  if (overallTiePending) {
    for (const entry of entries) entry.status = "TIE_RULE_PENDING";
  }

  if (allComplete && !overallTiePending) {
    entries
      .slice()
      .sort((a, b) => (a.totalPoints ?? Number.POSITIVE_INFINITY) - (b.totalPoints ?? Number.POSITIVE_INFINITY))
      .forEach((entry, index) => {
        entry.overallPlace = index + 1;
      });
  }

  const hasConfigurationPending = !proofConfigured;
  const hasProofTie = proofHasTie.size > 0 || overallTiePending;
  const hasExceptionRulePending = entries.some((entry) => entry.status === "EXCEPTION_RULE_PENDING");
  const status: CategoryLeaderboard["status"] = hasConfigurationPending
    ? "CONFIGURATION_PENDING"
    : hasProofTie
      ? "TIE_RULE_PENDING"
      : hasExceptionRulePending
        ? "EXCEPTION_RULE_PENDING"
        : allComplete
          ? "FINAL"
          : "PARTIAL";

  entries.sort((a, b) => {
    if (a.status === "FINAL" && b.status !== "FINAL") return -1;
    if (b.status === "FINAL" && a.status !== "FINAL") return 1;
    if (a.totalPoints === null && b.totalPoints !== null) return 1;
    if (b.totalPoints === null && a.totalPoints !== null) return -1;
    return (a.totalPoints ?? Number.POSITIVE_INFINITY) - (b.totalPoints ?? Number.POSITIVE_INFINITY);
  });

  return { category: input.category, proofCount: proofs.length, status, entries };
}

export function calculateAllResultPlacements(input: {
  categories: ScoreCategory[];
  eventStatus: string;
  proofs: ScoreProof[];
  registrations: ScoreRegistration[];
  results: ScoreResult[];
}) {
  const leaderboards = input.categories.map((category) =>
    calculateCategoryLeaderboard({ ...input, category }),
  );
  const placements = new Map<string, ResultPlacement>();

  for (const board of leaderboards) {
    for (const entry of board.entries) {
      for (const score of entry.proofScores) {
        if (!score.resultId) continue;
        placements.set(score.resultId, {
          placement: score.placement,
          points: score.points,
          tiePending: score.status === "TIE_RULE_PENDING",
        });
      }
    }
  }
  return { leaderboards, placements };
}
