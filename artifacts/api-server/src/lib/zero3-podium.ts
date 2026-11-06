export type PodiumPlaceObservation = {
  place: number;
  registrationId: string;
  note: string;
};

export type PodiumPlaceObservationInput = {
  place: number;
  registrationId: string | null;
  note: string | null;
};

const OBSERVATION_PREFIX = "ZERO3_PODIUM_OBSERVATIONS_V1:";
const MAX_OBSERVATION_LENGTH = 2000;

// Versioned JSON stays in the existing arbitration_note TEXT column; scalar
// values written by earlier clients continue to be read as legacy notes.
export function normalizePodiumArbitrationNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

export function encodePodiumPlaceObservations(
  value: readonly PodiumPlaceObservationInput[],
  registrationIds: readonly (string | null)[],
): string | null {
  const seenPlaces = new Set<number>();
  const observations: PodiumPlaceObservation[] = [];
  for (const item of value) {
    if (![1, 2, 3].includes(item.place) || seenPlaces.has(item.place)) {
      throw new Error("INVALID_PODIUM_OBSERVATION_PLACE");
    }
    seenPlaces.add(item.place);
    const note = normalizePodiumArbitrationNote(item.note);
    if (!note) continue;
    if (note.length > MAX_OBSERVATION_LENGTH) {
      throw new Error("PODIUM_OBSERVATION_TOO_LONG");
    }
    const selectedRegistrationId = registrationIds[item.place - 1];
    if (!selectedRegistrationId || item.registrationId !== selectedRegistrationId) {
      throw new Error("PODIUM_OBSERVATION_REGISTRATION_MISMATCH");
    }
    observations.push({ place: item.place, registrationId: selectedRegistrationId, note });
  }
  return observations.length
    ? `${OBSERVATION_PREFIX}${JSON.stringify(observations)}`
    : null;
}

export function readPodiumPlaceObservations(
  value: unknown,
  registrationIds: readonly (string | null)[],
): { arbitrationNote: string | null; placeObservations: PodiumPlaceObservation[] } {
  const text = normalizePodiumArbitrationNote(value);
  if (!text) return { arbitrationNote: null, placeObservations: [] };
  if (!text.startsWith(OBSERVATION_PREFIX)) {
    return { arbitrationNote: text, placeObservations: [] };
  }

  try {
    const decoded: unknown = JSON.parse(text.slice(OBSERVATION_PREFIX.length));
    if (!Array.isArray(decoded)) return { arbitrationNote: null, placeObservations: [] };
    const seenPlaces = new Set<number>();
    const placeObservations = decoded.flatMap((item): PodiumPlaceObservation[] => {
      if (typeof item !== "object" || item === null) return [];
      const row = item as Record<string, unknown>;
      const place = row.place;
      const registrationId = row.registrationId;
      const note = normalizePodiumArbitrationNote(row.note);
      if (
        typeof place !== "number" ||
        ![1, 2, 3].includes(place) ||
        seenPlaces.has(place) ||
        typeof registrationId !== "string" ||
        registrationIds[place - 1] !== registrationId ||
        !note ||
        note.length > MAX_OBSERVATION_LENGTH
      ) return [];
      seenPlaces.add(place);
      return [{ place, registrationId, note }];
    });
    return { arbitrationNote: null, placeObservations };
  } catch {
    return { arbitrationNote: null, placeObservations: [] };
  }
}

export function visiblePodiumObservations(
  published: boolean,
  value: unknown,
  registrationIds: readonly (string | null)[],
): { arbitrationNote: string | null; placeObservations: PodiumPlaceObservation[] } {
  return published
    ? readPodiumPlaceObservations(value, registrationIds)
    : { arbitrationNote: null, placeObservations: [] };
}

export function hasUniquePodiumRegistrations(
  registrationIds: readonly (string | null)[],
): boolean {
  const selected = registrationIds.filter((id): id is string => id !== null);
  return new Set(selected).size === selected.length;
}
