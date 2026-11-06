import assert from "node:assert/strict";
import test from "node:test";
import { GetZero3RankingPublicationResponse } from "@workspace/api-zod";
import { buildRankingPublicationPlan } from "./zero3-ranking-publication";
import { scoreTieBreaksFromSnapshot } from "./zero3-scoring";

const proofs = [
  { id: "proof-1", order: 1, name: "Prova 1", metricType: "TIME", unit: "s", direction: "LOWER" },
  { id: "proof-2", order: 2, name: "Prova 2", metricType: "WEIGHT", unit: "kg", direction: "HIGHER" },
];
const registrations = [
  { id: "rx-a", category: "RX", teamName: "Equipe A", athleteNames: ["Atleta A"], laneLabel: "P01", active: true },
  { id: "rx-b", category: "RX", teamName: "Equipe B", athleteNames: ["Atleta B"], laneLabel: "P02", active: true },
  { id: "sc-a", category: "SC", teamName: "Equipe SC", athleteNames: ["Atleta SC"], laneLabel: "P03", active: true },
];
const result = (overrides: Record<string, unknown> = {}) => ({
  id: "result-1",
  registrationId: "rx-a",
  proofId: "proof-1",
  category: "RX",
  status: "VALIDATED",
  rawValue: "65.25",
  elapsedMs: 65_250,
  revision: 2,
  publishedStatus: null,
  publishedRawValue: null,
  publishedElapsedMs: null,
  publishedRevision: null,
  associationValid: true,
  ...overrides,
});

test("ranking publication overlays reviewed results and keeps categories separate", async () => {
  const plan = await buildRankingPublicationPlan({
    eventId: "event-1",
    eventStatus: "ACTIVE",
    version: 0,
    proofs,
    registrations,
    results: [result(), result({
      id: "result-2",
      registrationId: "sc-a",
      category: "SC",
      rawValue: "70",
      elapsedMs: 70_000,
    })],
  });

  assert.equal(plan.canPublish, true);
  assert.equal(plan.eligibleResultCount, 2);
  assert.equal(plan.results.length, 2);
  assert.deepEqual(
    plan.affected.map(({ category, proofId }) => `${category}:${proofId}`),
    ["RX:proof-1", "SC:proof-1"],
  );
  assert.equal(plan.leaderboards.length, 2);
  assert.equal(plan.leaderboards[0]?.category, "RX");
  assert.equal(plan.leaderboards[1]?.category, "SC");
});

test("a correction stays reviewed until republished and leaves prior official value intact", async () => {
  const plan = await buildRankingPublicationPlan({
    eventId: "event-1",
    eventStatus: "ACTIVE",
    version: 4,
    proofs,
    registrations,
    results: [result({
      id: "result-1",
      status: "VALIDATED",
      rawValue: "59.5",
      revision: 5,
      publishedStatus: "VALIDATED",
      publishedRawValue: "61.0",
      publishedElapsedMs: 61_000,
      publishedRevision: 4,
    })],
  });

  assert.equal(plan.canPublish, true);
  assert.equal(plan.results[0]?.rawValue, "59.5");
  assert.equal(plan.candidates[0]?.revision, 5);
  assert.equal(plan.resultStates[0]?.state, "REVISADO");
});

test("partial rows are not published and missing result cells remain partial", async () => {
  const plan = await buildRankingPublicationPlan({
    eventId: "event-1",
    eventStatus: "ACTIVE",
    version: 0,
    proofs,
    registrations,
    results: [result({ status: "PROVISIONAL" })],
  });

  assert.equal(plan.canPublish, false);
  assert.equal(plan.eligibleResultCount, 0);
  assert.equal(plan.partialResultCount, registrations.length * proofs.length);
  assert.equal(plan.resultStates[0]?.state, "PARCIAL");
});

test("ties add one non-blocking advisory while invalid links and exceptions still block", async () => {
  const plan = await buildRankingPublicationPlan({
    eventId: "event-1",
    eventStatus: "ACTIVE",
    version: 0,
    proofs,
    registrations,
    results: [
      result(),
      result({ id: "result-2", registrationId: "rx-b", category: "RX", rawValue: "65.25" }),
      result({ id: "result-3", registrationId: "sc-a", category: "SC", status: "DNS" }),
      result({ id: "result-4", registrationId: "rx-b", category: "RX", proofId: "proof-2", associationValid: false }),
    ],
  });

  assert.equal(plan.canPublish, false);
  assert.ok(plan.issues.some((issue) => issue.code === "TIE_SHARED_PLACEMENT" && !issue.blocking));
  assert.ok(plan.issues.some((issue) => issue.code === "RESULT_ASSOCIATION_INVALID" && issue.blocking));
  assert.ok(plan.issues.some((issue) => issue.code === "EXCEPTION_RULE_PENDING" && issue.blocking));
});

