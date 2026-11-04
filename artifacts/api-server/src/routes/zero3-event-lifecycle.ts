import {
  DeleteZero3EventBody,
  DeleteZero3EventResponse,
  GetZero3EventParams,
  GetZero3EventResponse,
  GetZero3EventDeletionBackupParams,
  GetZero3EventDeletionBackupResponse,
  RestoreZero3EventBackupBody,
  RestoreZero3EventBackupResponse,
} from "@workspace/api-zod";
import {
  zero3ActiveHeatsTable,
  zero3AthletesTable,
  zero3EventDeletionAuditTable,
  zero3EventsTable,
  zero3HeatEntriesTable,
  zero3HeatsTable,
  zero3ImportBatchesTable,
  zero3ImportPeopleTable,
  zero3ImportTeamsTable,
  zero3PodiumsTable,
  zero3ProofsTable,
  zero3RegistrationsTable,
  zero3RegistrationAuditTable,
  zero3RegistrationMembersTable,
  zero3ResultRevisionsTable,
  zero3ResultsTable,
  zero3TimersTable,
  db,
} from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import {
  createZero3EventBackup,
  validateZero3EventBackup,
  type EventBackupRow,
  type Zero3EventBackup,
} from "../lib/zero3-event-archive";
import { requireZero3Roles } from "../lib/zero3-auth";

const router: IRouter = Router();
const ADMIN = ["ADMIN"] as const;
const EVENT_READ_ROLES = ["ADMIN", "JUIZ_CHEFE", "JUIZ"] as const;

type EventArchiveReader = Pick<typeof db, "select">;

class EventBackupChangedError extends Error {}

async function readEventBackup(
  eventId: string,
  database: EventArchiveReader = db,
): Promise<Zero3EventBackup | null> {
  const [event] = await database.select().from(zero3EventsTable).where(eq(zero3EventsTable.id, eventId)).limit(1);
  if (!event) return null;

  const [
    proofs, registrations, registrationMembers, registrationAudit, importBatches,
    heats, activeHeats, results, timers, podiumVersions,
  ] = await Promise.all([
    database.select().from(zero3ProofsTable).where(eq(zero3ProofsTable.eventId, eventId)),
    database.select().from(zero3RegistrationsTable).where(eq(zero3RegistrationsTable.eventId, eventId)),
    database.select().from(zero3RegistrationMembersTable).where(eq(zero3RegistrationMembersTable.eventId, eventId)),
    database.select().from(zero3RegistrationAuditTable).where(eq(zero3RegistrationAuditTable.eventId, eventId)),
    database.select().from(zero3ImportBatchesTable).where(eq(zero3ImportBatchesTable.eventId, eventId)),
    database.select().from(zero3HeatsTable).where(eq(zero3HeatsTable.eventId, eventId)),
    database.select().from(zero3ActiveHeatsTable).where(eq(zero3ActiveHeatsTable.eventId, eventId)),
    database.select().from(zero3ResultsTable).where(eq(zero3ResultsTable.eventId, eventId)),
    database.select().from(zero3TimersTable).where(eq(zero3TimersTable.eventId, eventId)),
    database.select().from(zero3PodiumsTable).where(eq(zero3PodiumsTable.eventId, eventId)),
  ]);
  const batchIds = importBatches.map((batch) => batch.id);
  const heatIds = heats.map((heat) => heat.id);
  const registrationIds = registrations.map((registration) => registration.id);
  const resultIds = results.map((result) => result.id);
  const [importPeople, importTeams, heatEntries, resultRevisions] = await Promise.all([
    batchIds.length
      ? database.select().from(zero3ImportPeopleTable).where(inArray(zero3ImportPeopleTable.batchId, batchIds))
      : Promise.resolve([]),
    batchIds.length
      ? database.select().from(zero3ImportTeamsTable).where(inArray(zero3ImportTeamsTable.batchId, batchIds))
      : Promise.resolve([]),
    heatIds.length || registrationIds.length
      ? database.select().from(zero3HeatEntriesTable).where(or(
          ...(heatIds.length ? [inArray(zero3HeatEntriesTable.heatId, heatIds)] : []),
          ...(registrationIds.length ? [inArray(zero3HeatEntriesTable.registrationId, registrationIds)] : []),
        )!)
      : Promise.resolve([]),
    resultIds.length
      ? database.select().from(zero3ResultRevisionsTable).where(inArray(zero3ResultRevisionsTable.resultId, resultIds))
      : Promise.resolve([]),
  ]);
  const athleteIds = [...new Set([
    ...registrationMembers.map((item) => item.athleteId),
    ...importPeople.map((item) => item.athleteId),
    ...registrations.flatMap((item) => item.athleteIds),
  ])];
  const athletes = athleteIds.length
    ? await database.select().from(zero3AthletesTable).where(inArray(zero3AthletesTable.id, athleteIds))
    : [];

  const data = {
    event: event as unknown as EventBackupRow,
    athletes: athletes as unknown as EventBackupRow[],
    proofs: proofs as unknown as EventBackupRow[],
    registrations: registrations as unknown as EventBackupRow[],
    registrationMembers: registrationMembers as unknown as EventBackupRow[],
    registrationAudit: registrationAudit as unknown as EventBackupRow[],
    importBatches: importBatches as unknown as EventBackupRow[],
    importPeople: importPeople as unknown as EventBackupRow[],
    importTeams: importTeams as unknown as EventBackupRow[],
    heats: heats as unknown as EventBackupRow[],
    heatEntries: heatEntries as unknown as EventBackupRow[],
    activeHeats: activeHeats as unknown as EventBackupRow[],
    results: results as unknown as EventBackupRow[],
    resultRevisions: resultRevisions as unknown as EventBackupRow[],
    timers: timers as unknown as EventBackupRow[],
    podiumVersions: podiumVersions as unknown as EventBackupRow[],
    heatRuns: [],
    heatPublications: [],
    batteries: [],
    batteryEntries: [],
    activeBatteries: [],
    batteryRuns: [],
    batteryPublications: [],
  };
  return createZero3EventBackup(event as unknown as EventBackupRow, data);
}

