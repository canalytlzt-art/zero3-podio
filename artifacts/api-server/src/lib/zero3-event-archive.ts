export const ZERO3_EVENT_BACKUP_FORMAT = "zero3-event-backup";
export const ZERO3_EVENT_BACKUP_VERSION = 8;

const ZERO3_EVENT_BACKUP_COLLECTIONS_V1 = [
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
const ZERO3_EVENT_BACKUP_COLLECTIONS_V2 = [
  ...ZERO3_EVENT_BACKUP_COLLECTIONS_V1,
  "heatRuns",
] as const;
const ZERO3_EVENT_BACKUP_COLLECTIONS_V3 = [
  ...ZERO3_EVENT_BACKUP_COLLECTIONS_V2,
  "heatPublications",
] as const;
const ZERO3_EVENT_BACKUP_COLLECTIONS_V4 = [
  ...ZERO3_EVENT_BACKUP_COLLECTIONS_V3,
  "batteries",
  "batteryEntries",
  "activeBatteries",
  "batteryRuns",
  "batteryPublications",
] as const;
const ZERO3_EVENT_BACKUP_COLLECTIONS_V5 = [
  ...ZERO3_EVENT_BACKUP_COLLECTIONS_V4,
  "rankingPublications",
] as const;
const ZERO3_EVENT_BACKUP_COLLECTIONS_V6 = [
  ...ZERO3_EVENT_BACKUP_COLLECTIONS_V5,
  "batteryTimeCapAudit",
] as const;
const ZERO3_EVENT_BACKUP_COLLECTIONS_V7 = ZERO3_EVENT_BACKUP_COLLECTIONS_V6;
const ZERO3_EVENT_BACKUP_COLLECTIONS_V8 = [
  ...ZERO3_EVENT_BACKUP_COLLECTIONS_V7,
  "batteryDurationAudit",
] as const;
export const ZERO3_EVENT_BACKUP_COLLECTIONS = ZERO3_EVENT_BACKUP_COLLECTIONS_V8;

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
  "results_json",
  "leaderboards_json",
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

function normalizeCollections(data: Record<string, unknown>, collections: readonly string[]) {
  const normalized: Record<string, unknown> = {
    event: toDatabaseRow(data.event as EventBackupRow),
  };
  for (const collection of collections) {
    normalized[collection] = ((data[collection] as EventBackupRow[] | undefined) ?? []).map(toDatabaseRow);
  }

  for (const collection of collections) {
    (normalized[collection] as EventBackupRow[]).sort((left, right) =>
      stableZero3Json(left).localeCompare(stableZero3Json(right)),
    );
  }
  return normalized;
}

export function normalizeZero3BackupData(data: Zero3EventBackupData): Zero3EventBackupData {
  return normalizeCollections(data as unknown as Record<string, unknown>, ZERO3_EVENT_BACKUP_COLLECTIONS) as Zero3EventBackupData;
}

function digestPayload(backup: {format:string;version:number;eventId:string;eventName:string;counts:Record<string,number>;data:unknown}): string {
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
  const candidate = value as Partial<Zero3EventBackup> & {version?:number;data?:Record<string,unknown>};
  const version = (value as {version?:unknown}).version;
  const versionNumber = version === 1 || version === 2 || version === 3 ||
    version === 4 || version === 5 || version === 6 || version === 7 ||
    version === ZERO3_EVENT_BACKUP_VERSION ? version : null;
  if (
    candidate.format !== ZERO3_EVENT_BACKUP_FORMAT ||
    versionNumber === null ||
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
  const sourceCollections = versionNumber === 1
    ? ZERO3_EVENT_BACKUP_COLLECTIONS_V1
    : versionNumber === 2
      ? ZERO3_EVENT_BACKUP_COLLECTIONS_V2
      : versionNumber === 3
        ? ZERO3_EVENT_BACKUP_COLLECTIONS_V3
        : versionNumber === 4
          ? ZERO3_EVENT_BACKUP_COLLECTIONS_V4
          : versionNumber === 5
            ? ZERO3_EVENT_BACKUP_COLLECTIONS_V5
            : versionNumber === 8
              ? ZERO3_EVENT_BACKUP_COLLECTIONS_V8
              : ZERO3_EVENT_BACKUP_COLLECTIONS_V7;
  const data = candidate.data;
  if (!data.event || typeof data.event !== "object" ||
      String((data.event as Record<string,unknown>).id) !== candidate.eventId ||
      String((data.event as Record<string,unknown>).name) !== candidate.eventName ||
      sourceCollections.some((collection) => !Array.isArray(data[collection]))) {
    return { ok: false, reason: "O backup está incompleto ou foi alterado." };
  }
  const normalizedSource = normalizeCollections(data,sourceCollections);
  const sourceCounts = {
    event: 1,
    ...Object.fromEntries(
      sourceCollections.map((collection) => [
        collection,
        (normalizedSource[collection] as EventBackupRow[]).length,
      ]),
    ),
  };
  if (stableZero3Json(candidate.counts) !== stableZero3Json(sourceCounts)) {
    return { ok: false, reason: "As contagens do backup não correspondem aos registros." };
  }
  const sourceDigest = await sha256Hex(digestPayload({
    format: candidate.format,
    version: versionNumber,
    eventId: candidate.eventId,
    eventName: candidate.eventName,
    counts: sourceCounts,
    data: normalizedSource,
  }));
  if (sourceDigest !== candidate.digest) {
    return { ok: false, reason: "A verificação de integridade do backup falhou." };
  }
  const normalizedData = normalizeCollections({
    ...normalizedSource,
    heats: (normalizedSource.heats as EventBackupRow[]).map((heat) => ({
      ...heat,
      proof_id: heat.proof_id ?? null,
      battery_order: heat.battery_order ?? heat.order ?? null,
    })),
    heatRuns: versionNumber >= 2
      ? normalizedSource.heatRuns
      : [],
    heatPublications: versionNumber >= 3
      ? normalizedSource.heatPublications
      : [],
    batteries: versionNumber >= 6
      ? normalizedSource.batteries
      : versionNumber >= 4
        ? (normalizedSource.batteries as EventBackupRow[]).map((battery) => ({
          ...battery,
          operational_finalized_at: null,
          operational_finalized_by: null,
        }))
        : [],
    batteryEntries: versionNumber >= 4 ? normalizedSource.batteryEntries : [],
    activeBatteries: versionNumber >= 4 ? normalizedSource.activeBatteries : [],
    batteryRuns: versionNumber >= 4 ? normalizedSource.batteryRuns : [],
    batteryPublications: versionNumber >= 4 ? normalizedSource.batteryPublications : [],
    rankingPublications: versionNumber >= 5 ? normalizedSource.rankingPublications : [],
    batteryTimeCapAudit: versionNumber >= 7 ? normalizedSource.batteryTimeCapAudit : [],
    batteryDurationAudit: versionNumber >= 8
      ? (normalizedSource.batteryDurationAudit as EventBackupRow[]).map((row) => ({
        ...row,
        change_type: row.change_type ?? "SET",
        additional_ms: row.additional_ms ?? 0,
      }))
      : [],
  },ZERO3_EVENT_BACKUP_COLLECTIONS) as unknown as Zero3EventBackupData;
  const counts = {
    event:1,
    ...Object.fromEntries(ZERO3_EVENT_BACKUP_COLLECTIONS.map((collection)=>[
      collection,normalizedData[collection].length,
    ])),
  };
  const digest = await sha256Hex(digestPayload({
    format:ZERO3_EVENT_BACKUP_FORMAT,
    version:ZERO3_EVENT_BACKUP_VERSION,
    eventId:candidate.eventId,
    eventName:candidate.eventName,
    counts,
    data:normalizedData,
  }));
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
