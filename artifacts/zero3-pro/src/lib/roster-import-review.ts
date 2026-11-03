export type RosterImportResolutionChoice = {
  sourceKey: string;
  action: "CREATE" | "REUSE";
  athleteId: string | null;
};

export type RosterImportPreviewPersonChoice = {
  sourceKey: string;
  resolutionAction: "CREATE" | "REUSE" | null;
  resolvedAthleteId: string | null;
};

/**
 * Keeps the operator's current decisions and adopts safe server suggestions.
 * The preview defaults unmatched people to CREATE; possible identity matches
 * remain unresolved until the operator explicitly chooses one.
 */
export function mergeRosterPreviewResolutions(
  people: RosterImportPreviewPersonChoice[],
  submitted: RosterImportResolutionChoice[],
): RosterImportResolutionChoice[] {
  const sourceKeys = new Set(people.map((person) => person.sourceKey));
  const submittedByKey = new Map<string, RosterImportResolutionChoice>();
  for (const resolution of submitted) {
    if (sourceKeys.has(resolution.sourceKey)) {
      submittedByKey.set(resolution.sourceKey, resolution);
    }
  }

  return people.flatMap((person) => {
    const submittedResolution = submittedByKey.get(person.sourceKey);
    if (submittedResolution) return [submittedResolution];
    if (person.resolutionAction === "CREATE") {
      return [{
        sourceKey: person.sourceKey,
        action: "CREATE" as const,
        athleteId: null,
      }];
    }
    if (person.resolutionAction === "REUSE" && person.resolvedAthleteId) {
      return [{
        sourceKey: person.sourceKey,
        action: "REUSE" as const,
        athleteId: person.resolvedAthleteId,
      }];
    }
    return [];
  });
}
