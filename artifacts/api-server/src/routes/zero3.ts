import {
  CaptureZero3ResultBody,
  CaptureZero3ResultResponse,
  ControlZero3TimerBody,
  ControlZero3TimerResponse,
  CreateZero3AthleteBody,
  CreateZero3AthleteResponse,
  CreateZero3EventBody,
  CreateZero3EventResponse,
  CreateZero3HeatBody,
  CreateZero3HeatResponse,
  CreateZero3RegistrationBody,
  CreateZero3RegistrationResponse,
  GetZero3DashboardResponse,
  GetZero3MeResponse,
  GetZero3PodiumStateParams,
  GetZero3PodiumStateResponse,
  GetZero3PublicBoardQueryParams,
  GetZero3PublicBoardResponse,
  ListZero3AthletesResponse,
  ListZero3EventsResponse,
  ListZero3HeatsParams,
  ListZero3HeatsResponse,
  ListZero3ProofsParams,
  ListZero3ProofsResponse,
  ListZero3MembersResponse,
  ListZero3RegistrationsParams,
  ListZero3RegistrationsResponse,
  PublishZero3PodiumParams,
  PublishZero3PodiumBody,
  PublishZero3PodiumResponse,
  SaveZero3PodiumDraftBody,
  SaveZero3PodiumDraftParams,
  SaveZero3PodiumDraftResponse,
  SetZero3ActiveHeatBody,
  SetZero3ActiveHeatParams,
  SetZero3ActiveHeatResponse,
  SetZero3MemberRoleBody,
  SetZero3MemberRoleResponse,
  UpdateZero3EventBody,
  UpdateZero3EventParams,
  UpdateZero3EventResponse,
  UpdateZero3RegistrationBody,
  UpdateZero3RegistrationParams,
  UpdateZero3RegistrationResponse,
  UpdateZero3ProofBody,
  UpdateZero3ProofParams,
  UpdateZero3ProofResponse,
  UpdateZero3ResultBody,
  UpdateZero3ResultParams,
  UpdateZero3ResultResponse,
} from "@workspace/api-zod";
import {
  and,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  zero3ActiveHeatsTable,
  zero3AthletesTable,
  zero3EventsTable,
  zero3HeatEntriesTable,
  zero3HeatsTable,
  zero3MembersTable,
  zero3PodiumsTable,
  zero3ProofsTable,
  zero3RegistrationsTable,
  zero3ResultRevisionsTable,
  zero3ResultsTable,
  zero3TimersTable,
} from "@workspace/db";
import { resolveZero3Member, requireZero3Roles, type Zero3Request } from "../lib/zero3-auth";
import {
  calculateAllResultPlacements,
  type ResultPlacement,
  type ScoreProof,
} from "../lib/zero3-scoring";

const router: IRouter = Router();
const ADMIN_ROLES = ["ADMIN"] as const;
const EVENT_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;
const RESULT_ROLES = ["ADMIN", "JUIZ_CHEFE", "JUIZ"] as const;
const PODIUM_ROLES = ["ADMIN", "JUIZ_CHEFE"] as const;

type Category = "SC" | "RX";
type EventRow = typeof zero3EventsTable.$inferSelect;
type RegistrationRow = typeof zero3RegistrationsTable.$inferSelect;
type ResultRow = typeof zero3ResultsTable.$inferSelect;
type TimerRow = typeof zero3TimersTable.$inferSelect;
type ProofRow = typeof zero3ProofsTable.$inferSelect;

function eventDto(event: EventRow) {
  return {
    id: event.id,
    name: event.name,
    proofName: event.proofName,
    status: event.status,
    preparationSeconds: event.preparationSeconds,
    createdAt: event.createdAt,
  };
}

function proofDto(proof: ProofRow) {
  const configured =
    proof.metricType !== "UNCONFIGURED" &&
    Boolean(proof.name.trim()) &&
    (proof.direction === "LOWER" || proof.direction === "HIGHER");
  return {
    id: proof.id,
    eventId: proof.eventId,
    order: proof.order,
    name: proof.name,
    metricType: proof.metricType,
    unit: proof.unit,
    direction: proof.direction,
    configured,
    createdAt: proof.createdAt,
  };
}

async function ensureProofSlots(eventId: string) {
  const existing = await db
    .select()
    .from(zero3ProofsTable)
    .where(eq(zero3ProofsTable.eventId, eventId));
  const present = new Set(existing.map((proof) => proof.order));
  const missing = [1, 2, 3, 4].filter((order) => !present.has(order));
  if (missing.length) {
    await db
      .insert(zero3ProofsTable)
      .values(
        missing.map((order) => ({
          eventId,
          order,
          name: "",
          metricType: "UNCONFIGURED",
          unit: null,
          direction: null,
        })),
      )
      .onConflictDoNothing();
  }
  return db
    .select()
    .from(zero3ProofsTable)
    .where(eq(zero3ProofsTable.eventId, eventId))
    .orderBy(zero3ProofsTable.order);
}

async function registrationDtos(rows: RegistrationRow[]) {
  const athleteIds = [...new Set(rows.flatMap((registration) => registration.athleteIds))];
  const athletes = athleteIds.length
    ? await db
        .select()
        .from(zero3AthletesTable)
        .where(inArray(zero3AthletesTable.id, athleteIds))
    : [];
  const names = new Map(athletes.map((athlete) => [athlete.id, athlete.fullName]));
  return rows.map((registration) => ({
    id: registration.id,
    eventId: registration.eventId,
    category: registration.category,
    teamName: registration.teamName,
    athleteIds: registration.athleteIds,
    athleteNames: registration.athleteIds.map((id) => names.get(id) ?? "Atleta removido"),
    laneLabel: registration.laneLabel,
    createdAt: registration.createdAt,
  }));
}