test("event-wide publication permits exact ties and includes shared points in one snapshot", async () => {
  const plan = await buildRankingPublicationPlan({
    eventId: "event-1",
    eventStatus: "ACTIVE",
    version: 0,
    proofs,
    registrations,
    results: [
      result({ id: "result-a", registrationId: "rx-a", rawValue: "65.250", batteryId: "battery-1" }),
      result({ id: "result-b", registrationId: "rx-b", rawValue: "65.25", batteryId: "battery-2" }),
    ],
  });
  const rx = plan.leaderboards.find((board) => board.category === "RX");
  assert.equal(plan.canPublish, true);
  assert.equal(plan.ties.filter((tie) => tie.scope === "PROOF" && tie.proofId === "proof-1").length, 1);
  assert.equal(plan.ties.find((tie) => tie.scope === "PROOF" && tie.proofId === "proof-1")?.exactValue, "65.25");
  assert.equal(plan.issues.filter((issue) => issue.code.startsWith("TIE_")).every((issue) => !issue.blocking), true);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-a")?.proofScores[0]?.points, 1);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-b")?.proofScores[0]?.points, 1);
});

test("publication preview ranks across batteries and categories without manual selection", async () => {
  const conditionProofs = [
    { id: "condition-p1", order: 1, name: "Prova 1", metricType: "LOAD", unit: "kg", direction: "HIGHER" },
    { id: "condition-p2", order: 2, name: "Prova 2", metricType: "REPETITIONS", unit: "reps", direction: "HIGHER" },
    { id: "condition-p3", order: 3, name: "Prova 3", metricType: "TIME", unit: "s", direction: "HIGHER" },
    { id: "condition-p4", order: 4, name: "Condition", metricType: "REPETITIONS", unit: "Distancia Total", direction: "HIGHER" },
  ];
  const activeRegistrations = ["SC", "RX"].flatMap((category) =>
    ["A", "B", "C"].map((team) => ({
      id: `${category.toLowerCase()}-${team}`,
      category,
      teamName: `${category} ${team}`,
      athleteNames: [`Atleta ${team}`],
      laneLabel: null,
      active: true,
    })),
  );
  const results = activeRegistrations.flatMap((registration) => {
    const team = registration.teamName.slice(-1);
    const proofValues = registration.category === "SC"
      ? {
          "condition-p1": { A: 200, B: 100, C: 300 },
          "condition-p2": { A: 100, B: 100, C: 100 },
          "condition-p3": { A: 100, B: 100, C: 100 },
          "condition-p4": { A: "7000.000", B: "7000.001", C: "8000.000" },
        }
      : {
          "condition-p1": { A: 200, B: 100, C: 300 },
          "condition-p2": { A: 100, B: 100, C: 100 },
          "condition-p3": { A: 100, B: 100, C: 100 },
          "condition-p4": { A: "8000.000", B: "7000.000", C: "6000.000" },
        };
    return conditionProofs.map((proof) => result({
      id: `${registration.id}:${proof.id}`,
      registrationId: registration.id,
      category: registration.category,
      proofId: proof.id,
      rawValue: proofValues[proof.id as keyof typeof proofValues][team as "A" | "B" | "C"],
      batteryId: team === "A" ? "battery-1" : "battery-2",
    }));
  });
  const plan = await buildRankingPublicationPlan({
    eventId: "condition-event",
    eventStatus: "FINISHED",
    version: 0,
    proofs: conditionProofs,
    registrations: activeRegistrations,
    results,
  });
  const sc = plan.leaderboards.find((board) => board.category === "SC");
  const rx = plan.leaderboards.find((board) => board.category === "RX");

  assert.equal(plan.canPublish, true, "proof ties and automatic overall order do not require manual choices");
  assert.equal(sc?.entries.find((entry) => entry.registrationId === "sc-C")?.overallPlace, 1);
  assert.equal(sc?.entries.find((entry) => entry.registrationId === "sc-B")?.overallPlace, 2);
  assert.equal(sc?.entries.find((entry) => entry.registrationId === "sc-A")?.overallPlace, 3);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-A")?.overallPlace, 1);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-C")?.overallPlace, 2);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-B")?.overallPlace, 3);
  assert.equal(plan.ties.some((tie) => tie.scope === "OVERALL"), false);
  assert.equal(
    plan.results.find((row) => row.registrationId === "sc-B" && row.proofId === "condition-p4")?.rawValue,
    "7000.001",
    "the stored decimal precision reaches the ranking calculation unchanged",
  );
});

