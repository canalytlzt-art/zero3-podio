type RegistrationIdentity = {
  athleteIds: readonly string[];
  teamName?: string | null;
  category?: string;
};

export function describeRosterAuditChange(
  before: RegistrationIdentity,
  after: RegistrationIdentity,
  athleteNames: ReadonlyMap<string, string>,
): string {
  const beforeIds = new Set(before.athleteIds);
  const afterIds = new Set(after.athleteIds);
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const label = (ids: string[]) => ids.map((id) => athleteNames.get(id) ?? "Atleta não encontrado").join(", ");

  if (removed.length || added.length) {
    return `Atletas substituídos — saíram: ${removed.length ? label(removed) : "nenhum"}; entraram: ${added.length ? label(added) : "nenhum"}.`;
  }
  if (before.category !== after.category) return `Categoria alterada: ${before.category ?? "—"} → ${after.category ?? "—"}.`;
  if (before.teamName !== after.teamName) return "Nome da equipe atualizado; atletas preservados.";
  return "Dados da inscrição atualizados automaticamente.";
}
