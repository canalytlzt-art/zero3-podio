export type OverallCategoryEntry = {
  category: string;
};

export type OverallProof = {
  id: string;
  order: number;
  name: string;
  metricType: string;
  unit: string | null;
};

export type OverallProofScore = {
  proofId: string;
  value: number | null;
  status: string;
  placement: number | null;
  points: number | null;
};

export type OverallEntryPublicationInput = {
  registrationId: string;
  proofScores: readonly OverallProofScore[];
  proofCount: number;
  status: string;
};

export type OverallResultRevision = {
  registrationId: string;
  proofId: string | null;
  revision: number;
  publishedRevision?: number | null;
};

export type OverallPublicationState = "published" | "partial" | "pending";

const unpublishedScoreStatuses = new Set(["MISSING", "PROVISIONAL", "PUBLICATION_PENDING"]);

const scoreStatusLabels: Record<string, string> = {
  MISSING: "Resultado pendente",
  PROVISIONAL: "Provisório",
  PUBLICATION_PENDING: "Aguardando publicação",
  CONFIGURATION_PENDING: "Configuração pendente",
  TIE_RULE_PENDING: "Desempate pendente",
  DNS: "DNS",
  DNF: "DNF",
  VALIDATED: "Classificação pendente",
};

export function overallCategoryLabel(category: string) {
  const normalized = category.trim().toLocaleUpperCase("pt-BR");
  if (normalized === "SC" || normalized === "SCALE" || normalized === "SCALED") return "Scale";
  if (normalized === "RX") return "RX";
  return category;
}

export function preferredOverallCategory(categories: readonly string[]) {
  return categories.find((category) => overallCategoryLabel(category) === "Scale")
    ?? categories[0]
    ?? null;
}

/** Filter the already-calculated leaderboard; never recalculate places or points on a subset. */
export function entriesForOverallCategory<T extends OverallCategoryEntry>(
  entries: readonly T[],
  category: string,
) {
  return entries.filter((entry) => entry.category === category);
}

export function formatPublishedProofMark(value: number, proof: OverallProof) {
  if (proof.metricType === "TIME") {
    const hundredths = Math.max(0, Math.round(value * 100));
    return `${String(Math.floor(hundredths / 6000)).padStart(2, "0")}:${String(Math.floor(hundredths / 100) % 60).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
  }
  const formatted = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
  return proof.unit ? `${formatted} ${proof.unit}` : formatted;
}

export function overallProofScorePresentation(
  proof: OverallProof,
  score?: OverallProofScore,
) {
  const officialMark = Boolean(
    score &&
    score.value !== null &&
    !unpublishedScoreStatuses.has(score.status) &&
    score.status !== "DNS" &&
    score.status !== "DNF",
  );
  const hasPublishedPlacement = Boolean(
    score?.status === "VALIDATED" &&
    score.placement !== null &&
    score.points !== null,
  );
  const mark = score?.status === "DNS" || score?.status === "DNF"
    ? score.status
    : officialMark
      ? formatPublishedProofMark(score!.value!, proof)
      : "—";
  const detail = hasPublishedPlacement
    ? `${score!.placement}º lugar · ${score!.points} ${score!.points === 1 ? "ponto" : "pontos"}`
    : scoreStatusLabels[score?.status ?? "MISSING"] ?? "Resultado pendente";

  return {
    proofName: proof.name,
    mark,
    detail,
    published: officialMark,
    ranked: hasPublishedPlacement,
  };
}

export function overallEntryPublicationState(
  entry: OverallEntryPublicationInput,
  currentResults: readonly OverallResultRevision[],
): OverallPublicationState {
  const hasUnpublishedRevision = currentResults.some((result) =>
    result.registrationId === entry.registrationId &&
    result.proofId !== null &&
    result.revision !== result.publishedRevision,
  );
  if (
    hasUnpublishedRevision ||
    entry.status === "PUBLICATION_PENDING" ||
    entry.proofScores.some((score) => score.status === "PUBLICATION_PENDING")
  ) {
    return "pending";
  }

  const allProofsPublished = entry.proofCount > 0 &&
    entry.proofScores.length === entry.proofCount &&
    entry.proofScores.every((score) =>
      score.status === "VALIDATED" &&
      score.value !== null &&
      score.placement !== null &&
      score.points !== null,
    );
  return allProofsPublished ? "published" : "partial";
}
