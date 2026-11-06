import type { Zero3PublicResult } from "@workspace/api-client-react";

type TvResult = Pick<
  Zero3PublicResult,
  "id" | "registrationId" | "proofId" | "rawValue" | "status" | "revision" | "publishedRevision" | "placement"
>;

export type PublicTvResultCell = {
  result?: TvResult;
  placement: number | null;
  label: string;
  published: boolean;
};

/**
 * The event-wide public board owns official placements. Battery leaderboards
 * are useful for battery-only views, but their places must not be shown as
 * event placements in the TV proof cells.
 */
export function resolvePublicTvResultCell(
  batteryResults: readonly TvResult[],
  eventResults: readonly TvResult[],
  registrationId: string,
  proofId: string,
): PublicTvResultCell {
  const result = batteryResults.find((item) =>
    item.registrationId === registrationId && item.proofId === proofId,
  );
  if (!result) return { placement: null, label: "PENDENTE", published: false };

  const eventResult = eventResults.find((item) =>
    item.id === result.id &&
    item.registrationId === result.registrationId &&
    item.proofId === result.proofId,
  );
  const published = result.status === "VALIDATED" &&
    result.publishedRevision === result.revision &&
    eventResult?.revision === result.revision &&
    eventResult.publishedRevision === result.revision &&
    eventResult.status === "VALIDATED";

  return {
    result,
    placement: published ? eventResult?.placement ?? null : null,
    label: published
      ? "PUBLICADO"
      : result.status === "PROVISIONAL"
        ? "PARCIAL"
        : result.status === "VALIDATED"
          ? "REVISADO"
          : result.status,
    published,
  };
}