async function registrationDto(registration: RegistrationRow) {
  const athletes = registration.athleteIds.length
    ? await db
        .select()
        .from(zero3AthletesTable)
        .where(inArray(zero3AthletesTable.id, registration.athleteIds))
    : [];
  const names = new Map(athletes.map((athlete) => [athlete.id, athlete.fullName]));
  return {
    id: registration.id,
    eventId: registration.eventId,
    category: registration.category,
    teamName: registration.teamName,
    athleteIds: registration.athleteIds,
    athleteNames: registration.athleteIds.map((id) => names.get(id) ?? "Atleta removido"),
    laneLabel: registration.laneLabel,
    createdAt: registration.createdAt,
  };
}

async function resultDto(
  result: ResultRow,
  placement?: ResultPlacement,
) {
  const [registration] = await db
    .select()
    .from(zero3RegistrationsTable)
    .where(eq(zero3RegistrationsTable.id, result.registrationId))
    .limit(1);
  const [heat] = result.heatId
    ? await db
        .select()
        .from(zero3HeatsTable)
        .where(eq(zero3HeatsTable.id, result.heatId))
        .limit(1)
    : [];
  const registrationInfo = registration
    ? await registrationDto(registration)
    : null;
  return {
    id: result.id,
    eventId: result.eventId,
    registrationId: result.registrationId,
    heatId: result.heatId,
    category: result.category,
    laneLabel: result.laneLabel,
    elapsedMs: result.elapsedMs,
    proofId: result.proofId,
    rawValue: result.rawValue === null ? null : Number(result.rawValue),
    placement: placement?.placement ?? null,
    points: placement?.points ?? null,
    tieRulePending: placement?.tiePending ?? false,
    syncErrorMs: result.syncErrorMs,
    status: result.status,
    capturedAt: result.capturedAt,
    revision: result.revision,
    names: registrationInfo?.athleteNames ?? [],
    teamName: registrationInfo?.teamName ?? null,
    heatName: heat?.name ?? null,
  };
}

async function eventResults(
  eventId: string,
  placements: Map<string, ResultPlacement> = new Map(),
) {
  const rows = await db
    .select()
    .from(zero3ResultsTable)
    .where(eq(zero3ResultsTable.eventId, eventId))
    .orderBy(desc(zero3ResultsTable.capturedAt));
  return Promise.all(rows.map((row) => resultDto(row, placements.get(row.id))));
}

async function eventScoring(event: EventRow) {
  const [proofRows, registrationRows, resultRows] = await Promise.all([
    ensureProofSlots(event.id),
    db
      .select()
      .from(zero3RegistrationsTable)
      .where(eq(zero3RegistrationsTable.eventId, event.id)),
    db
      .select()
      .from(zero3ResultsTable)
      .where(eq(zero3ResultsTable.eventId, event.id)),
  ]);
  const registrations = await registrationDtos(registrationRows);
  const proofs: ScoreProof[] = proofRows.map((proof) => ({
    id: proof.id,
    order: proof.order,
    name: proof.name,
    metricType: proof.metricType,
    unit: proof.unit,
    direction: proof.direction,
  }));
  const calculated = calculateAllResultPlacements({
    categories: ["SC", "RX"],
    eventStatus: event.status,
    proofs,
    registrations,
    results: resultRows.map((result) => ({
      id: result.id,
      registrationId: result.registrationId,
      proofId: result.proofId,
      rawValue: result.rawValue,
      status: result.status,
    })),
  });
  return {
    proofs: proofRows.map(proofDto),
    registrations: registrations.map(
      ({ id, category, teamName, laneLabel, athleteNames }) => ({
        id,
        category,
        teamName,
        laneLabel,
        athleteNames,
      }),
    ),
    resultRows,
    leaderboards: calculated.leaderboards,
    placements: calculated.placements,
  };
}

async function activeHeatDtos(eventId: string) {
  const rows = await db
    .select()
    .from(zero3ActiveHeatsTable)
    .where(eq(zero3ActiveHeatsTable.eventId, eventId));
  return Promise.all(
    (["SC", "RX"] as const).map(async (category) => {
      const active = rows.find((row) => row.category === category);
      const [heat] = active?.heatId
        ? await db
            .select()
            .from(zero3HeatsTable)
            .where(eq(zero3HeatsTable.id, active.heatId))
            .limit(1)
        : [];
      return {
        eventId,
        category,
        heatId: active?.heatId ?? null,
        heatName: heat?.name ?? null,
        updatedAt: active?.updatedAt ?? new Date(0),
      };
    }),
  );
}

async function getTimerDto(event: EventRow) {
  let [timer] = await db
    .select()
    .from(zero3TimersTable)
    .where(eq(zero3TimersTable.eventId, event.id))
    .limit(1);
  if (!timer) {
    [timer] = await db
      .insert(zero3TimersTable)
      .values({ eventId: event.id })
      .returning();
  }
  const now = new Date();
  if (
    timer.state === "PREPARATION" &&
    timer.preparationEndsAt &&
    timer.preparationEndsAt <= now
  ) {
    await db
      .update(zero3TimersTable)
      .set({
        state: "RUNNING",
        startedAt: timer.preparationEndsAt,
        preparationEndsAt: null,
        version: timer.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(zero3TimersTable.eventId, event.id),
          eq(zero3TimersTable.version, timer.version),
        ),
      );
    [timer] = await db
      .select()
      .from(zero3TimersTable)
      .where(eq(zero3TimersTable.eventId, event.id))
      .limit(1);
  }
  return timerDto(timer, event.preparationSeconds, now);
}

function timerDto(timer: TimerRow, preparationSeconds: number, now = new Date()) {
  const elapsedMs =
    timer.state === "RUNNING" && timer.startedAt
      ? timer.elapsedMs + Math.max(0, now.getTime() - timer.startedAt.getTime())
      : timer.elapsedMs;
  return {
    eventId: timer.eventId,
    state: timer.state,
    elapsedMs: Math.floor(elapsedMs),
    preparationRemainingMs:
      timer.state === "PREPARATION" && timer.preparationEndsAt
        ? Math.max(0, Math.ceil(timer.preparationEndsAt.getTime() - now.getTime()))
        : 0,
    preparationSeconds,
    startedAt: timer.startedAt,
    version: timer.version,
    updatedAt: timer.updatedAt,
  };
}

