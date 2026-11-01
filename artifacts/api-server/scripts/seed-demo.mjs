import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  zero3AthletesTable,
  zero3EventsTable,
  zero3ProofsTable,
  zero3PodiumsTable,
  zero3RegistrationsTable,
  zero3ResultsTable,
} from "@workspace/db";

const demoEventName = "DEMONSTRAÇÃO — DADOS DE TESTE";
const longDemoTeamName =
  "TESTE SC — Associação Esportiva Horizonte — Núcleo de Formação e Desenvolvimento";

async function ensureDemoPodiums(eventId) {
  const [registrations, existingPodiums] = await Promise.all([
    db
      .select()
      .from(zero3RegistrationsTable)
      .where(eq(zero3RegistrationsTable.eventId, eventId)),
    db
      .select({ category: zero3PodiumsTable.category })
      .from(zero3PodiumsTable)
      .where(eq(zero3PodiumsTable.eventId, eventId)),
  ]);

  for (const category of ["SC", "RX"]) {
    if (existingPodiums.some((podium) => podium.category === category)) continue;
    const registrationIds = registrations
      .filter((registration) => registration.category === category)
      .sort((a, b) => (a.laneLabel ?? "").localeCompare(b.laneLabel ?? "", "pt-BR", { numeric: true }))
      .slice(0, 3)
      .map((registration) => registration.id);
    if (registrationIds.length !== 3) continue;
    await db.insert(zero3PodiumsTable).values({
      eventId,
      category,
      registrationIds,
      published: true,
      publishedBy: "DEMO — DADOS FICTÍCIOS",
      publishedAt: new Date(),
      publishReason: "Fixture manual de demonstração; não representa resultado oficial.",
      version: 1,
    });
  }
}

if (process.env.NODE_ENV !== "development") {
  throw new Error("O seed de demonstração só pode ser executado em Development.");
}

try {
  const [existing] = await db
    .select({ id: zero3EventsTable.id })
    .from(zero3EventsTable)
    .where(eq(zero3EventsTable.name, demoEventName))
    .limit(1);

  if (existing) {
    await db
      .update(zero3RegistrationsTable)
      .set({ teamName: longDemoTeamName })
      .where(
        and(
          eq(zero3RegistrationsTable.eventId, existing.id),
          eq(zero3RegistrationsTable.laneLabel, "SC-03"),
        ),
      );
    await ensureDemoPodiums(existing.id);
    console.log("Demonstração existente verificada; fixtures visuais preservadas.");
  } else {
    await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(zero3EventsTable)
        .values({
          name: demoEventName,
          proofName: "Quatro provas sintéticas — não oficiais",
          status: "ACTIVE",
          preparationSeconds: 10,
        })
        .returning();

      const proofDefinitions = [
        { order: 1, name: "Teste sintético 01", metricType: "TIME", unit: "s", direction: "LOWER" },
        { order: 2, name: "Teste sintético 02", metricType: "REPETITIONS", unit: "reps", direction: "HIGHER" },
        { order: 3, name: "Teste sintético 03", metricType: "LOAD", unit: "kg", direction: "HIGHER" },
        { order: 4, name: "Teste sintético 04", metricType: "CUSTOM", unit: "pts", direction: "HIGHER" },
      ];
      const proofRows = await tx
        .insert(zero3ProofsTable)
        .values(proofDefinitions.map((proof) => ({ eventId: event.id, ...proof })))
        .returning();

      const teams = [
        { category: "SC", label: "Roxo", ranks: [1, 1, 2, 3] },
        { category: "SC", label: "Cinza", ranks: [2, 2, 3, 1] },
        {
          category: "SC",
          label: "Associação Esportiva Horizonte — Núcleo de Formação e Desenvolvimento",
          ranks: [3, 3, 1, 2],
        },
        { category: "RX", label: "Azul", ranks: [1, 2, 1, 1] },
        { category: "RX", label: "Prata", ranks: [2, 1, 2, 3] },
        { category: "RX", label: "Âmbar", ranks: [3, 3, 3, 2] },
      ];

      const athleteRows = await tx
        .insert(zero3AthletesTable)
        .values(
          teams.flatMap((team) =>
            [1, 2].map((member) => ({
              fullName: `Atleta teste ${team.category} ${team.label} ${member}`,
            })),
          ),
        )
        .returning();

      const registrationRows = await tx
        .insert(zero3RegistrationsTable)
        .values(
          teams.map((team, index) => ({
            eventId: event.id,
            category: team.category,
            teamName: `TESTE ${team.category} — ${team.label}`,
            athleteIds: athleteRows.slice(index * 2, index * 2 + 2).map((athlete) => athlete.id),
            laneLabel: `${team.category}-${String(index % 3 + 1).padStart(2, "0")}`,
          })),
        )
        .returning();

      const resultValues = teams.flatMap((team, index) =>
        proofRows.map((proof, proofIndex) => {
          const rank = team.ranks[proofIndex];
          const rawValue =
            proof.direction === "LOWER"
              ? 50 + rank * 10
              : 110 - rank * 10;
          const registration = registrationRows[index];
          if (!registration) throw new Error("Inscrição demonstrativa ausente.");
          return {
            eventId: event.id,
            registrationId: registration.id,
            proofId: proof.id,
            category: team.category,
            laneLabel: registration.laneLabel,
            rawValue: String(rawValue),
            status: "VALIDATED",
            idempotencyKey: `demo:${event.id}:${proof.id}:${registration.id}`,
          };
        }),
      );
      await tx.insert(zero3ResultsTable).values(resultValues);
      await tx.insert(zero3PodiumsTable).values(
        ["SC", "RX"].map((category) => ({
          eventId: event.id,
          category,
          registrationIds: registrationRows
            .filter((registration) => registration.category === category)
            .sort((a, b) =>
              (a.laneLabel ?? "").localeCompare(b.laneLabel ?? "", "pt-BR", { numeric: true }),
            )
            .map((registration) => registration.id),
          published: true,
          publishedBy: "DEMO — DADOS FICTÍCIOS",
          publishedAt: new Date(),
          publishReason: "Fixture manual de demonstração; não representa resultado oficial.",
          version: 1,
        })),
      );
    });
    console.log("Evento de demonstração criado com 4 provas e 6 equipes fictícias.");
  }
} finally {
  await pool.end();
}
