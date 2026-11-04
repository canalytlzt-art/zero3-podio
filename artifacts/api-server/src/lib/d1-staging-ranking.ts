import type { ScoreResult } from "./zero3-scoring";

export type PublishedBatterySnapshot = {
  proofId: string;
  resultFingerprint: string;
  currentFingerprint: string | null;
  resultsJson: string;
};

type LiveScoreResult = Pick<ScoreResult, "id" | "registrationId" | "proofId" | "rawValue" | "status">;

const resultKey = (registrationId: string, proofId: string) => `${registrationId}:${proofId}`;

/**
 * Overall proof standings use only results in the latest still-current battery
 * publication. New or corrected live results remain visible as pending and
 * cannot displace published results until their battery is confirmed again.
 */
export function buildD1LeaderboardResults(input: {
  registrationIds: ReadonlySet<string>;
  liveResults: readonly LiveScoreResult[];
  publications: readonly PublishedBatterySnapshot[];
}): ScoreResult[] {
  const byRegistrationProof = new Map<string, ScoreResult>();
  const publishedResultIds = new Set<string>();

  for (const publication of input.publications) {
    if (!publication.currentFingerprint || publication.currentFingerprint !== publication.resultFingerprint) continue;

    let decoded: unknown;
    try {
      decoded = JSON.parse(publication.resultsJson);
    } catch (cause) {
      throw new Error("Publicação de bateria armazenada está inválida.", { cause });
    }
    if (!Array.isArray(decoded)) throw new Error("Publicação de bateria não contém uma lista de resultados.");

    for (const item of decoded) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Publicação de bateria contém um resultado inválido.");
      }
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.registrationId !== "string" ||
        typeof row.proofId !== "string" || typeof row.status !== "string" ||
        !(row.rawValue === null || typeof row.rawValue === "string" || typeof row.rawValue === "number")) {
        throw new Error("Publicação de bateria contém campos de resultado inválidos.");
      }
      if (row.proofId !== publication.proofId || !input.registrationIds.has(row.registrationId)) {
        throw new Error("Publicação de bateria não corresponde às inscrições ou à prova atual.");
      }
      if (row.status !== "VALIDATED" && row.status !== "DNS" && row.status !== "DNF") {
        throw new Error("Publicação de bateria contém um status não revisado.");
      }
      const key = resultKey(row.registrationId, row.proofId);
      if (byRegistrationProof.has(key)) {
        throw new Error("Uma inscrição aparece em mais de uma bateria publicada da mesma prova.");
      }
      byRegistrationProof.set(key, {
        id: row.id,
        registrationId: row.registrationId,
        proofId: row.proofId,
        rawValue: row.rawValue,
        status: row.status,
      });
      publishedResultIds.add(row.id);
    }
  }

  for (const result of input.liveResults) {
    if (!result.proofId || !input.registrationIds.has(result.registrationId) || publishedResultIds.has(result.id)) continue;
    const key = resultKey(result.registrationId, result.proofId);
    if (byRegistrationProof.has(key)) continue;
    byRegistrationProof.set(key, {
      ...result,
      status: result.status === "PROVISIONAL" ? "PROVISIONAL" : "PUBLICATION_PENDING",
    });
  }

  return [...byRegistrationProof.values()].sort((a, b) =>
    a.registrationId.localeCompare(b.registrationId) ||
    (a.proofId ?? "").localeCompare(b.proofId ?? ""),
  );
}