function timeAtCapture(
  timer: TimerRow | undefined,
  fallback: number | null | undefined,
): number | null {
  if (fallback !== undefined) return fallback;
  if (!timer || timer.state !== "RUNNING" || !timer.startedAt) return null;
  return timer.elapsedMs + Math.max(0, Date.now() - timer.startedAt.getTime());
}

async function currentEvent(eventId?: string): Promise<EventRow | undefined> {
  if (eventId) {
    const [event] = await db
      .select()
      .from(zero3EventsTable)
      .where(eq(zero3EventsTable.id, eventId))
      .limit(1);
    return event;
  }
  const [active] = await db
    .select()
    .from(zero3EventsTable)
    .where(eq(zero3EventsTable.status, "ACTIVE"))
    .orderBy(desc(zero3EventsTable.createdAt))
    .limit(1);
  if (active) return active;
  const [latest] = await db
    .select()
    .from(zero3EventsTable)
    .orderBy(desc(zero3EventsTable.createdAt))
    .limit(1);
  return latest;
}

async function publicPodiums(eventId: string) {
  const versions = await db
    .select()
    .from(zero3PodiumsTable)
    .where(
      and(
        eq(zero3PodiumsTable.eventId, eventId),
        eq(zero3PodiumsTable.published, true),
      ),
    )
    .orderBy(desc(zero3PodiumsTable.version));
  const latestByCategory = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!latestByCategory.has(version.category)) {
      latestByCategory.set(version.category, version);
    }
  }
  const podiums = [];
  for (const [category, podium] of latestByCategory) {
    const places = [];
    for (const [index, registrationId] of podium.registrationIds.entries()) {
      if (!registrationId) continue;
      const [registration] = await db
        .select()
        .from(zero3RegistrationsTable)
        .where(
          and(
            eq(zero3RegistrationsTable.id, registrationId),
            eq(zero3RegistrationsTable.eventId, eventId),
            eq(zero3RegistrationsTable.category, category),
          ),
        )
        .limit(1);
      if (!registration) continue;
      const dto = await registrationDto(registration);
      places.push({
        place: index + 1,
        registrationId,
        teamName: dto.teamName,
        athleteNames: dto.athleteNames,
      });
    }
    podiums.push({ category, places });
  }
  return podiums;
}

router.get(
  "/zero3/me",
  async (req, res): Promise<void> => {
    const resolved = await resolveZero3Member(req);
    if (!resolved) {
      res.status(403).json({ error: "Acesso ZERO3 não autorizado." });
      return;
    }
    res.json(
      GetZero3MeResponse.parse({
        userId: resolved.userId,
        email: resolved.member.email,
        role: resolved.member.role,
      }),
    );
  },
);

router.get(
  "/zero3/dashboard",
  requireZero3Roles([...RESULT_ROLES]),
  async (_req, res): Promise<void> => {
    const events = await db.select().from(zero3EventsTable);
    const athletes = await db.select().from(zero3AthletesTable);
    const [activeEvent] = await db
      .select()
      .from(zero3EventsTable)
      .where(eq(zero3EventsTable.status, "ACTIVE"))
      .orderBy(desc(zero3EventsTable.createdAt))
      .limit(1);
    const recentRows = await db
      .select()
      .from(zero3ResultsTable)
      .orderBy(desc(zero3ResultsTable.capturedAt))
      .limit(8);
    const recentResults = await Promise.all(
      recentRows.map((result) => resultDto(result)),
    );
    const payload = {
      eventCount: events.length,
      athleteCount: athletes.length,
      ...(activeEvent ? { activeEvent: eventDto(activeEvent) } : {}),
      recentResults,
      connected: true,
    };
    res.json(GetZero3DashboardResponse.parse(payload));
  },
);

router.get(
  "/zero3/events",
  requireZero3Roles([...RESULT_ROLES]),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(zero3EventsTable)
      .orderBy(desc(zero3EventsTable.createdAt));
    res.json(ListZero3EventsResponse.parse(rows.map(eventDto)));
  },
);

router.post(
  "/zero3/events",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const parsed = CreateZero3EventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [event] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(zero3EventsTable)
        .values({
          ...parsed.data,
          proofName:
            parsed.data.proofName?.trim() ||
            "4 provas — configuração pendente",
        })
        .returning();
      await tx.insert(zero3ProofsTable).values(
        [1, 2, 3, 4].map((order) => ({
          eventId: created.id,
          order,
          name: "",
          metricType: "UNCONFIGURED",
          unit: null,
          direction: null,
        })),
      );
      await tx.insert(zero3TimersTable).values({ eventId: created.id });
      return [created];
    });
    res
      .status(201)
      .json(CreateZero3EventResponse.parse(eventDto(event)));
  },
);

router.patch(
  "/zero3/events/:eventId",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = UpdateZero3EventParams.safeParse(req.params);
    const body = UpdateZero3EventBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const [event] = await db
      .update(zero3EventsTable)
      .set(body.data)
      .where(eq(zero3EventsTable.id, params.data.eventId))
      .returning();
    if (!event) {
      res.status(404).json({ error: "Prova não encontrada." });
      return;
    }
    res.json(UpdateZero3EventResponse.parse(eventDto(event)));
  },
);

router.get(
  "/zero3/events/:eventId/proofs",
  requireZero3Roles([...RESULT_ROLES]),
  async (req, res): Promise<void> => {
    const params = ListZero3ProofsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [event] = await db
      .select()
      .from(zero3EventsTable)
      .where(eq(zero3EventsTable.id, params.data.eventId))
      .limit(1);
    if (!event) {
      res.status(404).json({ error: "Evento não encontrado." });
      return;
    }
    const proofs = await ensureProofSlots(event.id);
    res.json(ListZero3ProofsResponse.parse(proofs.map(proofDto)));
  },
);

