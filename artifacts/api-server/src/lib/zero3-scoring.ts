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

export type ScoreTieBreakResolution = {
  key: string;
  orderedRegistrationIds: string[];
};

export type ScoreTieGroup = {
  key: string;
  scope: "PROOF" | "OVERALL";
  category: ScoreCategory;
  proofId: string | null;
  proofOrder: number | null;
  proofName: string | null;
  value: number;
  exactValue: string;
  registrationIds: string[];
  orderedRegistrationIds: string[] | null;
  conditionDistance?: {
    proofId: string;
    proofName: string;
    proofOrder: number;
    unit: string;
    exactValue: string;
  };
};
export type RankingPodiumPlace = {
  place: number;
  registrationId: string;
  teamName: string | null;
  athleteNames: string[];
};
export type RankingPodiumPlaceObservation = {
  place: number;
  registrationId: string;
  note: string;
};
export type RankingPodium = {
  category: string;
  places: RankingPodiumPlace[];
  arbitrationNote?: string | null;
  placeObservations?: RankingPodiumPlaceObservation[];
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
  ties: ScoreTieGroup[];
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

type ExactDecimal = {
  coefficient: bigint;
  scale: number;
  canonical: string;
  numeric: number;
};

function exactDecimal(value: ScoreResult["rawValue"]): ExactDecimal | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text.length > 256) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, "");
  let coefficient = BigInt(digits || "0") * (match[1] === "-" ? -1n : 1n);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  const absolute = (coefficient < 0n ? -coefficient : coefficient).toString();
  const sign = coefficient < 0n ? "-" : "";
  const canonical = scale === 0
    ? `${sign}${absolute}`
    : (() => {
        const padded = absolute.padStart(scale + 1, "0");
        const whole = padded.slice(0, -scale);
        const decimal = padded.slice(-scale).replace(/0+$/, "");
        return `${sign}${whole}${decimal ? `.${decimal}` : ""}`;
      })();
  const numeric = Number(canonical);
  if (!Number.isFinite(numeric)) return null;
  return { coefficient, scale, canonical, numeric };
}

