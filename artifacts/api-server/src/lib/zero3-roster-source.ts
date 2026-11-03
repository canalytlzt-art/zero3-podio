export type Zero3RosterSourceCategory = "RX" | "SCALE";

export type Zero3RosterSourceTeam = {
  code: string;
  category: Zero3RosterSourceCategory;
  sourceRow: number;
  athleteCells: [string, string];
  athleteNames: [string, string];
};

export const ZERO3_ROSTER_SOURCE = {
  datasetKey: "zero3-games-atletas-planilha-v1",
  fileName: "categorias e possibilidades games (1).xlsm",
  sheetName: "Atletas",
  excludedSourceNotes: [
    {
      cells: ["H6", "H7"],
      text: "Isabella cristina — devolver proporcional inscrição/camiseta",
      importedAsAthlete: false,
      createsRegistration: false,
      createsRefund: false,
    },
  ],
  teams: [
    { code: "RX-01", category: "RX", sourceRow: 3, athleteCells: ["B3", "C3"], athleteNames: ["Flavio Montiel", "Ana Lucena"] },
    { code: "RX-02", category: "RX", sourceRow: 4, athleteCells: ["B4", "C4"], athleteNames: ["Jorge Arthur", "Dayene Aline"] },
    { code: "RX-03", category: "RX", sourceRow: 5, athleteCells: ["B5", "C5"], athleteNames: ["Henrique Motoki", "Rita Hering"] },
    { code: "RX-04", category: "RX", sourceRow: 6, athleteCells: ["B6", "C6"], athleteNames: ["Georgton", "Karina"] },
    { code: "RX-05", category: "RX", sourceRow: 7, athleteCells: ["B7", "C7"], athleteNames: ["Pablo", "Letícia"] },
    { code: "RX-06", category: "RX", sourceRow: 8, athleteCells: ["B8", "C8"], athleteNames: ["Elton", "Sabrina Vaz"] },
    { code: "RX-07", category: "RX", sourceRow: 9, athleteCells: ["B9", "C9"], athleteNames: ["Guilherme Tadeu", "Gabriela Rubin"] },
    { code: "RX-08", category: "RX", sourceRow: 10, athleteCells: ["B10", "C10"], athleteNames: ["Lucas Yammamoto", "Fabi Moretz"] },
    { code: "RX-09", category: "RX", sourceRow: 11, athleteCells: ["B11", "C11"], athleteNames: ["Gustavo Bispo", "Sarah Viana"] },
    { code: "RX-10", category: "RX", sourceRow: 12, athleteCells: ["B12", "C12"], athleteNames: ["Pedro Henrique", "Maria Fernanda"] },
    { code: "RX-11", category: "RX", sourceRow: 13, athleteCells: ["B13", "C13"], athleteNames: ["Paulo Button", "Beatriz"] },
    { code: "RX-12", category: "RX", sourceRow: 14, athleteCells: ["B14", "C14"], athleteNames: ["Sebastian", "Luana C"] },
    { code: "RX-13", category: "RX", sourceRow: 15, athleteCells: ["B15", "C15"], athleteNames: ["Douglas blog", "Rafaella Artifon"] },
    { code: "RX-14", category: "RX", sourceRow: 16, athleteCells: ["B16", "C16"], athleteNames: ["Marcos Madeira", "Deza"] },
    { code: "RX-15", category: "RX", sourceRow: 17, athleteCells: ["B17", "C17"], athleteNames: ["Maira", "Gabriel"] },
    { code: "RX-16", category: "RX", sourceRow: 18, athleteCells: ["B18", "C18"], athleteNames: ["Myllena", "Hericlys"] },
    { code: "SCALE-01", category: "SCALE", sourceRow: 3, athleteCells: ["E3", "F3"], athleteNames: ["Gustavo Panda", "Marilia"] },
    { code: "SCALE-02", category: "SCALE", sourceRow: 4, athleteCells: ["E4", "F4"], athleteNames: ["Vinicius Falkowski", "Andrea"] },
    { code: "SCALE-03", category: "SCALE", sourceRow: 5, athleteCells: ["E5", "F5"], athleteNames: ["Anderson Porto", "Uli"] },
    { code: "SCALE-04", category: "SCALE", sourceRow: 6, athleteCells: ["E6", "F6"], athleteNames: ["Adriano", "Camila Vidal"] },
    { code: "SCALE-05", category: "SCALE", sourceRow: 7, athleteCells: ["E7", "F7"], athleteNames: ["Lucas Motti", "Jana"] },
    { code: "SCALE-06", category: "SCALE", sourceRow: 8, athleteCells: ["E8", "F8"], athleteNames: ["Jean", "Beatriz Couto"] },
    { code: "SCALE-07", category: "SCALE", sourceRow: 9, athleteCells: ["E9", "F9"], athleteNames: ["Jones Santos", "Barbara Arriveti"] },
    { code: "SCALE-08", category: "SCALE", sourceRow: 10, athleteCells: ["E10", "F10"], athleteNames: ["Iago Vaz", "Milena Muniz"] },
    { code: "SCALE-09", category: "SCALE", sourceRow: 11, athleteCells: ["E11", "F11"], athleteNames: ["Eduardo", "Jessica"] },
    { code: "SCALE-10", category: "SCALE", sourceRow: 12, athleteCells: ["E12", "F12"], athleteNames: ["Rodrigues Guedes", "Luisa"] },
    { code: "SCALE-11", category: "SCALE", sourceRow: 13, athleteCells: ["E13", "F13"], athleteNames: ["Henrique Arruik", "Dani Pardi"] },
    { code: "SCALE-12", category: "SCALE", sourceRow: 14, athleteCells: ["E14", "F14"], athleteNames: ["Rubens", "Mileine"] },
    { code: "SCALE-13", category: "SCALE", sourceRow: 15, athleteCells: ["E15", "F15"], athleteNames: ["Rafael Morganti", "Mariane Belo"] },
  ] satisfies Zero3RosterSourceTeam[],
} as const;

export type Zero3RosterPersonResolution =
  | { action: "CREATE" }
  | { action: "REUSE"; athleteId: string };

export type Zero3RosterExistingAthlete = {
  id: string;
  fullName: string;
};

export function normalizeRosterName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

export function isPossibleRosterIdentityMatch(sourceName: string, existingName: string): boolean {
  const source = normalizeRosterName(sourceName);
  const existing = normalizeRosterName(existingName);
  if (!source || !existing) return false;
  if (source === existing || source.includes(existing) || existing.includes(source)) return true;
  const sourceTokens = source.split(" ").filter((token) => token.length >= 4);
  const existingTokens = new Set(existing.split(" ").filter((token) => token.length >= 4));
  if (sourceTokens.some((token) => existingTokens.has(token))) return true;
  const longest = Math.max(source.length, existing.length);
  return longest >= 6 && 1 - editDistance(source, existing) / longest >= 0.84;
}

export function rosterSourcePeople() {
  return ZERO3_ROSTER_SOURCE.teams.flatMap((team) =>
    team.athleteNames.map((fullName, index) => ({
      sourceKey: `${team.code}:${index + 1}`,
      sourceCode: team.code,
      sourceCell: team.athleteCells[index],
      sourceRow: team.sourceRow,
      sourceCategory: team.category,
      fullName,
    })),
  );
}

export function findRosterIdentityCandidates(
  sourceName: string,
  existingAthletes: Zero3RosterExistingAthlete[],
): Zero3RosterExistingAthlete[] {
  return existingAthletes.filter((athlete) =>
    isPossibleRosterIdentityMatch(sourceName, athlete.fullName),
  );
}
