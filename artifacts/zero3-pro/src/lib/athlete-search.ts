import type { Zero3Athlete } from "@workspace/api-client-react";

export function normalizeAthleteSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function searchAthletes(
  athletes: readonly Zero3Athlete[],
  query: string,
  excludedId?: string,
): Zero3Athlete[] {
  const normalizedQuery = normalizeAthleteSearch(query);
  return athletes.filter((athlete) =>
    athlete.id !== excludedId &&
    (!normalizedQuery || normalizeAthleteSearch(athlete.fullName).includes(normalizedQuery)),
  );
}

export function describeAthleteReplacement(
  beforeIds: readonly string[],
  afterIds: readonly string[],
  athletes: readonly Zero3Athlete[],
): string | null {
  const before = new Set(beforeIds.filter(Boolean));
  const after = new Set(afterIds.filter(Boolean));
  const removed = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));
  if (!removed.length && !added.length) return null;

  const names = new Map(athletes.map((athlete) => [athlete.id, athlete.fullName]));
  const label = (ids: string[]) => ids.map((id) => names.get(id) ?? "Atleta não encontrado").join(", ");
  return `Confirme a alteração dos atletas desta inscrição:\nSai: ${removed.length ? label(removed) : "ninguém"}\nEntra: ${added.length ? label(added) : "ninguém"}`;
}
