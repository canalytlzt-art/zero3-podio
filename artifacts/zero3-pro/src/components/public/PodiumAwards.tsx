import { Trophy } from "lucide-react";
import { observationForPodiumPlace } from "@/lib/podium-editor-state";
import "./PodiumAwards.css";

export type PodiumAwardPlace = {
  place: number;
  registrationId: string;
  teamName?: string | null;
  athleteNames: string[];
};

export type PodiumAwardObservation = {
  place: 1 | 2 | 3;
  registrationId: string;
  note: string;
};

export function PodiumAwards({
  places,
  arbitrationNote,
  placeObservations = [],
  showEmptyPositions = false,
  label = "Pódio publicado",
}: {
  places: readonly PodiumAwardPlace[];
  arbitrationNote?: string | null;
  placeObservations?: readonly PodiumAwardObservation[];
  showEmptyPositions?: boolean;
  label?: string;
}) {
  const shownPlaces = showEmptyPositions
    ? [1, 2, 3]
    : [1, 2, 3].filter((place) => places.some((item) => item.place === place));
  const medalLabels = ["Ouro", "Prata", "Bronze"] as const;
  const note = arbitrationNote?.trim();

  return (
    <div className="zero3-podium-awards" role="group" aria-label={label}>
      <div className="zero3-podium-awards-grid">
        {shownPlaces.map((place) => {
          const winner = places.find((item) => item.place === place);
          const placeObservation = winner
            ? observationForPodiumPlace(place, winner.registrationId, placeObservations)
            : null;
          const displayName = winner?.teamName?.trim() || winner?.athleteNames.join(" · ") || "";
          return (
            <article className={`zero3-podium-award place-${place}`} key={place}>
              <Trophy className="zero3-podium-award-icon" size={19} aria-hidden="true" />
              <div className="zero3-podium-award-copy">
                <span>{medalLabels[place - 1]} · {place}º lugar</span>
                <strong>{displayName || "Aguardando indicação"}</strong>
                {winner?.teamName && winner.athleteNames.length > 0 && (
                  <small>{winner.athleteNames.join(" · ")}</small>
                )}
                {placeObservation ? (
                  <p className="zero3-podium-place-observation">
                    {placeObservation}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {note ? (
        <aside className="zero3-podium-observation" data-testid="podium-arbitration-observation">
          <strong>Observação da arbitragem</strong>
          <p>{note}</p>
        </aside>
      ) : null}
    </div>
  );
}
