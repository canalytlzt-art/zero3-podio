export function normalizePodiumArbitrationNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

export function visiblePodiumArbitrationNote(published: boolean, value: unknown): string | null {
  return published ? normalizePodiumArbitrationNote(value) : null;
}

export function hasUniquePodiumRegistrations(
  registrationIds: readonly (string | null)[],
): boolean {
  const selected = registrationIds.filter((id): id is string => id !== null);
  return new Set(selected).size === selected.length;
}
