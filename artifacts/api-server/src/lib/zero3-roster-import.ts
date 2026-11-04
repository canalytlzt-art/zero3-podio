import {
  ZERO3_ROSTER_SOURCE,
  findRosterIdentityCandidates,
  rosterSourcePeople,
  type Zero3RosterExistingAthlete,
  type Zero3RosterPersonResolution,
} from "./zero3-roster-source";

export type RosterImportCategory = "SC" | "SCALE" | "RX";

export type RosterIdentityHistory = {
  resultCount: number;
  heatEntryCount: number;
  importCount: number;
  podiumCount: number;
};

export function rosterIdentityChanged(
  original: { category: string; athleteIds: readonly string[] },
  next: { category: string; athleteIds: readonly string[] },
): boolean {
  const changes = rosterIdentityChanges(original, next);
  return changes.categoryChanged || changes.athleteIdsChanged;
}

/**
 * Import records and heat entries point to the stable registration ID, so an
 * athlete replacement before results are recorded can preserve those links.
 * A category change still requires rebuilding any category-specific heat.
 * Results and published podiums are historical records and lock identity edits.
 */
export function rosterIdentityChanges(
  original: { category: string; athleteIds: readonly string[] },
  next: { category: string; athleteIds: readonly string[] },
): { athleteIdsChanged: boolean; categoryChanged: boolean } {
  return {
    categoryChanged: original.category !== next.category,
    athleteIdsChanged: [...original.athleteIds].sort().join("|") !==
      [...next.athleteIds].sort().join("|"),
  };
}

export type RosterManagementFields = {
  teamName: string | null;
  category: string;
  athleteIds: readonly string[];
  confirmationStatus: string;
  paymentStatus: string;
};

export function changedRosterManagementFields(
  original: RosterManagementFields,
  next: RosterManagementFields,
): {
  teamName: boolean;
  category: boolean;
  athleteIds: boolean;
  confirmationStatus: boolean;
  paymentStatus: boolean;
} {
  return {
    teamName: original.teamName !== next.teamName,
    category: original.category !== next.category,
    athleteIds: JSON.stringify(original.athleteIds) !== JSON.stringify(next.athleteIds),
    confirmationStatus: original.confirmationStatus !== next.confirmationStatus,
    paymentStatus: original.paymentStatus !== next.paymentStatus,
  };
}

export function rosterIdentityEditConflict(
  changes: { athleteIdsChanged: boolean; categoryChanged: boolean },
  history: RosterIdentityHistory,
): string | null {
  if (!changes.athleteIdsChanged && !changes.categoryChanged) return null;

  const linked: string[] = [];
  if (history.resultCount) linked.push(`${history.resultCount} resultado(s)`);
  if (history.podiumCount) linked.push(`${history.podiumCount} pódio(s) publicado(s)`);
  if (changes.categoryChanged && history.heatEntryCount) {
    linked.push(`${history.heatEntryCount} bateria(s) que usam a categoria atual`);
  }
  if (linked.length === 0) return null;

  return `Não é possível trocar atletas ou categoria: esta inscrição tem ${linked.join(" e ")}. A edição comum preserva a identidade histórica da inscrição.`;
}

export type RosterImportRegistration = {
  id: string;
  category: string;
  athleteIds: string[];
  confirmationStatus: string;
  paymentStatus: string;
};

export type RosterImportResolutionInput = {
  sourceKey: string;
  action: "CREATE" | "REUSE";
  athleteId: string | null;
};

export type RosterImportPlan = {
  event: {
    id: string;
    name: string;
    proofName: string;
    status: "PLANNED" | "ACTIVE" | "FINISHED";
    preparationSeconds: number;
    createdAt: Date;
  };
  datasetKey: string;
  sourceFile: string;
  sourceSheet: string;
  contentHash: string;
  environment: string;
  alreadyApplied: boolean;
  isDemoTarget: boolean;
  people: Array<{
    sourceKey: string;
    sourceCode: string;
    sourceCell: string;
    fullName: string;
    candidates: Zero3RosterExistingAthlete[];
    resolutionAction: "CREATE" | "REUSE" | null;
    resolvedAthleteId: string | null;
  }>;
  teams: Array<{
    sourceCode: string;
    sourceCategory: "RX" | "SCALE";
    sourceRow: number;
    sourceCells: [string, string];
    athleteNames: [string, string];
    targetCategory: string;
    existingRegistrationId: string | null;
    conflict: string | null;
    confirmationStatus: "PENDING" | "CONFIRMED" | "CANCELLED";
    paymentStatus: "UNVERIFIED" | "PENDING" | "PAID" | "NOT_PAID";
  }>;
  counts: {
    sourcePeople: number;
    sourceTeams: number;
    peopleToCreate: number;
    peopleToReuse: number;
    unresolvedPeople: number;
    teamsToCreate: number;
    teamsToReuse: number;
    conflicts: number;
  };
  excludedSourceNotes: Array<{ cells: string[]; text: string }>;
};

