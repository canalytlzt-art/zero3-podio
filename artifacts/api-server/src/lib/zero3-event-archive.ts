export const ZERO3_EVENT_BACKUP_FORMAT = "zero3-event-backup";
export const ZERO3_EVENT_BACKUP_VERSION = 1;

export const ZERO3_EVENT_BACKUP_COLLECTIONS = [
  "athletes",
  "proofs",
  "registrations",
  "registrationMembers",
  "registrationAudit",
  "importBatches",
  "importPeople",
  "importTeams",
  "heats",
  "heatEntries",
  "activeHeats",
  "results",
  "resultRevisions",
  "timers",
  "podiumVersions",
] as const;

export type EventBackupRow = Record<string, unknown>;
export type Zero3EventBackupData = {
  event: EventBackupRow;
} & Record<(typeof ZERO3_EVENT_BACKUP_COLLECTIONS)[number], EventBackupRow[]>;

export type Zero3EventBackup = {
  format: typeof ZERO3_EVENT_BACKUP_FORMAT;
  version: typeof ZERO3_EVENT_BACKUP_VERSION;
  eventId: string;
  eventName: string;
  exportedAt: string;
  counts: Record<string, number>;
  data: Zero3EventBackupData;
  digest: string;
};

const JSON_COLUMN_NAMES = new Set([
  "categories",
  "athlete_ids",
  "before_state",
  "after_state",
  "source_notes",
  "source_cells",
  "source_athlete_names",
  "athlete_ids_snapshot",
  "athlete_names_snapshot",
  "registration_ids",
]);

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableZero3Json(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function toDatabaseRow(row: EventBackupRow): EventBackupRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    let normalized = stableValue(value);
    if (JSON_COLUMN_NAMES.has(column) && typeof normalized === "string") {
      try { normalized = JSON.parse(normalized); } catch { /* validation catches malformed data later */ }
    }
    if (column === "published" && typeof normalized === "boolean") {
      normalized = normalized ? 1 : 0;
    }
    return [column, normalized];
  }));
}

export function normalizeZero3BackupData(data: Zero3EventBackupData): Zero3EventBackupData {
  const normalized = {
    event: toDatabaseRow(data.event),
    ...Object.fromEntries(
      ZERO3_EVENT_BACKUP_COLLECTIONS.map((collection) => [
        collection,
        data[collection].map(toDatabaseRow),
      ]),
    ),
  } as Zero3EventBackupData;

  for (const collection of ZERO3_EVENT_BACKUP_COLLECTIONS) {
    normalized[collection].sort((left, right) =>
      stableZero3Json(left).localeCompare(stableZero3Json(right)),
    );
  }
  return normalized;
}

function digestPayload(backup: Omit<Zero3EventBackup, "digest" | "exportedAt">): string {
  return stableZero3Json(backup);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createZero3EventBackup(
  event: EventBackupRow,
  data: Zero3EventBackupData,
  exportedAt = new Date().toISOString(),
): Promise<Zero3EventBackup> {
  const normalizedData = normalizeZero3BackupData(data);
  normalizedData.event = toDatabaseRow(event);
  const counts = {
    event: 1,
    ...Object.fromEntries(
      ZERO3_EVENT_BACKUP_COLLECTIONS.map((collection) => [
        collection,
        normalizedData[collection].length,
      ]),
    ),
  };
  const base = {
    format: ZERO3_EVENT_BACKUP_FORMAT,
    version: ZERO3_EVENT_BACKUP_VERSION,
    eventId: String(normalizedData.event.id),
    eventName: String(normalizedData.event.name),
    exportedAt,
    counts,
    data: normalizedData,
  } as const;
  // The export timestamp is intentionally outside the digest so a fresh export
  // of unchanged data remains valid for the confirmed deletion.
  const digest = await sha256Hex(digestPayload({
    format: base.format,
    version: base.version,
    eventId: base.eventId,
    eventName: base.eventName,
    counts: base.counts,
    data: base.data,
  }));
  return { ...base, digest };
}

export async function validateZero3EventBackup(
  value: unknown,
): Promise<{ ok: true; backup: Zero3EventBackup } | { ok: false; reason: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "O arquivo não contém um objeto de backup." };
  }
  const candidate = value as Partial<Zero3EventBackup>;
  if (
    candidate.format !== ZERO3_EVENT_BACKUP_FORMAT ||
    candidate.version !== ZERO3_EVENT_BACKUP_VERSION ||
    typeof candidate.eventId !== "string" ||
    typeof candidate.eventName !== "string" ||
    typeof candidate.exportedAt !== "string" ||
    typeof candidate.digest !== "string" ||
    !candidate.data ||
    typeof candidate.data !== "object" ||
    !candidate.counts ||
    typeof candidate.counts !== "object"
  ) {
    return { ok: false, reason: "Formato de backup ZERO3 não reconhecido." };
  }
  const data = candidate.data as Zero3EventBackupData;
  if (!data.event || typeof data.event !== "object" ||
      String(data.event.id) !== candidate.eventId ||
      String(data.event.name) !== candidate.eventName ||
      ZERO3_EVENT_BACKUP_COLLECTIONS.some((collection) => !Array.isArray(data[collection]))) {
    return { ok: false, reason: "O backup está incompleto ou foi alterado." };
  }
  const normalizedData = normalizeZero3BackupData(data);
  const counts = {
    event: 1,
    ...Object.fromEntries(
      ZERO3_EVENT_BACKUP_COLLECTIONS.map((collection) => [
        collection,
        normalizedData[collection].length,
      ]),
    ),
  };
  if (stableZero3Json(candidate.counts) !== stableZero3Json(counts)) {
    return { ok: false, reason: "As contagens do backup não correspondem aos registros." };
  }
  const digest = await sha256Hex(digestPayload({
    format: candidate.format,
    version: candidate.version,
    eventId: candidate.eventId,
    eventName: candidate.eventName,
    counts,
    data: normalizedData,
  }));
  if (digest !== candidate.digest) {
    return { ok: false, reason: "A verificação de integridade do backup falhou." };
  }
  return {
    ok: true,
    backup: {
      format: ZERO3_EVENT_BACKUP_FORMAT,
      version: ZERO3_EVENT_BACKUP_VERSION,
      eventId: candidate.eventId,
      eventName: candidate.eventName,
      exportedAt: candidate.exportedAt,
      counts,
      data: normalizedData,
      digest,
    },
  };
}
