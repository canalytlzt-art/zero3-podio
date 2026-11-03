import {
  ApplyZero3RosterImportBody,
  ApplyZero3RosterImportParams,
  ApplyZero3RosterImportResponse,
  CancelZero3RegistrationBody,
  CancelZero3RegistrationParams,
  CancelZero3RegistrationResponse,
  DeleteZero3RegistrationParams,
  DeleteZero3RegistrationResponse,
  GetZero3RosterManagementParams,
  GetZero3RosterManagementResponse,
  PreviewZero3RosterImportBody,
  PreviewZero3RosterImportParams,
  PreviewZero3RosterImportResponse,
  UpdateZero3RosterManagementBody,
  UpdateZero3RosterManagementParams,
  UpdateZero3RosterManagementResponse,
} from "@workspace/api-zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  zero3AthletesTable,
  zero3EventsTable,
  zero3ImportBatchesTable,
  zero3ImportPeopleTable,
  zero3ImportTeamsTable,
  zero3HeatEntriesTable,
  zero3PodiumsTable,
  zero3RegistrationAuditTable,
  zero3RegistrationMembersTable,
  zero3RegistrationsTable,
  zero3ResultsTable,
} from "@workspace/db";
import { requireZero3Roles, type Zero3Request } from "../lib/zero3-auth";
import { writeApiFailure } from "../lib/api-errors";
import {
  buildRosterImportPlan,
  rosterSourceContentHash,
  validateRosterManagementEdit,
  type RosterImportRegistration,
} from "../lib/zero3-roster-import";
import { rosterSourcePeople, ZERO3_ROSTER_SOURCE } from "../lib/zero3-roster-source";

const router: IRouter = Router();
const ADMIN_ONLY = ["ADMIN"] as const;
const CONFIRMATION_STATUSES = new Set(["INTERESTED", "PENDING", "CONFIRMED", "CANCELLED"]);
const PAYMENT_STATUSES = new Set(["UNVERIFIED", "PENDING", "PAID", "NOT_PAID"]);

class RosterConflictError extends Error {}
class RosterInputError extends Error {}

function requestEnvironment(req: Request): string {
  const hostname = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (hostname.endsWith(".workers.dev")) return "Cloudflare Worker / HYPERDRIVE";
  if (hostname.endsWith(".replit.dev") || process.env.REPL_ID) {
    return "Replit Development";
  }
  if (hostname === "localhost" || hostname.startsWith("127.0.0.1")) {
    return "Desenvolvimento local";
  }
  return "Ambiente atual — confirmar destino do banco";
}

function canApplyRosterImport(req: Request): boolean {
  const hostname = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (hostname.endsWith(".workers.dev") || process.env.NODE_ENV === "production") {
    return false;
  }
  return Boolean(process.env.REPL_ID) ||
    process.env.ZERO3_ROSTER_IMPORT_ENV === "test" ||
    process.env.NODE_ENV !== "production";
}

function writeRosterError(
  req: Request,
  res: Response,
  error: unknown,
  fallback: string,
): void {
  if (error instanceof RosterConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof RosterInputError) {
    res.status(400).json({ error: error.message });
    return;
  }
  writeApiFailure(req, res, error, fallback);
}