router.patch(
  "/zero3/events/:eventId/proofs/:proofId",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = UpdateZero3ProofParams.safeParse(req.params);
    const body = UpdateZero3ProofBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const [proof] = await db
      .select()
      .from(zero3ProofsTable)
      .where(
        and(
          eq(zero3ProofsTable.id, params.data.proofId),
          eq(zero3ProofsTable.eventId, params.data.eventId),
        ),
      )
      .limit(1);
    if (!proof) {
      res.status(404).json({ error: "Prova não encontrada." });
      return;
    }
    if (body.data.metricType === "UNCONFIGURED") {
      res.status(400).json({ error: "Selecione uma métrica válida." });
      return;
    }
    const [existingResult] = await db
      .select({ id: zero3ResultsTable.id })
      .from(zero3ResultsTable)
      .where(eq(zero3ResultsTable.proofId, proof.id))
      .limit(1);
    if (
      existingResult &&
      (proof.metricType !== body.data.metricType ||
        proof.direction !== body.data.direction)
    ) {
      res.status(409).json({
        error:
          "A métrica e a direção não podem mudar após lançamentos. Revise os resultados antes de alterar a regra.",
      });
      return;
    }
    const [updated] = await db
      .update(zero3ProofsTable)
      .set({
        name: body.data.name.trim(),
        metricType: body.data.metricType,
        unit: body.data.unit?.trim() || null,
        direction: body.data.direction,
        updatedAt: new Date(),
      })
      .where(eq(zero3ProofsTable.id, proof.id))
      .returning();
    res.json(UpdateZero3ProofResponse.parse(proofDto(updated)));
  },
);

router.get(
  "/zero3/athletes",
  requireZero3Roles([...RESULT_ROLES]),
  async (_req, res): Promise<void> => {
    const athletes = await db
      .select()
      .from(zero3AthletesTable)
      .orderBy(zero3AthletesTable.fullName);
    res.json(ListZero3AthletesResponse.parse(athletes));
  },
);

router.post(
  "/zero3/athletes",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const parsed = CreateZero3AthleteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [athlete] = await db
      .insert(zero3AthletesTable)
      .values({ fullName: parsed.data.fullName.trim() })
      .returning();
    res
      .status(201)
      .json(CreateZero3AthleteResponse.parse(athlete));
  },
);

router.put(
  "/zero3/events/:eventId/active-heats/:category",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = SetZero3ActiveHeatParams.safeParse(req.params);
    const body = SetZero3ActiveHeatBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Selecione uma bateria válida."),
      });
      return;
    }
    let heatName: string | null = null;
    if (body.data.heatId) {
      const [heat] = await db
        .select()
        .from(zero3HeatsTable)
        .where(
          and(
            eq(zero3HeatsTable.id, body.data.heatId),
            eq(zero3HeatsTable.eventId, params.data.eventId),
            eq(zero3HeatsTable.category, params.data.category),
          ),
        )
        .limit(1);
      if (!heat) {
        res.status(400).json({
          error: "A bateria precisa pertencer ao evento e à categoria selecionados.",
        });
        return;
      }
      heatName = heat.name;
    }
    const now = new Date();
    await db
      .insert(zero3ActiveHeatsTable)
      .values({
        eventId: params.data.eventId,
        category: params.data.category,
        heatId: body.data.heatId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [zero3ActiveHeatsTable.eventId, zero3ActiveHeatsTable.category],
        set: { heatId: body.data.heatId, updatedAt: now },
      });
    res.json(
      SetZero3ActiveHeatResponse.parse({
        eventId: params.data.eventId,
        category: params.data.category,
        heatId: body.data.heatId,
        heatName,
        updatedAt: now,
      }),
    );
  },
);

router.get(
  "/zero3/events/:eventId/registrations",
  requireZero3Roles([...RESULT_ROLES]),
  async (req, res): Promise<void> => {
    const params = ListZero3RegistrationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(zero3RegistrationsTable)
      .where(eq(zero3RegistrationsTable.eventId, params.data.eventId))
      .orderBy(zero3RegistrationsTable.createdAt);
    res.json(
      ListZero3RegistrationsResponse.parse(
        await Promise.all(rows.map(registrationDto)),
      ),
    );
  },
);

router.post(
  "/zero3/events/:eventId/registrations",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = ListZero3RegistrationsParams.safeParse(req.params);
    const body = CreateZero3RegistrationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const [event] = await db
      .select()
      .from(zero3EventsTable)
      .where(eq(zero3EventsTable.id, params.data.eventId))
      .limit(1);
    if (!event) {
      res.status(404).json({ error: "Prova não encontrada." });
      return;
    }
    const athleteIds = [...new Set(body.data.athleteIds)];
    if (athleteIds.length !== body.data.athleteIds.length) {
      res.status(400).json({ error: "Há atletas duplicados nesta inscrição." });
      return;
    }
    const athletes = await db
      .select()
      .from(zero3AthletesTable)
      .where(inArray(zero3AthletesTable.id, athleteIds));
    if (athletes.length !== athleteIds.length) {
      res.status(400).json({ error: "Selecione atletas cadastrados." });
      return;
    }
    const existing = await db
      .select()
      .from(zero3RegistrationsTable)
      .where(
        and(
          eq(zero3RegistrationsTable.eventId, params.data.eventId),
          eq(zero3RegistrationsTable.category, body.data.category),
        ),
      );
    const candidateKey = [...athleteIds].sort().join(":");
    if (
      existing.some(
        (registration) =>
          [...registration.athleteIds].sort().join(":") === candidateKey,
      )
    ) {
      res.status(409).json({ error: "Esta equipe já está inscrita nesta categoria." });
      return;
    }
    const [registration] = await db
      .insert(zero3RegistrationsTable)
      .values({
        eventId: params.data.eventId,
        category: body.data.category,
        teamName: body.data.teamName?.trim() || null,
        athleteIds,
        laneLabel: body.data.laneLabel?.trim() || null,
      })
      .returning();
    res.status(201).json(
      CreateZero3RegistrationResponse.parse(
        await registrationDto(registration),
      ),
    );
  },
);