const JSON_COLUMNS = new Set([
  "categories", "athlete_ids", "before_state", "after_state", "source_notes",
  "source_cells", "source_athlete_names", "athlete_ids_snapshot",
  "athlete_names_snapshot", "registration_ids",
  "results_json", "leaderboards_json",
]);
const DATE_COLUMNS = new Set([
  "created_at", "updated_at", "assigned_at", "applied_at", "captured_at",
  "started_at", "preparation_ends_at", "published_at", "deleted_at",
]);

function fromDatabaseRow(row: EventBackupRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([column, raw]) => {
    const property = column.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());
    let value = raw;
    if (JSON_COLUMNS.has(column) && typeof value === "string") {
      value = JSON.parse(value);
    }
    if (DATE_COLUMNS.has(column) && typeof value === "string") value = new Date(value);
    if (column === "published" && typeof value === "number") value = value === 1;
    return [property, value];
  }));
}

function asInsert<T>(rows: EventBackupRow[]): T[] {
  return rows.map((row) => fromDatabaseRow(row) as T);
}

function restoreConflicts(backup: Zero3EventBackup, existingAthletes: Array<{id:string;fullName:string}>) {
  const current = new Map(existingAthletes.map((athlete) => [athlete.id, athlete.fullName]));
  return backup.data.athletes.some((athlete) =>
    current.has(String(athlete.id)) && current.get(String(athlete.id)) !== athlete.full_name);
}

router.get(
  "/zero3/events/:eventId",
  requireZero3Roles([...EVENT_READ_ROLES]),
  async (req, res): Promise<void> => {
    const params = GetZero3EventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ code: "EVENT_ID_INVALID", error: "ID de evento inválido." });
      return;
    }
    const [event] = await db.select().from(zero3EventsTable)
      .where(eq(zero3EventsTable.id, params.data.eventId)).limit(1);
    if (!event) {
      res.status(404).json({ code: "EVENT_NOT_FOUND", error: "Evento não encontrado." });
      return;
    }
    res.json(GetZero3EventResponse.parse(event));
  },
);