async function loadRosterPlan(input: {
  eventId: string;
  scaleTargetCategory: "SC" | "SCALE";
  resolutions: Array<{ sourceKey: string; action: "CREATE" | "REUSE"; athleteId: string | null }>;
  environment: string;
}) {
  const [event] = await db
    .select()
    .from(zero3EventsTable)
    .where(eq(zero3EventsTable.id, input.eventId))
    .limit(1);
  if (!event) throw new RosterInputError("A edição selecionada não existe.");

  const [existingAthletes, existingRegistrations, batches] = await Promise.all([
    db.select().from(zero3AthletesTable),
    db.select().from(zero3RegistrationsTable).where(eq(zero3RegistrationsTable.eventId, input.eventId)),
    db.select().from(zero3ImportBatchesTable).where(
      and(
        eq(zero3ImportBatchesTable.eventId, input.eventId),
        eq(zero3ImportBatchesTable.datasetKey, ZERO3_ROSTER_SOURCE.datasetKey),
      ),
    ),
  ]);
  const contentHash = await rosterSourceContentHash();
  const batch = batches[0];
  if (batch && batch.contentHash !== contentHash) {
    throw new RosterConflictError(
      "O lote já aplicado tem conteúdo de origem diferente. Nenhum dado foi alterado.",
    );
  }

  const [appliedPeople, appliedTeams] = batch
    ? await Promise.all([
        db.select().from(zero3ImportPeopleTable).where(eq(zero3ImportPeopleTable.batchId, batch.id)),
        db.select().from(zero3ImportTeamsTable).where(eq(zero3ImportTeamsTable.batchId, batch.id)),
      ])
    : [[], []];
  const appliedPeopleMap = new Map(appliedPeople.map((row) => [row.sourceKey, row.athleteId]));
  const appliedTeamMap = new Map(appliedTeams.map((row) => [row.sourceCode, row.registrationId]));

  return buildRosterImportPlan({
    event: {
      id: event.id,
      name: event.name,
      proofName: event.proofName,
      status: event.status as "PLANNED" | "ACTIVE" | "FINISHED",
      preparationSeconds: event.preparationSeconds,
      createdAt: event.createdAt,
    },
    environment: input.environment,
    existingAthletes,
    existingRegistrations: existingRegistrations.map(
      (registration): RosterImportRegistration => ({
        id: registration.id,
        category: registration.category,
        athleteIds: registration.athleteIds,
        confirmationStatus: registration.confirmationStatus,
        paymentStatus: registration.paymentStatus,
      }),
    ),
    resolutions: input.resolutions,
    scaleTargetCategory: input.scaleTargetCategory,
    contentHash,
    alreadyApplied: Boolean(batch),
    appliedPeople: appliedPeopleMap,
    appliedRegistrations: appliedTeamMap,
  });
}

async function rosterManagementRows(eventId: string) {
  const registrations = await db
    .select()
    .from(zero3RegistrationsTable)
    .where(eq(zero3RegistrationsTable.eventId, eventId));
  if (registrations.length === 0) return [];

  const registrationIds = registrations.map((registration) => registration.id);
  const athleteIds = [...new Set(registrations.flatMap((registration) => registration.athleteIds))];
  const [athletes, results, importTeams, audits] = await Promise.all([
    athleteIds.length
      ? db.select().from(zero3AthletesTable).where(inArray(zero3AthletesTable.id, athleteIds))
      : Promise.resolve([]),
    db.select().from(zero3ResultsTable).where(inArray(zero3ResultsTable.registrationId, registrationIds)),
    db.select().from(zero3ImportTeamsTable).where(inArray(zero3ImportTeamsTable.registrationId, registrationIds)),
    db.select().from(zero3RegistrationAuditTable).where(inArray(zero3RegistrationAuditTable.registrationId, registrationIds)),
  ]);
  const athleteNameById = new Map(athletes.map((athlete) => [athlete.id, athlete.fullName]));
  const resultCountByRegistration = new Map<string, number>();
  for (const result of results) {
    resultCountByRegistration.set(
      result.registrationId,
      (resultCountByRegistration.get(result.registrationId) ?? 0) + 1,
    );
  }
  const sourceCodesByRegistration = new Map<string, string[]>();
  const auditByRegistration = new Map<string, typeof audits>();
  for (const source of importTeams) {
    sourceCodesByRegistration.set(source.registrationId, [
      ...(sourceCodesByRegistration.get(source.registrationId) ?? []),
      source.sourceCode,
    ]);
  }
  for (const audit of audits) {
    const existing = auditByRegistration.get(audit.registrationId) ?? [];
    existing.push(audit);
    auditByRegistration.set(audit.registrationId, existing);
  }

  return registrations.map((registration) => ({
    id: registration.id,
    eventId: registration.eventId,
    category: registration.category,
    teamName: registration.teamName,
    athleteIds: registration.athleteIds,
    athleteNames: registration.athleteIds.map((id) => athleteNameById.get(id) ?? "Atleta não encontrado"),
    confirmationStatus: registration.confirmationStatus,
    paymentStatus: registration.paymentStatus,
    resultCount: resultCountByRegistration.get(registration.id) ?? 0,
    sourceCodes: sourceCodesByRegistration.get(registration.id) ?? [],
    createdAt: registration.createdAt,
    audit: (auditByRegistration.get(registration.id) ?? [])
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((entry) => ({
        id: entry.id,
        actorId: entry.actorId,
        reason: entry.reason,
        beforeState: entry.beforeState as Record<string, unknown>,
        afterState: entry.afterState as Record<string, unknown>,
        createdAt: entry.createdAt,
      })),
  }));
}