test("equal sum and equal Condition distance remain publishable and keep prior arbitration", async () => {
  const conditionProofs = [
    { id: "condition-p1", order: 1, name: "Prova 1", metricType: "LOAD", unit: "kg", direction: "HIGHER" },
    { id: "condition-p2", order: 2, name: "Prova 2", metricType: "REPETITIONS", unit: "reps", direction: "HIGHER" },
    { id: "condition-p3", order: 3, name: "Prova 3", metricType: "TIME", unit: "s", direction: "HIGHER" },
    { id: "condition-p4", order: 4, name: "Condition", metricType: "REPETITIONS", unit: "Distancia Total", direction: "HIGHER" },
  ];
  const activeRegistrations = ["A", "B", "C"].map((team) => ({
    id: `sc-${team}`, category: "SC", teamName: `Equipe ${team}`, athleteNames: [team], laneLabel: null, active: true,
  }));
  const results = activeRegistrations.flatMap((registration) =>
    conditionProofs.map((proof) => result({
      id: `${registration.id}:${proof.id}`,
      registrationId: registration.id,
      category: "SC",
      proofId: proof.id,
      rawValue: proof.id === "condition-p4"
        ? registration.id === "sc-C" ? "8000.000" : "7000.000"
        : "100",
    })),
  );
  const input = {
    eventId: "condition-event",
    eventStatus: "FINISHED",
    version: 0,
    proofs: conditionProofs,
    registrations: activeRegistrations,
    results,
  };
  const initial = await buildRankingPublicationPlan(input);
  const tie = initial.ties.find((item) => item.scope === "OVERALL");
  assert.ok(tie);
  assert.equal(tie.conditionDistance?.exactValue, "7000");
  assert.equal(initial.canPublish, true, "an exact final tie is a warning, not a publication block");
  assert.ok(initial.issues.some((issue) => issue.code === "TIE_SHARED_PLACEMENT" && !issue.blocking));
  const response = GetZero3RankingPublicationResponse.parse({
    eventId: input.eventId,
    version: initial.version,
    publishedAt: null,
    publishedBy: null,
    eligibleResultCount: initial.eligibleResultCount,
    partialResultCount: initial.partialResultCount,
    affected: initial.affected,
    issues: initial.issues.map((issue) => ({ ...issue, resultId: issue.resultId ?? null })),
    resultStates: initial.resultStates,
    ties: initial.ties,
    leaderboards: initial.leaderboards,
    fingerprint: initial.fingerprint,
    canPublish: initial.canPublish,
  });
  assert.equal(response.leaderboards[0]?.entries.length, 3);
  assert.equal(response.ties.find((item) => item.scope === "OVERALL")?.conditionDistance?.exactValue, "7000");

  const approvedOrder = { key: tie.key, orderedRegistrationIds: ["sc-B", "sc-A"] };
  const republished = await buildRankingPublicationPlan({
    ...input,
    version: 1,
    persistedTieBreaks: [approvedOrder],
  });
  const republishedTie = republished.ties.find((item) => item.scope === "OVERALL");
  assert.equal(republished.canPublish, true);
  assert.deepEqual(republishedTie?.orderedRegistrationIds, ["sc-B", "sc-A"]);
  assert.deepEqual(
    republished.leaderboards[0]?.entries
      .filter((entry) => entry.registrationId === "sc-A" || entry.registrationId === "sc-B")
      .map((entry) => entry.totalPoints),
    [5, 5],
  );
  assert.equal(
    republished.fingerprint,
    (await buildRankingPublicationPlan({ ...input, version: 1, persistedTieBreaks: [approvedOrder] })).fingerprint,
    "repeating the same publication calculation does not accumulate points",
  );
});