function compareDecimals(left: ExactDecimal, right: ExactDecimal) {
  const scale = Math.max(left.scale, right.scale);
  const leftInteger = left.coefficient * 10n ** BigInt(scale - left.scale);
  const rightInteger = right.coefficient * 10n ** BigInt(scale - right.scale);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

const valueOf = (value: ScoreResult["rawValue"]) => exactDecimal(value)?.numeric ?? null;

const normalizedUnit = (unit: string | null) => (unit ?? "")
  .trim()
  .toLocaleLowerCase("pt-BR")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .replace(/\s+/g, " ");

const distanceUnits = new Set([
  "distancia",
  "distancia total",
  "mm",
  "milimetro",
  "milimetros",
  "cm",
  "centimetro",
  "centimetros",
  "m",
  "metro",
  "metros",
  "km",
  "quilometro",
  "quilometros",
  "ft",
  "foot",
  "feet",
  "yd",
  "yard",
  "yards",
]);

/**
 * The current ZERO3 event stores Condition's distance in rawValue with unit
 * "Distancia Total", although its legacy metricType is REPETITIONS. Trust only
 * this named fourth proof and an explicit distance unit; never treat a generic
 * repetitions result (for example, unit "Reps") as distance.
 */
function conditionDistanceProof(proofs: readonly ScoreProof[]) {
  const matches = proofs.filter((proof) =>
    proof.order === 4 &&
    proof.name.trim().toLocaleLowerCase("pt-BR") === "condition" &&
    proof.direction === "HIGHER" &&
    distanceUnits.has(normalizedUnit(proof.unit)),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function tieKey(input: {
  scope: ScoreTieGroup["scope"];
  eventId: string;
  category: string;
  proofId: string | null;
  value: string;
  registrationIds: string[];
}) {
  return JSON.stringify({
    scope: input.scope,
    eventId: input.eventId,
    category: input.category,
    proofId: input.proofId,
    value: input.value,
    registrationIds: [...input.registrationIds].sort(),
  });
}

function validTieBreak(
  group: Pick<ScoreTieGroup, "key" | "registrationIds">,
  resolutions: readonly ScoreTieBreakResolution[],
) {
  const resolution = resolutions.find((item) => item.key === group.key);
  if (!resolution || resolution.orderedRegistrationIds.length !== group.registrationIds.length) return null;
  const expected = new Set(group.registrationIds);
  if (
    new Set(resolution.orderedRegistrationIds).size !== expected.size ||
    resolution.orderedRegistrationIds.some((registrationId) => !expected.has(registrationId))
  ) return null;
  return resolution.orderedRegistrationIds;
}

/**
 * Publication snapshots already store the calculated leaderboard JSON. Keep
 * manual arbitration there so decisions are versioned with the ranking and no
 * additional data-store migration is required. Stale keys are ignored by the
 * scorer when the tied mark or its members change.
 */
export function scoreTieBreaksFromSnapshot(snapshot: unknown): ScoreTieBreakResolution[] {
  if (typeof snapshot === "string") {
    try {
      return scoreTieBreaksFromSnapshot(JSON.parse(snapshot));
    } catch (cause) {
      throw new Error("Publicação do ranking armazenada está inválida.", { cause });
    }
  }
  if (!Array.isArray(snapshot)) return [];
  const resolutions: ScoreTieBreakResolution[] = [];
  for (const board of snapshot) {
    if (!board || typeof board !== "object" || Array.isArray(board)) continue;
    const ties = (board as Record<string, unknown>).ties;
    if (!Array.isArray(ties)) continue;
    for (const tie of ties) {
      if (!tie || typeof tie !== "object" || Array.isArray(tie)) continue;
      const row = tie as Record<string, unknown>;
      if (
        typeof row.key === "string" &&
        Array.isArray(row.orderedRegistrationIds) &&
        row.orderedRegistrationIds.every((value) => typeof value === "string")
      ) {
        resolutions.push({
          key: row.key,
          orderedRegistrationIds: row.orderedRegistrationIds as string[],
        });
      }
    }
  }
  return resolutions;
}

/** Derive the event podium presentation from the calculated category leaderboards. */
export function rankingPodiumsFromLeaderboards(leaderboards: unknown): RankingPodium[] {
  if (!Array.isArray(leaderboards)) return [];
  return leaderboards.flatMap((board) => {
    if (!board || typeof board !== "object" || Array.isArray(board)) return [];
    const row = board as Record<string, unknown>;
    if (typeof row.category !== "string" || !Array.isArray(row.entries)) return [];
    const places = row.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      if (
        typeof item.registrationId !== "string" ||
        typeof item.overallPlace !== "number" ||
        !Number.isInteger(item.overallPlace) ||
        item.overallPlace < 1 ||
        item.overallPlace > 3 ||
        typeof item.totalPoints !== "number"
      ) return [];
      return [{
        place: item.overallPlace,
        registrationId: item.registrationId,
        teamName: typeof item.teamName === "string" ? item.teamName : null,
        athleteNames: Array.isArray(item.athleteNames)
          ? item.athleteNames.filter((name): name is string => typeof name === "string")
          : [],
      }];
    }).sort((a, b) => a.place - b.place);
    return places.length ? [{ category: row.category, places }] : [];
  });
}

/** Keep manual, event/category-scoped presentation choices above the calculated default. */
export function mergeRankingPodiums(
  rankingPodiums: readonly RankingPodium[],
  manuallyPublishedPodiums: readonly RankingPodium[],
): RankingPodium[] {
  const rankingByCategory = new Map(rankingPodiums.map((podium) => [podium.category, podium]));
  const manualByCategory = new Map(manuallyPublishedPodiums.map((podium) => [podium.category, podium]));
  const categories = [...new Set([
    ...rankingPodiums.map((podium) => podium.category),
    ...manuallyPublishedPodiums.map((podium) => podium.category),
  ])];
  return categories.flatMap((category) => {
    const podium = manualByCategory.get(category) ?? rankingByCategory.get(category);
    return podium ? [podium] : [];
  });
}

/**
 * Points are derived from the current validated results every time; corrections
 * therefore replace the previous ranking instead of adding points a second time.
 * Exact proof ties share competition places and points unless an explicit
 * manual arbitration order is supplied for a persistent final overall tie.
 */
export function calculateCategoryLeaderboard(input: {
  eventId?: string;
  category: ScoreCategory;
  eventStatus: string;
  proofs: ScoreProof[];
  registrations: ScoreRegistration[];
  results: ScoreResult[];
  tieBreaks?: readonly ScoreTieBreakResolution[];
}): CategoryLeaderboard {
  const proofs = input.proofs.slice().sort((a, b) => a.order - b.order);
  const registrations = input.registrations.filter(
    (registration) => registration.category === input.category,
  );
  const results = input.results.filter(
    (result) => result.proofId !== null && result.proofId !== undefined,
  );
  const placementByResultId = new Map<string, ResultPlacement>();
  const ties: ScoreTieGroup[] = [];
  const proofResults = new Map<string, ScoreResult>();
  const tieBreaks = input.tieBreaks ?? [];

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
          exactDecimal(result.rawValue)?.coefficient !== 0n &&
          registrations.some((registration) => registration.id === result.registrationId),
      )
      .map((result) => ({ result, value: exactDecimal(result.rawValue)! }))
      .sort((a, b) => proof.direction === "LOWER"
        ? compareDecimals(a.value, b.value)
        : compareDecimals(b.value, a.value));

    for (let start = 0; start < ranked.length;) {
      let end = start + 1;
       while (end < ranked.length && compareDecimals(ranked[end]!.value, ranked[start]!.value) === 0) end += 1;
      const tiedRows = ranked.slice(start, end);
      const registrationIds = tiedRows.map(({ result }) => result.registrationId);
      const groupKey = tieKey({
        scope: "PROOF",
        eventId: input.eventId ?? "",
        category: input.category,
        proofId: proof.id,
        value: tiedRows[0]!.value.canonical,
        registrationIds,
      });
      let orderedRegistrationIds: string[] | null = null;
      if (tiedRows.length > 1) {
        // Proof ties always share points under the event rules. Historical
        // resolutions remain in prior snapshots but do not change new proof
        // placements or require a choice during publication.
        orderedRegistrationIds = null;
        ties.push({
          key: groupKey,
          scope: "PROOF",
          category: input.category,
          proofId: proof.id,
          proofOrder: proof.order,
          proofName: proof.name,
          value: tiedRows[0]!.value.numeric,
          exactValue: tiedRows[0]!.value.canonical,
          registrationIds: [...registrationIds].sort(),
          orderedRegistrationIds,
        });
      }
      for (const { result } of tiedRows) {
        const place = start + 1;
        placementByResultId.set(result.id, { placement: place, points: place, tiePending: false });
      }
      start = end;
    }
  }

  const proofConfigured = proofs.length > 0 && proofs.every(configured);
  const entries: LeaderboardEntry[] = registrations.map((registration) => {
    let completedProofs = 0;
    let scoredProofs = 0;
    let pointSum = 0;
    let entryConfigurationPending = false;
    let entryPublicationPending = false;
    let entryExceptionRulePending = false;

    const proofScores = proofs.map((proof): ProofScore => {
      const result = proofResults.get(`${registration.id}:${proof.id}`);
      const resultValue = result ? valueOf(result.rawValue) : null;
      const cancelledMark = result?.status === "VALIDATED" &&
        exactDecimal(result.rawValue)?.coefficient === 0n;
      const isConfigured = configured(proof);
      const placement = result ? placementByResultId.get(result.id) : undefined;
      if (!isConfigured) entryConfigurationPending = true;
      if (placement?.points !== null && placement?.points !== undefined) completedProofs += 1;
      if (result?.status === "PUBLICATION_PENDING") entryPublicationPending = true;
      if (result?.status === "DNS" || result?.status === "DNF" || cancelledMark) {
        entryExceptionRulePending = true;
      }
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
      else if (cancelledMark) status = "DNF";
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
  const rankedEntries = entries
    .filter((entry) => entry.totalPoints !== null)
    .slice()
    .sort((a, b) => (a.totalPoints ?? Number.POSITIVE_INFINITY) - (b.totalPoints ?? Number.POSITIVE_INFINITY));
  const conditionProof = conditionDistanceProof(proofs);
  for (let start = 0; start < rankedEntries.length;) {
    let end = start + 1;
    while (end < rankedEntries.length && rankedEntries[end]?.totalPoints === rankedEntries[start]?.totalPoints) end += 1;
    const tiedEntries = rankedEntries.slice(start, end);
    const total = tiedEntries[0]?.totalPoints;
    if (tiedEntries.length > 1 && total !== null && total !== undefined) {
      const conditionValues = conditionProof && tiedEntries.every((entry) => entry.status === "FINAL")
        ? tiedEntries.flatMap((entry) => {
            const result = proofResults.get(`${entry.registrationId}:${conditionProof.id}`);
            const value = result?.status === "VALIDATED" ? exactDecimal(result.rawValue) : null;
            return value ? [{ entry, value }] : [];
          })
        : [];
      const canUseCondition = conditionValues.length === tiedEntries.length;

      if (canUseCondition && conditionProof) {
        const orderedByDistance = conditionValues.slice().sort((a, b) => compareDecimals(b.value, a.value));
        let offset = 0;
        for (let distanceStart = 0; distanceStart < orderedByDistance.length;) {
          let distanceEnd = distanceStart + 1;
          while (
            distanceEnd < orderedByDistance.length &&
            compareDecimals(orderedByDistance[distanceEnd]!.value, orderedByDistance[distanceStart]!.value) === 0
          ) distanceEnd += 1;
          const distanceGroup = orderedByDistance.slice(distanceStart, distanceEnd);
          if (distanceGroup.length > 1) {
            const registrationIds = distanceGroup.map(({ entry }) => entry.registrationId);
            const groupKey = tieKey({
              scope: "OVERALL",
              eventId: input.eventId ?? "",
              category: input.category,
              proofId: null,
              value: String(total),
              registrationIds,
            });
            const orderedRegistrationIds = validTieBreak({ key: groupKey, registrationIds }, tieBreaks);
            ties.push({
              key: groupKey,
              scope: "OVERALL",
              category: input.category,
              proofId: null,
              proofOrder: null,
              proofName: null,
              value: total,
              exactValue: String(total),
              registrationIds: [...registrationIds].sort(),
              orderedRegistrationIds,
              conditionDistance: {
                proofId: conditionProof.id,
                proofName: conditionProof.name,
                proofOrder: conditionProof.order,
                unit: conditionProof.unit!,
                exactValue: orderedByDistance[distanceStart]!.value.canonical,
              },
            });
            const finalTieEntries = orderedRegistrationIds
              ? orderedRegistrationIds
                .map((registrationId) => distanceGroup.find(({ entry }) => entry.registrationId === registrationId))
                .filter((item): item is NonNullable<typeof item> => Boolean(item))
              : distanceGroup;
            finalTieEntries.forEach(({ entry }, index) => {
              entry.overallPlace = orderedRegistrationIds
                ? start + offset + index + 1
                : start + offset + 1;
            });
          } else {
            const entry = distanceGroup[0]?.entry;
            if (entry) entry.overallPlace = start + offset + 1;
          }
          offset += distanceGroup.length;
          distanceStart = distanceEnd;
        }
      } else {
        const registrationIds = tiedEntries.map((entry) => entry.registrationId);
        const groupKey = tieKey({
          scope: "OVERALL",
          eventId: input.eventId ?? "",
          category: input.category,
          proofId: null,
          value: String(total),
          registrationIds,
        });
        const orderedRegistrationIds = null;
        ties.push({
          key: groupKey,
          scope: "OVERALL",
          category: input.category,
          proofId: null,
          proofOrder: null,
          proofName: null,
          value: total,
          exactValue: String(total),
          registrationIds: [...registrationIds].sort(),
          orderedRegistrationIds,
        });
        for (const entry of tiedEntries) entry.overallPlace = start + 1;
      }
    } else {
      const entry = tiedEntries[0];
      if (entry) entry.overallPlace = start + 1;
    }
    start = end;
  }

  const hasConfigurationPending = !proofConfigured;
  const hasExceptionRulePending = entries.some((entry) => entry.status === "EXCEPTION_RULE_PENDING");
  const status: CategoryLeaderboard["status"] = hasConfigurationPending
    ? "CONFIGURATION_PENDING"
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
    if (a.totalPoints !== null && b.totalPoints !== null && a.totalPoints !== b.totalPoints) {
      return a.totalPoints - b.totalPoints;
    }
    return (a.overallPlace ?? Number.MAX_SAFE_INTEGER) - (b.overallPlace ?? Number.MAX_SAFE_INTEGER);
  });

  return { category: input.category, proofCount: proofs.length, status, entries, ties };
}

export function calculateAllResultPlacements(input: {
  eventId?: string;
  categories: ScoreCategory[];
  eventStatus: string;
  proofs: ScoreProof[];
  registrations: ScoreRegistration[];
  results: ScoreResult[];
  tieBreaks?: readonly ScoreTieBreakResolution[];
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
