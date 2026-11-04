export type ManagedRegistrationSummary = {
  id: string;
  category: string;
  teamName?: string | null;
  athleteIds: string[];
  athleteNames: string[];
  confirmationStatus: string;
};

export type RegistrationHistoryLinks = {
  resultCount: number;
  heatEntryCount: number;
  podiumCount: number;
  sourceCodes: string[];
};

export const ZERO3_TEAM_NAME_MAX_LENGTH = 40;
const unsafeTeamNameCharacters = /[<>\u0000-\u001f\u007f-\u009f]/u;

export function teamNameInputError(value: string): string | null {
  if (value.length > ZERO3_TEAM_NAME_MAX_LENGTH) {
    return `O nome da equipe deve ter no máximo ${ZERO3_TEAM_NAME_MAX_LENGTH} caracteres.`;
  }
  if (unsafeTeamNameCharacters.test(value)) {
    return "Não use <, > ou caracteres de controle no nome da equipe.";
  }
  return null;
}

export function normalizeTeamNameInput(value: string): string | null {
  return value.trim().replace(/\s+/gu, " ") || null;
}

export function removeManagedRegistrationDraft<T>(
  drafts: Readonly<Record<string, T>>,
  registrationId: string,
): Record<string, T> {
  if (!(registrationId in drafts)) return { ...drafts };
  const next = { ...drafts };
  delete next[registrationId];
  return next;
}

export function summarizeManagedRegistrations(
  registrations: readonly ManagedRegistrationSummary[],
) {
  const active = registrations.filter((registration) => registration.confirmationStatus !== "CANCELLED");
  return {
    registrationCount: registrations.length,
    activeRegistrationCount: active.length,
    cancelledRegistrationCount: registrations.length - active.length,
    uniqueAthleteCount: new Set(registrations.flatMap((registration) => registration.athleteIds)).size,
    uniqueActiveAthleteCount: new Set(active.flatMap((registration) => registration.athleteIds)).size,
  };
}

export function findAthleteRegistrationConflicts(
  athleteId: string,
  registrations: readonly ManagedRegistrationSummary[],
) {
  if (!athleteId) return [];
  return registrations.filter((registration) => registration.athleteIds.includes(athleteId));
}

export function registrationIdentityEditLock(
  original: { category: string; athleteIds: string[] },
  draft: { category: string; athleteIds: string[]; teamName?: string | null },
  history: RegistrationHistoryLinks,
): string | null {
  const categoryChanged = original.category !== draft.category;
  const athleteIdsChanged = [...original.athleteIds].sort().join("|") !==
    draft.athleteIds.filter(Boolean).sort().join("|");
  if (!categoryChanged && !athleteIdsChanged) return null;

  const links: string[] = [];
  if (history.resultCount) links.push(`${history.resultCount} resultado(s)`);
  if (history.podiumCount) links.push(`${history.podiumCount} pódio(s) publicado(s)`);
  if (categoryChanged && history.heatEntryCount) {
    links.push(`${history.heatEntryCount} bateria(s) que usam a categoria atual`);
  }
  if (!links.length) return null;
  return `Não é possível trocar atletas ou categoria: esta inscrição tem ${links.join(" e ")}. A edição comum preserva a identidade histórica da inscrição.`;
}

export function categoryDisplayName(category: string): string {
  return category === "SC" ? "SC / Scale" : category;
}