router.patch(
  "/zero3/events/:eventId/registrations/:registrationId",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = UpdateZero3RegistrationParams.safeParse(req.params);
    const body = UpdateZero3RegistrationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Informe o nome da equipe."),
      });
      return;
    }
    const [existing] = await db
      .select()
      .from(zero3RegistrationsTable)
      .where(
        and(
          eq(zero3RegistrationsTable.id, params.data.registrationId),
          eq(zero3RegistrationsTable.eventId, params.data.eventId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Inscrição não encontrada." });
      return;
    }
    const [updated] = await db
      .update(zero3RegistrationsTable)
      .set({
        teamName: body.data.teamName?.trim() || null,
      })
      .where(eq(zero3RegistrationsTable.id, existing.id))
      .returning();
    res.json(
      UpdateZero3RegistrationResponse.parse(await registrationDto(updated)),
    );
  },
);

router.get(
  "/zero3/events/:eventId/heats",
  requireZero3Roles([...RESULT_ROLES]),
  async (req, res): Promise<void> => {
    const params = ListZero3HeatsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const heats = await db
      .select()
      .from(zero3HeatsTable)
      .where(eq(zero3HeatsTable.eventId, params.data.eventId))
      .orderBy(zero3HeatsTable.order);
    const response = [];
    for (const heat of heats) {
      const entries = await db
        .select({ registration: zero3RegistrationsTable, laneLabel: zero3HeatEntriesTable.laneLabel })
        .from(zero3HeatEntriesTable)
        .innerJoin(
          zero3RegistrationsTable,
          eq(zero3RegistrationsTable.id, zero3HeatEntriesTable.registrationId),
        )
        .where(eq(zero3HeatEntriesTable.heatId, heat.id));
      response.push({
        ...heat,
        registrations: await Promise.all(
          entries.map(async ({ registration, laneLabel }) => ({
            ...(await registrationDto(registration)),
            laneLabel,
          })),
        ),
      });
    }
    res.json(ListZero3HeatsResponse.parse(response));
  },
);

router.post(
  "/zero3/events/:eventId/heats",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = ListZero3HeatsParams.safeParse(req.params);
    const body = CreateZero3HeatBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const registrationIds = body.data.registrationIds ?? [];
    if (new Set(registrationIds).size !== registrationIds.length) {
      res.status(400).json({ error: "Há inscrições duplicadas na bateria." });
      return;
    }
    const registrations = registrationIds.length
      ? await db
          .select()
          .from(zero3RegistrationsTable)
          .where(
            and(
              inArray(zero3RegistrationsTable.id, registrationIds),
              eq(zero3RegistrationsTable.eventId, params.data.eventId),
              eq(zero3RegistrationsTable.category, body.data.category),
            ),
          )
      : [];
    if (registrations.length !== registrationIds.length) {
      res.status(400).json({
        error: "Cada inscrição precisa pertencer à prova e categoria da bateria.",
      });
      return;
    }
    const [existingHeat] = await db
      .select()
      .from(zero3HeatsTable)
      .where(
        and(
          eq(zero3HeatsTable.eventId, params.data.eventId),
          eq(zero3HeatsTable.category, body.data.category),
          eq(zero3HeatsTable.order, body.data.order),
        ),
      )
      .limit(1);
    if (existingHeat) {
      res.status(409).json({ error: "Esta ordem já está usada na categoria." });
      return;
    }
    const { registrationIds: _registrationIds, ...heatData } = body.data;
    const heat = await db.transaction(async (tx) => {
      const [createdHeat] = await tx
        .insert(zero3HeatsTable)
        .values({ ...heatData, eventId: params.data.eventId })
        .returning();
      if (registrations.length) {
        await tx.insert(zero3HeatEntriesTable).values(
          registrations.map((registration) => ({
            heatId: createdHeat.id,
            registrationId: registration.id,
            laneLabel: registration.laneLabel,
          })),
        );
      }
      return createdHeat;
    });
    const heatRegistrations = await Promise.all(
      registrations.map(registrationDto),
    );
    res.status(201).json(
      CreateZero3HeatResponse.parse({
        ...heat,
        registrations: heatRegistrations,
      }),
    );
  },
);

