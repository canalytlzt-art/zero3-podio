export const ZERO3_TEAM_NAME_MAX_LENGTH = 40;

const unsafeTeamNameCharacters = /[<>\u0000-\u001f\u007f-\u009f]/u;

export type TeamNameParseResult =
  | { success: true; value: string | null }
  | { success: false; error: string };

export function parseZero3TeamName(value: unknown): TeamNameParseResult {
  if (value == null) return { success: true, value: null };
  if (typeof value !== "string") {
    return { success: false, error: "O nome da equipe deve ser um texto." };
  }
  if (unsafeTeamNameCharacters.test(value)) {
    return {
      success: false,
      error: "O nome da equipe não pode conter <, > ou caracteres de controle.",
    };
  }

  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length > ZERO3_TEAM_NAME_MAX_LENGTH) {
    return {
      success: false,
      error: `O nome da equipe deve ter no máximo ${ZERO3_TEAM_NAME_MAX_LENGTH} caracteres.`,
    };
  }
  return { success: true, value: normalized || null };
}

export function resolveZero3DisplayTeamName(
  currentRegistrationName: string | null | undefined,
  historicalSnapshotName: string | null | undefined,
  registrationExists: boolean,
): string | null {
  if (registrationExists) return currentRegistrationName ?? null;
  return historicalSnapshotName ?? null;
}