test("a new mark from another battery re-ranks already-published results without accumulating points", async () => {
  const eventRegistrations = [...registrations, {
    id: "rx-c",
    category: "RX",
    teamName: "Equipe C",
    athleteNames: ["Atleta C"],
    laneLabel: "P04",
    active: true,
  }];
  const priorA = result({
    id: "result-a",
    registrationId: "rx-a",
    rawValue: "65",
    publishedStatus: "VALIDATED",
    publishedRawValue: "65",
    publishedElapsedMs: 65_000,
    publishedRevision: 2,
    batteryId: "battery-1",
  });
  const priorB = result({
    id: "result-b",
    registrationId: "rx-b",
    rawValue: "66",
    publishedStatus: "VALIDATED",
    publishedRawValue: "66",
    publishedElapsedMs: 66_000,
    publishedRevision: 2,
    batteryId: "battery-1",
  });
  const newResult = result({
    id: "result-c",
    registrationId: "rx-c",
    category: "RX",
    rawValue: "64",
    batteryId: "battery-2",
  });
  const first = await buildRankingPublicationPlan({
    eventId: "event-1", eventStatus: "ACTIVE", version: 5, proofs,
    registrations: eventRegistrations, results: [priorA, priorB, newResult],
  });
  assert.equal(first.canPublish, true);
  const rx = first.leaderboards.find((board) => board.category === "RX");
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-c")?.proofScores[0]?.points, 1);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-a")?.proofScores[0]?.points, 2);
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-b")?.proofScores[0]?.points, 3);

  const publishedRows = [priorA, priorB, newResult].map((row) => ({
    ...row,
    publishedStatus: "VALIDATED",
    publishedRawValue: row.rawValue,
    publishedElapsedMs: row.elapsedMs,
    publishedRevision: row.revision,
  }));
  const repeated = await buildRankingPublicationPlan({
    eventId: "event-1", eventStatus: "ACTIVE", version: 6, proofs,
    registrations: eventRegistrations, results: publishedRows,
  });
  assert.equal(repeated.candidates.length, 0);
  assert.deepEqual(repeated.results, first.results);
  assert.equal(repeated.fingerprint, first.fingerprint);
  assert.equal(repeated.leaderboards.find((board) => board.category === "RX")
    ?.entries.find((entry) => entry.registrationId === "rx-b")?.totalPoints, 3);
});

test("proof ties publish as shared points and reject manual winner selection", async () => {
  const tiedResults = [
    result({ id: "result-a", registrationId: "rx-a", rawValue: "65.25", publishedStatus: "VALIDATED", publishedRawValue: "65.25", publishedElapsedMs: 65_250, publishedRevision: 2 }),
    result({ id: "result-b", registrationId: "rx-b", rawValue: "65.25", publishedStatus: "VALIDATED", publishedRawValue: "65.25", publishedElapsedMs: 65_250, publishedRevision: 2 }),
  ];
  const base = await buildRankingPublicationPlan({
    eventId: "event-1", eventStatus: "ACTIVE", version: 3, proofs, registrations, results: tiedResults,
  });
  const tie = base.ties.find((item) => item.scope === "PROOF" && item.proofId === "proof-1");
  assert.ok(tie);
  assert.equal(base.canPublish, true, "a proof tie needs no manual winner selection");
  assert.equal(base.leaderboards.find((board) => board.category === "RX")
    ?.entries.find((entry) => entry.registrationId === "rx-a")?.proofScores[0]?.points, 1);
  assert.equal(base.leaderboards.find((board) => board.category === "RX")
    ?.entries.find((entry) => entry.registrationId === "rx-b")?.proofScores[0]?.points, 1);
  const resolution = { key: tie.key, orderedRegistrationIds: ["rx-b", "rx-a"] };
  const attemptedManualWinner = await buildRankingPublicationPlan({
    eventId: "event-1", eventStatus: "ACTIVE", version: 3, proofs, registrations, results: tiedResults,
    tieBreaksOverride: [resolution],
  });
  assert.equal(attemptedManualWinner.canPublish, false);
  assert.ok(attemptedManualWinner.issues.some((issue) => issue.code === "TIE_BREAK_RESOLUTION_INVALID" && issue.blocking));
  const reloaded = await buildRankingPublicationPlan({
    eventId: "event-1", eventStatus: "ACTIVE", version: 4, proofs, registrations, results: tiedResults,
    persistedTieBreaks: [resolution],
  });
  assert.equal(reloaded.fingerprint, base.fingerprint, "an older proof decision does not change the new shared-points rule");
  assert.equal(reloaded.ties.find((item) => item.key === tie.key)?.orderedRegistrationIds, null);
});

test("malformed manual ordering is a separate blocking validation", async () => {
  const plan = await buildRankingPublicationPlan({
    eventId: "event-1",
    eventStatus: "ACTIVE",
    version: 0,
    proofs,
    registrations,
    results: [
      result({ id: "result-a", registrationId: "rx-a", rawValue: "65.25" }),
      result({ id: "result-b", registrationId: "rx-b", rawValue: "65.25" }),
    ],
    tieBreaksOverride: [{ key: "not-a-live-tie", orderedRegistrationIds: ["rx-a", "rx-b"] }],
  });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.issues.some((issue) => issue.code === "TIE_BREAK_RESOLUTION_INVALID" && issue.blocking));
});
