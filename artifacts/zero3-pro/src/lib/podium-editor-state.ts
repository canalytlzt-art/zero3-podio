export type PodiumPlaceNumber = 1 | 2 | 3;
const PODIUM_PLACES: readonly PodiumPlaceNumber[] = [1, 2, 3];

export type PodiumEditorPlaceObservation = {
  place: PodiumPlaceNumber;
  registrationId: string | null;
  note: string;
};

export type StoredPodiumPlaceObservation = {
  place: PodiumPlaceNumber;
  registrationId: string;
  note: string;
};

export function observationsForPodiumSelection(
  registrationIds: readonly (string | null)[],
  saved: readonly StoredPodiumPlaceObservation[] = [],
): PodiumEditorPlaceObservation[] {
  return PODIUM_PLACES.map((place) => {
    const registrationId = registrationIds[place - 1] ?? null;
    const observation = saved.find((item) =>
      item.place === place && item.registrationId === registrationId,
    );
    return { place, registrationId, note: observation?.note ?? "" };
  });
}

export function changePodiumSelection(
  registrationIds: readonly (string | null)[],
  observations: readonly PodiumEditorPlaceObservation[],
  index: number,
  registrationId: string | null,
): { registrationIds: Array<string | null>; observations: PodiumEditorPlaceObservation[] } {
  const nextIds = [...registrationIds];
  nextIds[index] = registrationId;
  return {
    registrationIds: nextIds,
    observations: PODIUM_PLACES.map((place) => {
      const previous = observations[place - 1];
      if (place - 1 === index) return { place, registrationId, note: "" };
      return {
                place,
        registrationId: nextIds[place - 1] ?? null,
        note: previous?.note ?? "",
      };
    }),
  };
}

export function podiumObservationsMatch(
  registrationIds: readonly (string | null)[],
  current: readonly PodiumEditorPlaceObservation[],
  saved: readonly StoredPodiumPlaceObservation[] = [],
): boolean {
  const normalizedSaved = observationsForPodiumSelection(registrationIds, saved);
  const normalizedCurrent = observationsForPodiumSelection(
    registrationIds,
    current.map((item) => ({
      place: item.place,
      registrationId: item.registrationId ?? "",
      note: item.note.trim(),
    })).filter((item): item is StoredPodiumPlaceObservation =>
      Boolean(item.registrationId && item.note),
    ),
  );
  return normalizedCurrent.every((item, index) =>
    item.registrationId === normalizedSaved[index]?.registrationId &&
    item.note === normalizedSaved[index]?.note,
  );
}

export function observationForPodiumPlace(
  place: number,
  registrationId: string,
  observations: readonly StoredPodiumPlaceObservation[],
): string | null {
  const observation = observations.find((item) =>
    item.place === place && item.registrationId === registrationId,
  );
  return observation?.note.trim() || null;
}
