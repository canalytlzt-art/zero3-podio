import assert from "node:assert/strict";
import test from "node:test";
import { buildRankingPublicationPlan } from "./zero3-ranking-publication";

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
  assert.equal(plan.results[0]?.rawValue, 59.5);
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

test("ties, invalid links, and unconfigured exceptions block publishing", async () => {
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
  assert.ok(plan.issues.some((issue) => issue.code === "TIE_RULE_PENDING" && issue.blocking));
  assert.ok(plan.issues.some((issue) => issue.code === "RESULT_ASSOCIATION_INVALID" && issue.blocking));
  assert.ok(plan.issues.some((issue) => issue.code === "EXCEPTION_RULE_PENDING" && issue.blocking));
});