router.get(
  "/zero3/events/:eventId/roster-management",
  requireZero3Roles([...ADMIN_ONLY]),
  async (req, res): Promise<void> => {
    const params = GetZero3RosterManagementParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      res.json(GetZero3RosterManagementResponse.parse(
        await rosterManagementRows(params.data.eventId),
      ));
    } catch (error) {
      writeRosterError(req, res, error, "Não foi possível consultar as equipes.");
    }
  },
);

router.put(
  "/zero3/events/:eventId/roster-management",
  requireZero3Roles([...ADMIN_ONLY]),
  async (req, res): Promise<void> => {
    const params = UpdateZero3RosterManagementParams.safeParse(req.params);
    const body = UpdateZero3RosterManagementBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos.",
      });
      return;
    }
    try {
      const edits = body.data.edits;
      const editIds = edits.map((edit) => edit.registrationId);
      if (new Set(editIds).size !== editIds.length) {
        throw new RosterInputError("A mesma equipe não pode aparecer duas vezes na alteração.");
      }
      for (const edit of edits) {
        if (!CONFIRMATION_STATUSES.has(edit.confirmationStatus) ||
            !PAYMENT_STATUSES.has(edit.paymentStatus)) {
          throw new RosterInputError("Situação de inscrição ou pagamento inválida.");
        }
        const invalid = validateRosterManagementEdit({
          athleteIds: edit.athleteIds,
          existingAthleteIds: new Set(
            (await db.select({ id: zero3AthletesTable.id })
              .from(zero3AthletesTable)).map((athlete) => athlete.id),
          ),
        });
        if (invalid) throw new RosterInputError(invalid);
      }

      const actorId = getAuth(req).userId;
      if (!actorId) {
        throw new RosterInputError("A sessão não informou o ID verificado do administrador.");
      }
      await db.transaction(async (tx) => {
        const current = await tx
          .select()
          .from(zero3RegistrationsTable)
          .where(eq(zero3RegistrationsTable.eventId, params.data.eventId));
        const [event] = await tx
          .select({ categories: zero3EventsTable.categories })
          .from(zero3EventsTable)
          .where(eq(zero3EventsTable.id, params.data.eventId))
          .for("update")
          .limit(1);
        if (!event) throw new RosterInputError("Evento não encontrado.");
        if (edits.some((edit) => !event.categories.includes(edit.category))) {
          throw new RosterInputError("A categoria não está habilitada para este evento.");
        }
        const currentById = new Map(current.map((registration) => [registration.id, registration]));
        const editedRegistrations = edits.map((edit) => {
          const registration = currentById.get(edit.registrationId);
          if (!registration) throw new RosterInputError("Uma equipe não pertence à edição selecionada.");
          return { edit, registration };
        });
        const editedIds = new Set(editIds);
        const editedAthleteIds = edits.flatMap((edit) => edit.athleteIds);
        if (new Set(editedAthleteIds).size !== editedAthleteIds.length) {
          throw new RosterConflictError("Uma pessoa não pode ocupar duas vagas após esta alteração.");
        }
        const occupiedByOtherRegistration = current
          .filter((registration) => !editedIds.has(registration.id))
          .flatMap((registration) => registration.athleteIds);
        if (editedAthleteIds.some((id) => occupiedByOtherRegistration.includes(id))) {
          throw new RosterConflictError("Um dos atletas já está inscrito em outra equipe desta edição.");
        }

        const resultRows = await tx
          .select({ registrationId: zero3ResultsTable.registrationId })
          .from(zero3ResultsTable)
          .where(inArray(zero3ResultsTable.registrationId, editIds));
        const resultsByRegistration = new Map<string, number>();
        for (const row of resultRows) {
          resultsByRegistration.set(row.registrationId, (resultsByRegistration.get(row.registrationId) ?? 0) + 1);
        }
        const changesWithResults = editedRegistrations.filter(({ edit, registration }) => {
          const rosterChanged =
            edit.category !== registration.category ||
            edit.athleteIds.join(":") !== registration.athleteIds.join(":");
          return rosterChanged && (resultsByRegistration.get(registration.id) ?? 0) > 0;
        });
        if (changesWithResults.length > 0 && !body.data.confirmHistoryImpact) {
          const count = changesWithResults.reduce(
            (sum, item) => sum + (resultsByRegistration.get(item.registration.id) ?? 0),
            0,
          );
          throw new RosterConflictError(
            `Há ${count} resultado(s) ligado(s) a esta composição. Revise o impacto e confirme explicitamente; o registro anterior será preservado no histórico.`,
          );
        }

        await tx.delete(zero3RegistrationMembersTable)
          .where(inArray(zero3RegistrationMembersTable.registrationId, editIds));
        for (const { edit, registration } of editedRegistrations) {
          const beforeState = {
            teamName: registration.teamName,
            category: registration.category,
            athleteIds: registration.athleteIds,
            confirmationStatus: registration.confirmationStatus,
            paymentStatus: registration.paymentStatus,
          };
          const afterState = {
            teamName: edit.teamName === undefined ? registration.teamName : edit.teamName,
            category: edit.category,
            athleteIds: edit.athleteIds,
            confirmationStatus: edit.confirmationStatus,
            paymentStatus: edit.paymentStatus,
          };
          await tx
            .update(zero3RegistrationsTable)
            .set(afterState)
            .where(eq(zero3RegistrationsTable.id, registration.id));
          await tx.insert(zero3RegistrationMembersTable).values(
            edit.athleteIds.map((athleteId, index) => ({
              registrationId: registration.id,
              eventId: params.data.eventId,
              athleteId,
              slot: index + 1,
            })),
          );
          await tx.insert(zero3RegistrationAuditTable).values({
            eventId: params.data.eventId,
            registrationId: registration.id,
            actorId,
            reason: edit.reason,
            beforeState,
            afterState,
          });
        }
      });
      res.json(UpdateZero3RosterManagementResponse.parse({
        registrations: await rosterManagementRows(params.data.eventId),
      }));
    } catch (error) {
      writeRosterError(req, res, error, "Não foi possível salvar as alterações das equipes.");
    }
  },
);