export async function rosterSourceContentHash(): Promise<string> {
  const canonicalSource = JSON.stringify({
    datasetKey: ZERO3_ROSTER_SOURCE.datasetKey,
    fileName: ZERO3_ROSTER_SOURCE.fileName,
    sheetName: ZERO3_ROSTER_SOURCE.sheetName,
    teams: ZERO3_ROSTER_SOURCE.teams,
    excludedSourceNotes: ZERO3_ROSTER_SOURCE.excludedSourceNotes,
  });
  const runtimeCrypto = (globalThis as unknown as {
    crypto: {
      subtle: {
        digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
      };
    };
  }).crypto;
  const digest = await runtimeCrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalSource),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildRosterImportPlan(input: {
  event: RosterImportPlan["event"];
  environment: string;
  existingAthletes: Zero3RosterExistingAthlete[];
  existingRegistrations: RosterImportRegistration[];
  resolutions: RosterImportResolutionInput[];
  scaleTargetCategory: "SC" | "SCALE";
  contentHash: string;
  alreadyApplied?: boolean;
  appliedPeople?: Map<string, string>;
  appliedRegistrations?: Map<string, string>;
}): RosterImportPlan {
  const sourcePeople = rosterSourcePeople();
  const allowedSourceKeys = new Set(sourcePeople.map((person) => person.sourceKey));
  const resolutionByKey = new Map<string, RosterImportResolutionInput>();
  for (const resolution of input.resolutions) {
    if (!allowedSourceKeys.has(resolution.sourceKey) || resolutionByKey.has(resolution.sourceKey)) {
      throw new Error("A resolução contém uma pessoa de origem inválida ou duplicada.");
    }
    resolutionByKey.set(resolution.sourceKey, resolution);
  }

  const people = sourcePeople.map((person) => {
    const candidates = findRosterIdentityCandidates(
      person.fullName,
      input.existingAthletes,
    );
    const selected = input.appliedPeople?.get(person.sourceKey);
    const resolution = selected
      ? { action: "REUSE" as const, athleteId: selected }
      : resolutionByKey.get(person.sourceKey);

    if (selected) {
      if (!input.existingAthletes.some((athlete) => athlete.id === selected)) {
        throw new Error("O mapeamento previamente aplicado aponta para um cadastro ausente.");
      }
    } else if (resolution?.action === "REUSE") {
      if (!resolution.athleteId || !candidates.some((candidate) => candidate.id === resolution.athleteId)) {
        throw new Error("Só é possível reutilizar um atleta apresentado como candidato na prévia.");
      }
    } else if (resolution?.action === "CREATE" && resolution.athleteId !== null) {
      throw new Error("Uma resolução de criação não pode informar um ID existente.");
    }

    return {
      sourceKey: person.sourceKey,
      sourceCode: person.sourceCode,
      sourceCell: person.sourceCell,
      fullName: person.fullName,
      candidates,
      resolutionAction:
        resolution?.action ?? (candidates.length === 0 ? "CREATE" : null),
      resolvedAthleteId:
        resolution?.action === "REUSE" ? resolution.athleteId : null,
    };
  });

  const reusedIds = people
    .filter((person) => person.resolutionAction === "REUSE")
    .map((person) => person.resolvedAthleteId);
  if (new Set(reusedIds).size !== reusedIds.length) {
    throw new Error("Um mesmo cadastro não pode representar duas pessoas da planilha.");
  }

  const registrationsByCode = new Map(
    (input.appliedRegistrations ?? new Map()).entries(),
  );
  let conflicts = 0;
  let teamsToCreate = 0;
  let teamsToReuse = 0;
  const teams = ZERO3_ROSTER_SOURCE.teams.map((team) => {
    const targetCategory =
      team.category === "RX" ? "RX" : input.scaleTargetCategory;
    const personA = people.find((person) => person.sourceKey === `${team.code}:1`)!;
    const personB = people.find((person) => person.sourceKey === `${team.code}:2`)!;
    const idsResolved =
      personA.resolutionAction !== null &&
      personB.resolutionAction !== null &&
      (personA.resolutionAction === "CREATE" || personA.resolvedAthleteId !== null) &&
      (personB.resolutionAction === "CREATE" || personB.resolvedAthleteId !== null);
    const resolvedIds = [
      personA.resolvedAthleteId,
      personB.resolvedAthleteId,
    ].filter((id): id is string => id !== null);
    let conflict: string | null = null;
    let existingRegistrationId = registrationsByCode.get(team.code) ?? null;

    if (!idsResolved) {
      conflict = "IDENTITY_RESOLUTION_REQUIRED";
    } else if (new Set(resolvedIds).size !== resolvedIds.length) {
      conflict = "DUPLICATE_ATHLETE_IN_TEAM";
    } else if (!existingRegistrationId && resolvedIds.length === 2) {
      const sortedIds = [...resolvedIds].sort();
      const exactRegistration = input.existingRegistrations.find(
        (registration) =>
          registration.category === targetCategory &&
          [...registration.athleteIds].sort().join(":") === sortedIds.join(":"),
      );
      if (exactRegistration) {
        existingRegistrationId = exactRegistration.id;
      } else {
        const occupied = input.existingRegistrations.some(
          (registration) =>
            registration.athleteIds.some((id) => resolvedIds.includes(id)),
        );
        if (occupied) conflict = "ATHLETE_ALREADY_REGISTERED_IN_EVENT";
      }
    }

    if (existingRegistrationId) {
      const existing = input.existingRegistrations.find(
        (registration) => registration.id === existingRegistrationId,
      );
      if (!existing && !input.alreadyApplied) {
        conflict = "SOURCE_MAPPING_NOT_FOUND";
      } else if (input.alreadyApplied && existing) {
        teamsToReuse += 1;
      } else if (
        existing &&
        (existing.confirmationStatus !== "CONFIRMED" ||
          existing.paymentStatus !== "PAID")
      ) {
        conflict = "EXISTING_CONFIRMATION_OR_PAYMENT_DIFFERS";
      } else if (!conflict) {
        teamsToReuse += 1;
      }
    } else if (!conflict) {
      teamsToCreate += 1;
    }

    if (conflict) conflicts += 1;
    return {
      sourceCode: team.code,
      sourceCategory: team.category,
      sourceRow: team.sourceRow,
      sourceCells: team.athleteCells,
      athleteNames: team.athleteNames,
      targetCategory,
      existingRegistrationId,
      conflict,
      confirmationStatus:
        input.alreadyApplied && existingRegistrationId
          ? input.existingRegistrations.find((registration) => registration.id === existingRegistrationId)?.confirmationStatus as RosterImportPlan["teams"][number]["confirmationStatus"] ?? "CONFIRMED"
          : "CONFIRMED",
      paymentStatus:
        input.alreadyApplied && existingRegistrationId
          ? input.existingRegistrations.find((registration) => registration.id === existingRegistrationId)?.paymentStatus as RosterImportPlan["teams"][number]["paymentStatus"] ?? "PAID"
          : "PAID",
    };
  });

  const unresolvedPeople = people.filter(
    (person) => person.resolutionAction === null,
  ).length;
  const peopleToCreate = people.filter(
    (person) => person.resolutionAction === "CREATE",
  ).length;
  const peopleToReuse = people.filter(
    (person) => person.resolutionAction === "REUSE",
  ).length;

  return {
    event: input.event,
    datasetKey: ZERO3_ROSTER_SOURCE.datasetKey,
    sourceFile: ZERO3_ROSTER_SOURCE.fileName,
    sourceSheet: ZERO3_ROSTER_SOURCE.sheetName,
    contentHash: input.contentHash,
    environment: input.environment,
    alreadyApplied: Boolean(input.alreadyApplied),
    isDemoTarget: /demonstra|demo|teste|preview|homologa/i.test(
      input.event.name.toLocaleLowerCase("pt-BR"),
    ),
    people,
    teams,
    counts: {
      sourcePeople: people.length,
      sourceTeams: teams.length,
      peopleToCreate,
      peopleToReuse,
      unresolvedPeople,
      teamsToCreate,
      teamsToReuse,
      conflicts,
    },
    excludedSourceNotes: ZERO3_ROSTER_SOURCE.excludedSourceNotes.map(
      (note) => ({ cells: [...note.cells], text: note.text }),
    ),
  };
}

export function validateRosterManagementEdit(input: {
  athleteIds: string[];
  existingAthleteIds: Set<string>;
}): string | null {
  if (input.athleteIds.length < 1 || input.athleteIds.length > 2) {
    return "A equipe precisa ter um ou dois atletas.";
  }
  if (new Set(input.athleteIds).size !== input.athleteIds.length) {
    return "A equipe não pode repetir o mesmo atleta.";
  }
  if (input.athleteIds.some((id) => !input.existingAthleteIds.has(id))) {
    return "Selecione atletas cadastrados.";
  }
  return null;
}