router.put(
  "/zero3/events/:eventId/timer",
  requireZero3Roles([...EVENT_ROLES]),
  async (req, res): Promise<void> => {
    const params = ListZero3HeatsParams.safeParse(req.params);
    const body = ControlZero3TimerBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const [event] = await db
      .select()
      .from(zero3EventsTable)
      .where(eq(zero3EventsTable.id, params.data.eventId))
      .limit(1);
    if (!event) {
      res.status(404).json({ error: "Prova não encontrada." });
      return;
    }
    const now = new Date();
    let result: TimerRow;
    try {
      result = await db.transaction(async (tx) => {
      let [timer] = await tx
        .select()
        .from(zero3TimersTable)
        .where(eq(zero3TimersTable.eventId, event.id))
        .limit(1)
        .for("update");
      if (!timer) {
        [timer] = await tx
          .insert(zero3TimersTable)
          .values({ eventId: event.id })
          .returning();
      }
      if (timer.lastCommandId === body.data.commandId) return timer;
      if (timer.version !== body.data.expectedVersion) {
        throw new Error("TIMER_VERSION_CONFLICT");
      }
      const liveElapsed =
        timer.state === "RUNNING" && timer.startedAt
          ? timer.elapsedMs + now.getTime() - timer.startedAt.getTime()
          : timer.elapsedMs;
      let update: Partial<typeof timer> = {
        version: timer.version + 1,
        lastCommandId: body.data.commandId,
        updatedAt: now,
      };
      switch (body.data.action) {
        case "prepare":
          if (timer.state === "RUNNING" || timer.state === "PAUSED") {
            throw new Error("TIMER_INVALID_ACTION");
          }
          update = {
            ...update,
            state: "PREPARATION",
            elapsedMs: 0,
            startedAt: null,
            preparationEndsAt: new Date(
              now.getTime() + event.preparationSeconds * 1000,
            ),
          };
          break;
        case "start":
          if (
            timer.state !== "IDLE" &&
            timer.state !== "FINISHED"
          ) {
            throw new Error("TIMER_INVALID_ACTION");
          }
          update = {
            ...update,
            state: "RUNNING",
            elapsedMs: 0,
            startedAt: now,
            preparationEndsAt: null,
          };
          break;
        case "pause":
          if (timer.state !== "RUNNING") throw new Error("TIMER_INVALID_ACTION");
          update = {
            ...update,
            state: "PAUSED",
            elapsedMs: Math.floor(liveElapsed),
            startedAt: null,
          };
          break;
        case "resume":
          if (timer.state !== "PAUSED") throw new Error("TIMER_INVALID_ACTION");
          update = { ...update, state: "RUNNING", startedAt: now };
          break;
        case "finish":
          if (timer.state !== "RUNNING" && timer.state !== "PAUSED") {
            throw new Error("TIMER_INVALID_ACTION");
          }
          update = {
            ...update,
            state: "FINISHED",
            elapsedMs: Math.floor(liveElapsed),
            startedAt: null,
            preparationEndsAt: null,
          };
          break;
        case "reset":
          update = {
            ...update,
            state: "IDLE",
            elapsedMs: 0,
            startedAt: null,
            preparationEndsAt: null,
          };
          break;
      }
      const [saved] = await tx
        .update(zero3TimersTable)
        .set(update)
        .where(
          and(
            eq(zero3TimersTable.eventId, event.id),
            eq(zero3TimersTable.version, body.data.expectedVersion),
          ),
        )
        .returning();
      if (!saved) throw new Error("TIMER_VERSION_CONFLICT");
      return saved;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TIMER_VERSION_CONFLICT") {
        res.status(409).json({ error: "O timer mudou em outra tela. Atualize e tente novamente." });
        return;
      }
      if (message === "TIMER_INVALID_ACTION") {
        res.status(400).json({ error: "Este comando não é válido para o estado atual." });
        return;
      }
      req.log.error({ err: error }, "Unable to update ZERO3 timer");
      res.status(500).json({ error: "Não foi possível atualizar o cronômetro." });
      return;
    }
    const current = timerDto(result, event.preparationSeconds, now);
    res.json(ControlZero3TimerResponse.parse(current));
  },
);

router.post(
  "/zero3/results",
  requireZero3Roles([...RESULT_ROLES]),
  async (req, res): Promise<void> => {
    const body = CaptureZero3ResultBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(zero3ResultsTable)
      .where(eq(zero3ResultsTable.idempotencyKey, body.data.idempotencyKey))
      .limit(1);
    if (existing) {
      res.status(201).json(
        CaptureZero3ResultResponse.parse(await resultDto(existing)),
      );
      return;
    }
    const [registration] = await db
      .select()
      .from(zero3RegistrationsTable)
      .where(eq(zero3RegistrationsTable.id, body.data.registrationId))
      .limit(1);
    if (
      !registration ||
      registration.eventId !== body.data.eventId ||
      (body.data.heatId && !registration)
    ) {
      res.status(400).json({ error: "Inscrição inválida para esta prova." });
      return;
    }
    if (body.data.proofId || body.data.rawValue !== undefined) {
      if (!body.data.proofId || body.data.status !== "PROVISIONAL") {
        res.status(400).json({
          error:
            "Informe a prova e salve o lançamento como provisório para revisão.",
        });
        return;
      }
      const [proof] = await db
        .select()
        .from(zero3ProofsTable)
        .where(
          and(
            eq(zero3ProofsTable.id, body.data.proofId),
            eq(zero3ProofsTable.eventId, body.data.eventId),
          ),
        )
        .limit(1);
      if (!proof) {
        res.status(400).json({ error: "Prova inválida para este evento." });
        return;
      }
      if (proofDto(proof).configured && body.data.rawValue == null) {
        res.status(400).json({
          error: `Informe o resultado da prova ${proof.order}.`,
        });
        return;
      }
      if (!proofDto(proof).configured) {
        res.status(409).json({
          error: "Configure nome, métrica e direção antes de lançar resultados.",
        });
        return;
      }
      const [duplicate] = await db
        .select()
        .from(zero3ResultsTable)
        .where(
          and(
            eq(zero3ResultsTable.eventId, body.data.eventId),
            eq(zero3ResultsTable.proofId, proof.id),
            eq(zero3ResultsTable.registrationId, registration.id),
          ),
        )
        .limit(1);
      if (duplicate) {
        res.status(409).json({
          error:
            "Esta equipe já tem um lançamento nesta prova. Edite o resultado existente para corrigir.",
        });
        return;
      }
      const [created] = await db
        .insert(zero3ResultsTable)
        .values({
          eventId: body.data.eventId,
          registrationId: registration.id,
          proofId: proof.id,
          heatId: body.data.heatId ?? null,
          category: registration.category,
          laneLabel: registration.laneLabel,
          elapsedMs: null,
          rawValue:
            body.data.rawValue === undefined || body.data.rawValue === null
              ? null
              : String(body.data.rawValue),
          syncErrorMs: null,
          status: "PROVISIONAL",
          idempotencyKey: body.data.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const [byIdempotency] = await db
          .select()
          .from(zero3ResultsTable)
          .where(eq(zero3ResultsTable.idempotencyKey, body.data.idempotencyKey))
          .limit(1);
        if (byIdempotency) {
          res.status(201).json(
            CaptureZero3ResultResponse.parse(await resultDto(byIdempotency)),
          );
          return;
        }
        res.status(409).json({
          error: "Já existe um lançamento para esta equipe e prova.",
        });
        return;
      }
      res
        .status(201)
        .json(CaptureZero3ResultResponse.parse(await resultDto(created)));
      return;
    }
    if (
      body.data.heatId &&
      !(
        await db
          .select()
          .from(zero3HeatsTable)
          .where(
            and(
              eq(zero3HeatsTable.id, body.data.heatId),
              eq(zero3HeatsTable.eventId, body.data.eventId),
              eq(zero3HeatsTable.category, registration.category),
            ),
          )
          .limit(1)
      )[0]
    ) {
      res.status(400).json({ error: "Bateria inválida para esta categoria." });
      return;
    }
    if (
      body.data.heatId &&
      !(
        await db
          .select()
          .from(zero3HeatEntriesTable)
          .where(
            and(
              eq(zero3HeatEntriesTable.heatId, body.data.heatId),
              eq(zero3HeatEntriesTable.registrationId, registration.id),
            ),
          )
          .limit(1)
      )[0]
    ) {
      res.status(400).json({ error: "A inscrição não está atribuída a esta bateria." });
      return;
    }
    if (!body.data.heatId) {
      res.status(400).json({ error: "Selecione a bateria ativa antes de capturar." });
      return;
    }
    const [priorResult] = await db
      .select()
      .from(zero3ResultsTable)
      .where(
        and(
          eq(zero3ResultsTable.eventId, body.data.eventId),
          eq(zero3ResultsTable.registrationId, registration.id),
          eq(zero3ResultsTable.heatId, body.data.heatId),
        ),
      )
      .limit(1);
    if (priorResult) {
      res.status(409).json({
        error: "Esta inscrição já tem um lançamento nesta bateria. Revise o resultado existente.",
      });
      return;
    }
    const [timer] = await db
      .select()
      .from(zero3TimersTable)
      .where(eq(zero3TimersTable.eventId, body.data.eventId))
      .limit(1);
    const candidateElapsedMs = body.data.elapsedMs;
    let elapsedMs = candidateElapsedMs ?? null;
    let syncErrorMs: number | null = null;
    if (
      (body.data.status === "PROVISIONAL" ||
        body.data.status === "VALIDATED") &&
      (timer?.state !== "RUNNING" ||
        !timer.startedAt ||
        candidateElapsedMs == null)
    ) {
      res.status(400).json({
        error: "Inicie o timer e capture um tempo estimado no instante da chegada.",
      });
      return;
    }
    if (
      (body.data.status === "PROVISIONAL" ||
        body.data.status === "VALIDATED") &&
      timer?.startedAt &&
      candidateElapsedMs != null
    ) {
      const authoritativeElapsedMs =
        timer.elapsedMs + Math.max(0, Date.now() - timer.startedAt.getTime());
      syncErrorMs = Math.abs(candidateElapsedMs - authoritativeElapsedMs);
      if (syncErrorMs > 5000) {
        res.status(409).json({
          error:
            "A diferença entre a captura e o servidor excede cinco segundos. Refaça a captura ou encaminhe para revisão.",
        });
        return;
      }
    }
    const [result] = await db
      .insert(zero3ResultsTable)
      .values({
        eventId: body.data.eventId,
        registrationId: body.data.registrationId,
        heatId: body.data.heatId ?? null,
        category: registration.category,
        laneLabel: registration.laneLabel,
        elapsedMs,
        syncErrorMs,
        status: body.data.status,
        idempotencyKey: body.data.idempotencyKey,
      })
      .onConflictDoNothing({ target: zero3ResultsTable.idempotencyKey })
      .returning();
    const saved =
      result ??
      (
        await db
          .select()
          .from(zero3ResultsTable)
          .where(eq(zero3ResultsTable.idempotencyKey, body.data.idempotencyKey))
          .limit(1)
      )[0];
    res
      .status(201)
      .json(CaptureZero3ResultResponse.parse(await resultDto(saved)));
  },
);

router.patch(
  "/zero3/results/:resultId",
  requireZero3Roles(["ADMIN", "JUIZ_CHEFE"]),
  async (req, res): Promise<void> => {
    const params = UpdateZero3ResultParams.safeParse(req.params);
    const body = UpdateZero3ResultBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const [existing] = await db
      .select()
      .from(zero3ResultsTable)
      .where(eq(zero3ResultsTable.id, params.data.resultId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Resultado não encontrado." });
      return;
    }
    const member = (req as Zero3Request).zero3Member;
    const updated = await db.transaction(async (tx) => {
      await tx.insert(zero3ResultRevisionsTable).values({
        resultId: existing.id,
        previousStatus: existing.status,
        previousElapsedMs: existing.elapsedMs,
        previousRawValue: existing.rawValue,
        reason: body.data.reason,
        actorId: member?.email ?? "unknown",
      });
      const [result] = await tx
        .update(zero3ResultsTable)
        .set({
          ...(body.data.status ? { status: body.data.status } : {}),
          ...(body.data.elapsedMs !== undefined
            ? { elapsedMs: body.data.elapsedMs }
            : {}),
          ...(body.data.rawValue !== undefined
            ? {
                rawValue:
                  body.data.rawValue === null
                    ? null
                    : String(body.data.rawValue),
              }
            : {}),
          revision: existing.revision + 1,
        })
        .where(eq(zero3ResultsTable.id, existing.id))
        .returning();
      return result;
    });
    res.json(UpdateZero3ResultResponse.parse(await resultDto(updated)));
  },
);

router.get(
  "/zero3/events/:eventId/podiums/:category",
  requireZero3Roles([...PODIUM_ROLES]),
  async (req, res): Promise<void> => {
    const params = GetZero3PodiumStateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(zero3PodiumsTable)
      .where(
        and(
          eq(zero3PodiumsTable.eventId, params.data.eventId),
          eq(zero3PodiumsTable.category, params.data.category),
        ),
      )
      .orderBy(desc(zero3PodiumsTable.version));
    const draft = rows.find((row) => !row.published) ?? null;
    const published = rows.find((row) => row.published) ?? null;
    res.json(
      GetZero3PodiumStateResponse.parse({
        draft,
        published,
      }),
    );
  },
);

router.put(
  "/zero3/events/:eventId/podiums/:category",
  requireZero3Roles([...PODIUM_ROLES]),
  async (req, res): Promise<void> => {
    const params = SaveZero3PodiumDraftParams.safeParse(req.params);
    const body = SaveZero3PodiumDraftBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Dados inválidos."),
      });
      return;
    }
    const selected = body.data.registrationIds.filter(
      (id): id is string => id !== null,
    );
    if (new Set(selected).size !== selected.length) {
      res.status(400).json({ error: "Cada posição do pódio deve ser única." });
      return;
    }
    if (selected.length) {
      const registrations = await db
        .select()
        .from(zero3RegistrationsTable)
        .where(inArray(zero3RegistrationsTable.id, selected));
      if (
        registrations.length !== selected.length ||
        registrations.some(
          (registration) =>
            registration.eventId !== params.data.eventId ||
            registration.category !== params.data.category,
        )
      ) {
        res.status(400).json({ error: "Pódio deve usar inscrições desta categoria." });
        return;
      }
    }
    const versions = await db
      .select()
      .from(zero3PodiumsTable)
      .where(
        and(
          eq(zero3PodiumsTable.eventId, params.data.eventId),
          eq(zero3PodiumsTable.category, params.data.category),
        ),
      )
      .orderBy(desc(zero3PodiumsTable.version));
    const latest = versions[0];
    const version =
      latest && !latest.published ? latest.version : (latest?.version ?? 0) + 1;
    const saved = latest && !latest.published
      ? (
          await db
            .update(zero3PodiumsTable)
            .set({
              registrationIds: body.data.registrationIds,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(zero3PodiumsTable.eventId, params.data.eventId),
                eq(zero3PodiumsTable.category, params.data.category),
                eq(zero3PodiumsTable.version, version),
              ),
            )
            .returning()
        )[0]
      : (
          await db
            .insert(zero3PodiumsTable)
            .values({
              eventId: params.data.eventId,
              category: params.data.category,
              registrationIds: body.data.registrationIds,
              version,
              published: false,
            })
            .returning()
        )[0];
    res.json(SaveZero3PodiumDraftResponse.parse(saved));
  },
);