router.delete(
  "/zero3/events/:eventId/registrations/:registrationId",
  requireZero3Roles([...ADMIN_ONLY]),
  async (req, res): Promise<void> => {
    const params = DeleteZero3RegistrationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [registration] = await tx
          .select()
          .from(zero3RegistrationsTable)
          .where(and(
            eq(zero3RegistrationsTable.id, params.data.registrationId),
            eq(zero3RegistrationsTable.eventId, params.data.eventId),
          ))
          .for("update")
          .limit(1);
        if (!registration) return { kind: "missing" as const };

        const [results, heatEntries, audits, importTeams, podiums, publishedPodiums] = await Promise.all([
          tx.select({ id: zero3ResultsTable.id }).from(zero3ResultsTable)
            .where(eq(zero3ResultsTable.registrationId, registration.id)),
          tx.select({ registrationId: zero3HeatEntriesTable.registrationId }).from(zero3HeatEntriesTable)
            .where(eq(zero3HeatEntriesTable.registrationId, registration.id)),
          tx.select({ id: zero3RegistrationAuditTable.id }).from(zero3RegistrationAuditTable)
            .where(eq(zero3RegistrationAuditTable.registrationId, registration.id)),
          tx.select({ id: zero3ImportTeamsTable.id }).from(zero3ImportTeamsTable)
            .where(eq(zero3ImportTeamsTable.registrationId, registration.id)),
          tx.select({ eventId: zero3PodiumsTable.eventId }).from(zero3PodiumsTable)
            .where(and(
              eq(zero3PodiumsTable.eventId, registration.eventId),
              sql`${zero3PodiumsTable.registrationIds} @> jsonb_build_array(${registration.id})`,
            )),
          tx.select({ eventId: zero3PodiumsTable.eventId }).from(zero3PodiumsTable)
            .where(and(
              eq(zero3PodiumsTable.eventId, registration.eventId),
              eq(zero3PodiumsTable.published, true),
              sql`${zero3PodiumsTable.registrationIds} @> jsonb_build_array(${registration.id})`,
            )),
        ]);
        const hasHistory = results.length + heatEntries.length + audits.length +
          importTeams.length + podiums.length > 0;
        if (hasHistory) {
          return { kind: "history" as const, canCancel: publishedPodiums.length === 0 };
        }
        const [deleted] = await tx.delete(zero3RegistrationsTable)
          .where(and(
            eq(zero3RegistrationsTable.id, registration.id),
            eq(zero3RegistrationsTable.eventId, registration.eventId),
          ))
          .returning({ id: zero3RegistrationsTable.id });
        return deleted ? { kind: "deleted" as const } : { kind: "missing" as const };
      });
      if (result.kind === "missing") {
        res.status(404).json({ error: "Inscrição não encontrada." });
      } else if (result.kind === "history") {
        res.status(409).json({
          code: "REGISTRATION_HAS_HISTORY",
          canCancel: result.canCancel,
          error: result.canCancel
            ? "Esta inscrição possui resultados, bateria ou histórico. Cancele para preservar os registros."
            : "Esta inscrição está em um pódio publicado. Atualize o pódio antes de cancelar.",
        });
      } else {
        res.json(DeleteZero3RegistrationResponse.parse({
          registrationId: params.data.registrationId,
          deleted: true,
        }));
      }
    } catch (error) {
      writeRosterError(req, res, error, "Não foi possível excluir a inscrição.");
    }
  },
);

