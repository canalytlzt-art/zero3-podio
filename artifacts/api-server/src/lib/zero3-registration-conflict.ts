export type Zero3RegistrationIdentity = {
  teamName?: string | null;
  athleteIds: readonly string[];
};

export type Zero3RegistrationConflict =
  | "DUPLICATE_ATHLETE_PAIR"
  | "ATHLETE_ALREADY_REGISTERED";

function athletePairKey(athleteIds: readonly string[]): string {
  return [...athleteIds].sort().join(":");
}

export function findZero3RegistrationConflict(
  existing: readonly Zero3RegistrationIdentity[],
  candidate: Zero3RegistrationIdentity,
): Zero3RegistrationConflict | null {
  const candidatePair = athletePairKey(candidate.athleteIds);

  if (existing.some((registration) =>
    athletePairKey(registration.athleteIds) === candidatePair
  )) {
    return "DUPLICATE_ATHLETE_PAIR";
  }

  if (existing.some((registration) =>
    registration.athleteIds.some((athleteId) => candidate.athleteIds.includes(athleteId))
  )) {
    return "ATHLETE_ALREADY_REGISTERED";
  }

  return null;
}