router.post(
  "/zero3/events/:eventId/podiums/:category/publish",
  requireZero3Roles([...PODIUM_ROLES]),
  async (req, res): Promise<void> => {
    const params = PublishZero3PodiumParams.safeParse(req.params);
    const body = PublishZero3PodiumBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : (body.error?.message ?? "Informe o motivo da publicação."),
      });
      return;
    }
    const [draft] = await db
      .select()
      .from(zero3PodiumsTable)
      .where(
        and(
          eq(zero3PodiumsTable.eventId, params.data.eventId),
          eq(zero3PodiumsTable.category, params.data.category),
        ),
      )
      .orderBy(desc(zero3PodiumsTable.version))
      .limit(1);
    if (!draft) {
      res.status(400).json({ error: "Salve um rascunho antes de publicar." });
      return;
    }
    if (draft.published) {
      res.json(PublishZero3PodiumResponse.parse(draft));
      return;
    }
    const ids = draft.registrationIds.filter(
      (id): id is string => id !== null,
    );
    if (ids.length !== 3) {
      res.status(400).json({ error: "Selecione os três lugares do pódio." });
      return;
    }
    const member = (req as Zero3Request).zero3Member;
    const now = new Date();
    const [published] = await db
      .update(zero3PodiumsTable)
      .set({
        published: true,
        publishedBy: member?.email ?? "unknown",
        publishedAt: now,
        publishReason: body.data.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(zero3PodiumsTable.eventId, params.data.eventId),
          eq(zero3PodiumsTable.category, params.data.category),
          eq(zero3PodiumsTable.version, draft.version),
        ),
      )
      .returning();
    res.json(PublishZero3PodiumResponse.parse(published));
  },
);