router.post(
  "/zero3/events/:eventId/registrations/:registrationId/cancel",
  requireZero3Roles([...ADMIN_ONLY]),
  async (req, res): Promise<void> => {
    const params = CancelZero3RegistrationParams.safeParse(req.params);
    const body = CancelZero3RegistrationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.error?.message ?? "Informe o motivo.",
      });
      return;
    }
    const actorId = getAuth(req).userId;
    if (!actorId) {
      res.status(401).json({ error: "A sessão não informou um ID Clerk verificado." });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [registration] = await tx
          .select()
          .from(zero3RegistrationsTable)
          .where(and(
            eq(zero3RegistrationsTable.id, params.data.registrationId),
            eq(zero3RegistrationsTable.eventId, params.data.eventId),
          ))
          .for("update")
          .limit(1);
        if (!registration) return "missing" as const;
        if (registration.confirmationStatus === "CANCELLED") return "cancelled" as const;
        const [publishedPodium] = await tx
          .select({ eventId: zero3PodiumsTable.eventId })
          .from(zero3PodiumsTable)
          .where(and(
            eq(zero3PodiumsTable.eventId, registration.eventId),
            eq(zero3PodiumsTable.published, true),
            sql`${zero3PodiumsTable.registrationIds} @> jsonb_build_array(${registration.id})`,
          ))
          .limit(1);
        if (publishedPodium) return "published-podium" as const;

        const afterState = { ...registration, confirmationStatus: "CANCELLED" };
        const [updated] = await tx.update(zero3RegistrationsTable)
          .set({ confirmationStatus: "CANCELLED" })
          .where(and(
            eq(zero3RegistrationsTable.id, registration.id),
            eq(zero3RegistrationsTable.confirmationStatus, registration.confirmationStatus),
          ))
          .returning({ id: zero3RegistrationsTable.id });
        if (!updated) return "cancelled" as const;
        await tx.insert(zero3RegistrationAuditTable).values({
          eventId: registration.eventId,
          registrationId: registration.id,
          actorId,
          reason: body.data.reason.trim(),
          beforeState: {
            teamName: registration.teamName,
            category: registration.category,
            athleteIds: registration.athleteIds,
            confirmationStatus: registration.confirmationStatus,
            paymentStatus: registration.paymentStatus,
          },
          afterState: {
            teamName: registration.teamName,
            category: registration.category,
            athleteIds: registration.athleteIds,
            confirmationStatus: "CANCELLED",
            paymentStatus: registration.paymentStatus,
          },
        });
        return "ok" as const;
      });
      if (result === "missing") {
        res.status(404).json({ error: "Inscrição não encontrada." });
      } else if (result === "cancelled") {
        res.status(409).json({ error: "A inscrição já está cancelada." });
      } else if (result === "published-podium") {
        res.status(409).json({
          error: "A inscrição está em um pódio publicado. Atualize o pódio antes de cancelar.",
        });
      } else {
        res.json(CancelZero3RegistrationResponse.parse({
          registrationId: params.data.registrationId,
          cancelled: true,
        }));
      }
    } catch (error) {
      writeRosterError(req, res, error, "Não foi possível cancelar a inscrição.");
    }
  },
);