router.get(
  "/zero3/events/:eventId/deletion-backup",
  requireZero3Roles([...ADMIN]),
  async (req, res): Promise<void> => {
    const params = GetZero3EventDeletionBackupParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "ID de evento inválido." });
      return;
    }
    const backup = await readEventBackup(params.data.eventId);
    if (!backup) {
      res.status(404).json({ code: "EVENT_NOT_FOUND", error: "Evento não encontrado." });
      return;
    }
    res.json(GetZero3EventDeletionBackupResponse.parse(backup));
  },
);

router.delete(
  "/zero3/events/:eventId",
  requireZero3Roles([...ADMIN]),
  async (req, res): Promise<void> => {
    const params = GetZero3EventDeletionBackupParams.safeParse(req.params);
    const body = DeleteZero3EventBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "ID ou confirmação inválida." });
      return;
    }
    const backup = await readEventBackup(params.data.eventId);
    if (!backup) {
      res.status(404).json({ code: "EVENT_NOT_FOUND", error: "Evento não encontrado." });
      return;
    }
    if (body.data.confirmation !== `EXCLUIR ${backup.eventName}`) {
      res.status(409).json({ code: "EVENT_DELETE_CONFIRMATION_MISMATCH", error: "A confirmação não corresponde ao evento." });
      return;
    }
    if (body.data.backupDigest && body.data.backupDigest !== backup.digest) {
      res.status(409).json({ code: "EVENT_BACKUP_STALE", error: "Os dados mudaram. Atualize o evento antes de excluir." });
      return;
    }
    try {
      await db.transaction(async (tx) => {
        const freshBackup = await readEventBackup(params.data.eventId, tx);
        if (!freshBackup || freshBackup.digest !== backup.digest) throw new EventBackupChangedError();
        await tx.insert(zero3EventDeletionAuditTable).values({
          eventId: params.data.eventId,
          eventName: backup.eventName,
          actorId: getAuth(req).userId ?? "unknown",
          backupDigest: backup.digest,
          recordCounts: backup.counts,
        });
        await tx.delete(zero3RegistrationAuditTable).where(eq(zero3RegistrationAuditTable.eventId, params.data.eventId));
        await tx.delete(zero3ImportBatchesTable).where(eq(zero3ImportBatchesTable.eventId, params.data.eventId));
        await tx.delete(zero3ActiveHeatsTable).where(eq(zero3ActiveHeatsTable.eventId, params.data.eventId));
        await tx.delete(zero3TimersTable).where(eq(zero3TimersTable.eventId, params.data.eventId));
        await tx.delete(zero3ResultsTable).where(eq(zero3ResultsTable.eventId, params.data.eventId));
        await tx.delete(zero3HeatsTable).where(eq(zero3HeatsTable.eventId, params.data.eventId));
        await tx.delete(zero3ProofsTable).where(eq(zero3ProofsTable.eventId, params.data.eventId));
        await tx.delete(zero3RegistrationsTable).where(eq(zero3RegistrationsTable.eventId, params.data.eventId));
        const deleted = await tx.delete(zero3EventsTable)
          .where(eq(zero3EventsTable.id, params.data.eventId))
          .returning({ id: zero3EventsTable.id });
        if (deleted.length !== 1) throw new EventBackupChangedError();
      });
    } catch (error) {
      if (error instanceof EventBackupChangedError) {
        res.status(409).json({ code: "EVENT_BACKUP_STALE", error: "Os dados mudaram durante a exclusão. Atualize e revise o evento." });
        return;
      }
      throw error;
    }
    res.json(DeleteZero3EventResponse.parse({ eventId: params.data.eventId, deleted: true }));
  },
);