router.get(
  "/zero3/members",
  requireZero3Roles([...ADMIN_ROLES]),
  async (_req, res): Promise<void> => {
    const members = await db
      .select()
      .from(zero3MembersTable)
      .orderBy(zero3MembersTable.email);
    res.json(ListZero3MembersResponse.parse(members));
  },
);

router.put(
  "/zero3/members",
  requireZero3Roles([...ADMIN_ROLES]),
  async (req, res): Promise<void> => {
    const body = SetZero3MemberRoleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const email = body.data.email.trim().toLowerCase();
    const requester = (req as Zero3Request).zero3Member;
    if (
      requester?.email === email &&
      body.data.role !== "ADMIN" &&
      body.data.active
    ) {
      const admins = await db
        .select()
        .from(zero3MembersTable)
        .where(
          and(
            eq(zero3MembersTable.role, "ADMIN"),
            eq(zero3MembersTable.active, true),
          ),
        );
      if (admins.length <= 1) {
        res.status(400).json({ error: "Mantenha ao menos um administrador ativo." });
        return;
      }
    }
    const [member] = await db
      .insert(zero3MembersTable)
      .values({ email, role: body.data.role, active: body.data.active })
      .onConflictDoUpdate({
        target: zero3MembersTable.email,
        set: {
          role: body.data.role,
          active: body.data.active,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.json(SetZero3MemberRoleResponse.parse(member));
  },
);

router.get(
  "/zero3/public-board",
  async (req, res): Promise<void> => {
    const params = GetZero3PublicBoardQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const event = await currentEvent(params.data.eventId);
    if (!event) {
      res.json(
        GetZero3PublicBoardResponse.parse({
          serverTime: new Date(),
          results: [],
          proofs: [],
          registrations: [],
          leaderboards: [],
          podiums: [],
          activeHeats: [],
        }),
      );
      return;
    }
    const timer = await getTimerDto(event);
    const scoring = await eventScoring(event);
    const results = await eventResults(event.id, scoring.placements);
    const podiums = await publicPodiums(event.id);
    const activeHeats = await activeHeatDtos(event.id);
    res.json(
      GetZero3PublicBoardResponse.parse({
        serverTime: new Date(),
        event: eventDto(event),
        timer,
        results,
        proofs: scoring.proofs,
        registrations: scoring.registrations,
        leaderboards: scoring.leaderboards,
        podiums,
        activeHeats,
      }),
    );
  },
);

export default router;