router.post(
  "/zero3/events/:eventId/roster-import/preview",
  requireZero3Roles([...ADMIN_ONLY]),
  async (req, res): Promise<void> => {
    const params = PreviewZero3RosterImportParams.safeParse(req.params);
    const body = PreviewZero3RosterImportBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos.",
      });
      return;
    }
    try {
      const plan = await loadRosterPlan({
        eventId: params.data.eventId,
        scaleTargetCategory: body.data.scaleTargetCategory,
        resolutions: body.data.resolutions,
        environment: requestEnvironment(req),
      });
      res.json(PreviewZero3RosterImportResponse.parse(plan));
    } catch (error) {
      writeRosterError(req, res, error, "Não foi possível gerar a prévia da importação.");
    }
  },
);

router.post(
  "/zero3/events/:eventId/roster-import/apply",
  requireZero3Roles([...ADMIN_ONLY]),
  async (req, res): Promise<void> => {
    const params = ApplyZero3RosterImportParams.safeParse(req.params);
    const body = ApplyZero3RosterImportBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success ? params.error.message : body.error?.message ?? "Dados inválidos.",
      });
      return;
    }
    if (!canApplyRosterImport(req)) {
      res.status(403).json({
        error: "Aplicação bloqueada fora de Development ou de um runtime explicitamente marcado como teste.",
      });
      return;
    }

    try {
      const expectedHash = await rosterSourceContentHash();
      if (body.data.contentHash !== expectedHash) {
        throw new RosterConflictError("A planilha de origem mudou após a prévia. Gere uma nova prévia.");
      }
      const actorId = getAuth(req).userId;
      if (!actorId) {
        throw new RosterInputError("A sessão não informou o ID verificado do administrador.");
      }
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ZERO3_ROSTER_SOURCE.datasetKey}), hashtext(${params.data.eventId}))`);

        const [event] = await tx
          .select()
          .from(zero3EventsTable)
          .where(eq(zero3EventsTable.id, params.data.eventId))
          .limit(1);
        if (!event) throw new RosterInputError("A edição selecionada não existe.");
        const isDemoTarget = /demonstra|demo|teste|preview|homologa/i.test(
          event.name.toLocaleLowerCase("pt-BR"),
        );
        if (isDemoTarget && !body.data.confirmDemoEvent) {
          throw new RosterConflictError(
            "A edição está identificada como demonstração/teste. Confirme explicitamente a inclusão de dados nesta edição.",
          );
        }
        const [existingBatch] = await tx
          .select()
          .from(zero3ImportBatchesTable)
          .where(and(
            eq(zero3ImportBatchesTable.eventId, event.id),
            eq(zero3ImportBatchesTable.datasetKey, ZERO3_ROSTER_SOURCE.datasetKey),
          ))
          .limit(1);
        if (existingBatch) {
          if (existingBatch.contentHash !== expectedHash) {
            throw new RosterConflictError("O lote aplicado contém outro conteúdo de origem. Nenhum dado foi alterado.");
          }
          const [people, teams] = await Promise.all([
            tx.select().from(zero3ImportPeopleTable).where(eq(zero3ImportPeopleTable.batchId, existingBatch.id)),
            tx.select().from(zero3ImportTeamsTable).where(eq(zero3ImportTeamsTable.batchId, existingBatch.id)),
          ]);
          return {
            batchId: existingBatch.id,
            alreadyApplied: true,
            createdPeople: 0,
            reusedPeople: people.length,
            createdTeams: 0,
            reusedTeams: teams.length,
            registrationIds: teams.map((team) => team.registrationId),
          };
        }

        const [existingAthletes, existingRegistrations] = await Promise.all([
          tx.select().from(zero3AthletesTable),
          tx.select().from(zero3RegistrationsTable).where(eq(zero3RegistrationsTable.eventId, event.id)),
        ]);
        const plan = buildRosterImportPlan({
          event: {
            id: event.id,
            name: event.name,
            proofName: event.proofName,
            status: event.status as "PLANNED" | "ACTIVE" | "FINISHED",
            preparationSeconds: event.preparationSeconds,
            createdAt: event.createdAt,
          },
          environment: requestEnvironment(req),
          existingAthletes,
          existingRegistrations: existingRegistrations.map((registration) => ({
            id: registration.id,
            category: registration.category,
            athleteIds: registration.athleteIds,
            confirmationStatus: registration.confirmationStatus,
            paymentStatus: registration.paymentStatus,
          })),
          resolutions: body.data.resolutions,
          scaleTargetCategory: body.data.scaleTargetCategory,
          contentHash: expectedHash,
        });
        if (plan.counts.unresolvedPeople > 0 || plan.counts.conflicts > 0) {
          throw new RosterConflictError("A prévia contém conflitos ou identidades sem resolução. Revise antes de aplicar.");
        }

        const [batch] = await tx
          .insert(zero3ImportBatchesTable)
          .values({
            eventId: event.id,
            datasetKey: ZERO3_ROSTER_SOURCE.datasetKey,
            sourceFile: ZERO3_ROSTER_SOURCE.fileName,
            sourceSheet: ZERO3_ROSTER_SOURCE.sheetName,
            sourceNotes: ZERO3_ROSTER_SOURCE.excludedSourceNotes.map((note) => ({
              cells: [...note.cells],
              text: note.text,
            })),
            contentHash: expectedHash,
            sourceTeamCount: ZERO3_ROSTER_SOURCE.teams.length,
            sourcePeopleCount: rosterSourcePeople().length,
            appliedBy: actorId,
          })
          .returning();

        const resolutionByKey = new Map(
          body.data.resolutions.map((resolution) => [resolution.sourceKey, resolution]),
        );
        const athleteIdBySourceKey = new Map<string, string>();
        let createdPeople = 0;
        let reusedPeople = 0;
        for (const person of rosterSourcePeople()) {
          const resolution = resolutionByKey.get(person.sourceKey);
          let athleteId: string;
          if (resolution?.action === "REUSE" && resolution.athleteId) {
            athleteId = resolution.athleteId;
            reusedPeople += 1;
          } else {
            const [created] = await tx
              .insert(zero3AthletesTable)
              .values({ fullName: person.fullName })
              .returning({ id: zero3AthletesTable.id });
            athleteId = created.id;
            createdPeople += 1;
          }
          athleteIdBySourceKey.set(person.sourceKey, athleteId);
          await tx.insert(zero3ImportPeopleTable).values({
            batchId: batch.id,
            sourceKey: person.sourceKey,
            sourceName: person.fullName,
            sourceCell: person.sourceCell,
            athleteId,
          });
        }

        let createdTeams = 0;
        let reusedTeams = 0;
        const registrationIds: string[] = [];
        for (const sourceTeam of ZERO3_ROSTER_SOURCE.teams) {
          const previewTeam = plan.teams.find((team) => team.sourceCode === sourceTeam.code)!;
          const athleteIds = [
            athleteIdBySourceKey.get(`${sourceTeam.code}:1`)!,
            athleteIdBySourceKey.get(`${sourceTeam.code}:2`)!,
          ];
          let registrationId = previewTeam.existingRegistrationId;
          if (registrationId) {
            reusedTeams += 1;
          } else {
            const [registration] = await tx
              .insert(zero3RegistrationsTable)
              .values({
                eventId: event.id,
                category: previewTeam.targetCategory,
                teamName: null,
                athleteIds,
                laneLabel: sourceTeam.code,
                confirmationStatus: "CONFIRMED",
                paymentStatus: "PAID",
              })
              .returning({ id: zero3RegistrationsTable.id });
            registrationId = registration.id;
            await tx.insert(zero3RegistrationMembersTable).values(
              athleteIds.map((athleteId, index) => ({
                registrationId: registration!.id,
                eventId: event.id,
                athleteId,
                slot: index + 1,
              })),
            );
            createdTeams += 1;
          }
          registrationIds.push(registrationId);
          await tx.insert(zero3ImportTeamsTable).values({
            batchId: batch.id,
            sourceCode: sourceTeam.code,
            sourceCategory: sourceTeam.category,
            sourceRow: sourceTeam.sourceRow,
            sourceCells: sourceTeam.athleteCells,
            sourceAthleteNames: sourceTeam.athleteNames,
            targetCategory: previewTeam.targetCategory,
            registrationId,
          });
        }
        return {
          batchId: batch.id,
          alreadyApplied: false,
          createdPeople,
          reusedPeople,
          createdTeams,
          reusedTeams,
          registrationIds,
        };
      });
      res.json(ApplyZero3RosterImportResponse.parse(result));
    } catch (error) {
      writeRosterError(req, res, error, "Não foi possível aplicar a importação.");
    }
  },
);

export default router;