router.post(
  "/zero3/events/restore",
  requireZero3Roles([...ADMIN]),
  async (req, res): Promise<void> => {
    const parsed = RestoreZero3EventBackupBody.safeParse(req.body);
    const checked = await validateZero3EventBackup((req.body as { backup?: unknown } | undefined)?.backup);
    if (!parsed.success || !checked.ok) {
      res.status(400).json({
        code: "EVENT_BACKUP_INVALID",
        error: checked.ok ? "O arquivo de backup é inválido." : checked.reason,
      });
      return;
    }
    const backup = checked.backup;
    if ([
      backup.data.heatRuns, backup.data.heatPublications, backup.data.batteries,
      backup.data.batteryEntries, backup.data.activeBatteries, backup.data.batteryRuns,
      backup.data.batteryPublications,
    ].some((rows) => rows.length > 0)) {
      res.status(409).json({
        code: "EVENT_BACKUP_TARGET_UNSUPPORTED",
        error: "Este backup contém estruturas D1 que não existem no banco PostgreSQL deste ambiente.",
      });
      return;
    }
    const [existingEvent] = await db.select({ id: zero3EventsTable.id })
      .from(zero3EventsTable).where(eq(zero3EventsTable.id, backup.eventId)).limit(1);
    if (existingEvent) {
      res.status(409).json({ code: "EVENT_RESTORE_CONFLICT", error: "Já existe um evento com esse ID." });
      return;
    }
    const athleteIds = backup.data.athletes.map((athlete) => String(athlete.id));
    const existingAthletes = athleteIds.length
      ? await db.select({ id: zero3AthletesTable.id, fullName: zero3AthletesTable.fullName })
          .from(zero3AthletesTable).where(inArray(zero3AthletesTable.id, athleteIds))
      : [];
    if (restoreConflicts(backup, existingAthletes)) {
      res.status(409).json({
        code: "ATHLETE_RESTORE_CONFLICT",
        error: "Um atleta global com o mesmo ID tem dados diferentes. Nenhum registro foi restaurado.",
      });
      return;
    }
    const existingAthleteIds = new Set(existingAthletes.map((athlete) => athlete.id));
    const missingAthletes = backup.data.athletes.filter((athlete) => !existingAthleteIds.has(String(athlete.id)));

    await db.transaction(async (tx) => {
      if (missingAthletes.length) {
        await tx.insert(zero3AthletesTable).values(asInsert<typeof zero3AthletesTable.$inferInsert>(missingAthletes));
      }
      await tx.insert(zero3EventsTable).values(asInsert<typeof zero3EventsTable.$inferInsert>([backup.data.event])[0]);
      const insertRows = async <T extends Parameters<typeof tx.insert>[0]>(
        table: T,
        rows: EventBackupRow[],
      ) => {
        if (rows.length) await tx.insert(table as never).values(asInsert<never>(rows) as never);
      };
      await insertRows(zero3ProofsTable, backup.data.proofs);
      await insertRows(zero3RegistrationsTable, backup.data.registrations);
      await insertRows(zero3RegistrationMembersTable, backup.data.registrationMembers);
      await insertRows(zero3RegistrationAuditTable, backup.data.registrationAudit);
      await insertRows(zero3ImportBatchesTable, backup.data.importBatches);
      await insertRows(zero3ImportPeopleTable, backup.data.importPeople);
      await insertRows(zero3ImportTeamsTable, backup.data.importTeams);
      await insertRows(zero3HeatsTable, backup.data.heats);
      await insertRows(zero3HeatEntriesTable, backup.data.heatEntries);
      await insertRows(zero3ActiveHeatsTable, backup.data.activeHeats);
      await insertRows(zero3ResultsTable, backup.data.results);
      await insertRows(zero3ResultRevisionsTable, backup.data.resultRevisions);
      await insertRows(zero3TimersTable, backup.data.timers);
      await insertRows(zero3PodiumsTable, backup.data.podiumVersions);
    });
    res.status(201).json(RestoreZero3EventBackupResponse.parse({ eventId: backup.eventId, restored: true }));
  },
);

export default router;
