export type HeatRegistrationCandidate = {
  id: string;
  eventId: string;
  category: string;
  athleteIds?: readonly string[];
};

export type HeatRegistrationAssignmentResult<T extends HeatRegistrationCandidate> =
  | { ok: true; registrations: T[] }
  | { ok: false; error: string };

/**
 * Resolve heat membership by registration ID, never by athlete ID. Return the
 * rows in the requested order so one two-athlete team still occupies one entry.
 */
export function resolveHeatRegistrationAssignments<T extends HeatRegistrationCandidate>(
  registrationIds: readonly string[],
  rows: readonly T[],
  eventId: string,
  category: string,
): HeatRegistrationAssignmentResult<T> {
  if (new Set(registrationIds).size !== registrationIds.length) {
    return { ok: false, error: "Há inscrições duplicadas na bateria." };
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const registrations = registrationIds.map((registrationId) => byId.get(registrationId));
  if (registrations.some((row) => !row || row.eventId !== eventId || row.category !== category) ||
      rows.length !== registrationIds.length) {
    return {
      ok: false,
      error: "Cada inscrição precisa pertencer ao evento e categoria da bateria.",
    };
  }

  const assignedAthletes = new Set<string>();
  for (const registration of registrations as T[]) {
    for (const athleteId of registration.athleteIds ?? []) {
      if (assignedAthletes.has(athleteId)) {
        return {
          ok: false,
          error: "O mesmo atleta não pode aparecer em mais de uma inscrição desta bateria.",
        };
      }
      assignedAthletes.add(athleteId);
    }
  }

  return { ok: true, registrations: registrations as T[] };
}
