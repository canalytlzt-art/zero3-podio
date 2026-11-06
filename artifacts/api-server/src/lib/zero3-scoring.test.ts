import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAllResultPlacements,
  calculateCategoryLeaderboard,
  mergeRankingPodiums,
  rankingPodiumsFromLeaderboards,
  scoreTieBreaksFromSnapshot,
  type ScoreProof,
  type ScoreRegistration,
  type ScoreResult,
} from "./zero3-scoring.js";

const proofs: ScoreProof[] = [
  { id: "p1", order: 1, name: "Prova demo 1", metricType: "TIME", unit: "s", direction: "LOWER" },
  { id: "p2", order: 2, name: "Prova demo 2", metricType: "REPETITIONS", unit: "reps", direction: "HIGHER" },
  { id: "p3", order: 3, name: "Prova demo 3", metricType: "LOAD", unit: "kg", direction: "HIGHER" },
  { id: "p4", order: 4, name: "Prova demo 4", metricType: "CUSTOM", unit: "pontos", direction: "HIGHER" },
];

const registrations: ScoreRegistration[] = [
  ...["Alfa", "Bravo", "Charlie", "Delta", "Echo"].map((teamName) => ({
    id: `sc-${teamName}`,
    category: "SC",
    teamName,
    athleteNames: [`Atleta ${teamName}`],
    laneLabel: null,
  })),
  ...["Alfa", "Bravo", "Charlie", "Delta", "Echo"].map((teamName) => ({
    id: `rx-${teamName}`,
    category: "RX",
    teamName,
    athleteNames: [`Atleta RX ${teamName}`],
    laneLabel: null,
  })),
];

const rankByCategory: Record<string, number[][]> = {
  SC: [
    [1, 2, 3, 5],
    [2, 1, 2, 1],
    [3, 3, 1, 4],
    [4, 4, 4, 3],
    [5, 5, 5, 2],
  ],
  RX: [
    [1, 1, 1, 1],
    [2, 2, 2, 2],
    [3, 3, 3, 3],
    [4, 4, 4, 4],
    [5, 5, 5, 5],
  ],
};

function resultRows(): ScoreResult[] {
  const categoryIndex: Record<string, number> = { SC: 0, RX: 0 };
  return registrations.flatMap((registration) => {
    const teamIndex = categoryIndex[registration.category] ?? 0;
    categoryIndex[registration.category] = teamIndex + 1;
    const ranks = rankByCategory[registration.category]?.[teamIndex];
    assert.ok(ranks);
    return proofs.map((proof, proofIndex) => {
      const rank = ranks[proofIndex];
      assert.ok(rank);
      const value =
        proof.direction === "LOWER" ? rank : registrations.length / 2 + 0.5 - rank;
      return {
        id: `${registration.id}-${proof.id}`,
        registrationId: registration.id,
        proofId: proof.id,
        rawValue: value,
        status: "VALIDATED",
      };
    });
  });
}

const conditionProofs: ScoreProof[] = [
  { id: "condition-p1", order: 1, name: "Prova 1", metricType: "LOAD", unit: "kg", direction: "HIGHER" },
  { id: "condition-p2", order: 2, name: "Prova 2", metricType: "REPETITIONS", unit: "reps", direction: "HIGHER" },
  { id: "condition-p3", order: 3, name: "Prova 3", metricType: "TIME", unit: "s", direction: "HIGHER" },
  { id: "condition-p4", order: 4, name: "Condition", metricType: "REPETITIONS", unit: "Distancia Total", direction: "HIGHER" },
];

const conditionRegistrations: ScoreRegistration[] = ["A", "B", "C"].map((name) => ({
  id: `condition-${name}`,
  category: "SC",
  teamName: `Equipe ${name}`,
  athleteNames: [`Atleta ${name}`],
  laneLabel: null,
}));

function conditionResults(
  distances: Record<string, string | number>,
  options: { sharedFirstThree?: boolean; missingConditionFor?: string } = {},
): ScoreResult[] {
  const values: Record<string, Record<string, string | number>> = options.sharedFirstThree
    ? {
        "condition-p1": { A: 100, B: 100, C: 100 },
        "condition-p2": { A: 100, B: 100, C: 100 },
        "condition-p3": { A: 100, B: 100, C: 100 },
        "condition-p4": distances,
      }
    : {
        "condition-p1": { C: 300, A: 200, B: 100 },
        "condition-p2": { A: 100, B: 100, C: 100 },
        "condition-p3": { A: 100, B: 100, C: 100 },
        "condition-p4": distances,
      };
  return conditionRegistrations.flatMap((registration) =>
    conditionProofs.flatMap((proof) => {
      if (proof.id === "condition-p4" && registration.id === options.missingConditionFor) {
        return [];
      }
      const team = registration.id.slice(-1);
      return [{
        id: `${registration.id}:${proof.id}`,
        registrationId: registration.id,
        proofId: proof.id,
        rawValue: values[proof.id]?.[team] ?? null,
        status: "VALIDATED",
      }];
    }),
  );
}

test("calculates placement points across four proofs, including a 15-point total", () => {
  const result = calculateAllResultPlacements({
    categories: ["SC", "RX"],
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results: resultRows(),
  });
  const delta = result.leaderboards
    .find((board) => board.category === "SC")
    ?.entries.find((entry) => entry.teamName === "Delta");
  assert.equal(delta?.totalPoints, 15);
  assert.equal(delta?.completedProofs, 4);
  assert.equal(delta?.proofScores.map((score) => score.points).join(","), "4,4,4,3");

  const rx = result.leaderboards.find((board) => board.category === "RX");
  assert.equal(rx?.status, "FINAL");
  assert.equal(rx?.entries[0]?.teamName, "Alfa");
  assert.equal(rx?.entries[0]?.totalPoints, 4);
  assert.equal(rx?.entries[0]?.overallPlace, 1);
});

test("gives incomplete teams a provisional placement based only on scored proofs", () => {
  const results = resultRows().filter((result) => result.id !== "rx-Delta-p4");
  const board = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results,
  });
  const delta = board.entries.find((entry) => entry.registrationId === "rx-Delta");
  assert.equal(delta?.completedProofs, 3);
  assert.equal(delta?.proofScores[3]?.status, "MISSING");
  assert.equal(delta?.overallPlace, 3);
  assert.equal(delta?.status, "PARTIAL");
});

test("provisional proof results earn no points while existing official points can still rank partially", () => {
  const results = resultRows();
  const provisional = results.find((result) => result.id === "rx-Alfa-p1");
  assert.ok(provisional);
  provisional.status = "PROVISIONAL";
  const board = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results,
  });
  const alpha = board.entries.find((entry) => entry.registrationId === "rx-Alfa");
  assert.equal(alpha?.proofScores[0]?.status, "PROVISIONAL");
  assert.equal(alpha?.proofScores[0]?.points, null);
  assert.equal(alpha?.completedProofs, 3);
  assert.equal(alpha?.overallPlace, 1);
});

test("exact proof ties share place and points without blocking the ranking", () => {
  const results = resultRows();
  const tie = results.find((result) => result.id === "rx-Bravo-p2");
  assert.ok(tie);
  tie.rawValue = results.find((result) => result.id === "rx-Alfa-p2")?.rawValue ?? null;
  const board = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results,
  });
  assert.equal(board.status, "FINAL");
  assert.equal(board.entries.find((entry) => entry.registrationId === "rx-Alfa")?.proofScores[1]?.points, 1);
  assert.equal(board.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[1]?.points, 1);
  assert.equal(board.entries.find((entry) => entry.registrationId === "rx-Charlie")?.proofScores[1]?.points, 3);
  assert.equal(
    board.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[1]?.status,
    "VALIDATED",
  );
  assert.equal(board.ties.filter((tie) => tie.scope === "PROOF" && tie.proofId === "p2").length, 1);
});

test("proof ties keep shared points even when a historical manual proof order is supplied", () => {
  const results = resultRows();
  const bravo = results.find((result) => result.id === "rx-Bravo-p2");
  const alpha = results.find((result) => result.id === "rx-Alfa-p2");
  assert.ok(bravo && alpha);
  bravo.rawValue = alpha.rawValue;
  const input = { eventId: "event-1", category: "RX", eventStatus: "FINISHED", proofs, registrations, results };
  const unresolved = calculateCategoryLeaderboard(input);
  const tie = unresolved.ties.find((item) => item.scope === "PROOF" && item.proofId === "p2");
  assert.ok(tie);
  const resolution = { key: tie.key, orderedRegistrationIds: ["rx-Bravo", "rx-Alfa"] };
  const adjudicated = calculateCategoryLeaderboard({ ...input, tieBreaks: [resolution] });
  assert.equal(adjudicated.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[1]?.points, 1);
  assert.equal(adjudicated.entries.find((entry) => entry.registrationId === "rx-Alfa")?.proofScores[1]?.points, 1);
  assert.equal(adjudicated.ties.find((item) => item.key === tie.key)?.orderedRegistrationIds, null);
  assert.deepEqual(scoreTieBreaksFromSnapshot([adjudicated]), []);
  const republished = calculateCategoryLeaderboard({
    ...input,
    tieBreaks: scoreTieBreaksFromSnapshot([adjudicated]),
  });
  assert.equal(republished.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[1]?.points, 1);
  assert.equal(republished.entries.find((entry) => entry.registrationId === "rx-Alfa")?.proofScores[1]?.points, 1);
  const otherEvent = calculateCategoryLeaderboard({
    ...input,
    eventId: "event-2",
    tieBreaks: [resolution],
  });
  assert.notEqual(otherEvent.ties.find((item) => item.scope === "PROOF" && item.proofId === "p2")?.key, tie.key);
  assert.equal(otherEvent.entries.find((entry) => entry.registrationId === "rx-Alfa")?.proofScores[1]?.points, 1);
  assert.equal(otherEvent.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[1]?.points, 1);
});

test("recomputes from corrected values rather than accumulating old points", () => {
  const original = resultRows();
  const corrected = original.map((result) =>
    result.id === "rx-Bravo-p1" ? { ...result, rawValue: 0.5 } : result,
  );
  const first = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results: original,
  });
  const second = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results: corrected,
  });
  assert.equal(first.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[0]?.points, 2);
  assert.equal(second.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[0]?.points, 1);
  assert.equal(second.entries.find((entry) => entry.registrationId === "rx-Bravo")?.totalPoints, 7);
});

test("an overall point tie shares the place and does not block the final ranking", () => {
  const ranksByProof = [
    [1, 2, 3, 4, 5],
    [2, 1, 3, 4, 5],
    [3, 4, 1, 2, 5],
    [4, 3, 1, 2, 5],
  ];
  const scRegistrations = registrations.filter((registration) => registration.category === "SC");
  const results = scRegistrations.flatMap((registration, teamIndex) =>
    proofs.map((proof, proofIndex) => {
      const rank = ranksByProof[proofIndex]?.[teamIndex];
      assert.ok(rank !== undefined);
      return {
        id: `${registration.id}-${proof.id}`,
        registrationId: registration.id,
        proofId: proof.id,
        rawValue: proof.direction === "LOWER" ? rank : 6 - rank,
        status: "VALIDATED",
      };
    }),
  );
  const board = calculateCategoryLeaderboard({
    category: "SC",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results,
  });
  const alfa=board.entries.find((entry)=>entry.teamName==="Alfa");
  const bravo=board.entries.find((entry)=>entry.teamName==="Bravo");
  assert.equal(board.status, "FINAL");
  assert.equal(alfa?.totalPoints,10);
  assert.equal(bravo?.totalPoints,10);
  assert.equal(alfa?.status,"FINAL");
  assert.equal(alfa?.overallPlace, 2);
  assert.equal(bravo?.overallPlace, 2);
  assert.equal(board.ties.filter((tie) => tie.scope === "OVERALL").length, 1);
});

test("lower final sum beats a larger Condition distance; equal sums use the exact Condition distance", () => {
  const board = calculateCategoryLeaderboard({
    eventId: "condition-event",
    category: "SC",
    eventStatus: "FINISHED",
    proofs: conditionProofs,
    registrations: conditionRegistrations,
    results: conditionResults({ A: "7000.000", B: "7000.001", C: "8000.000" }),
  });
  const entry = (id: string) => board.entries.find((item) => item.registrationId === `condition-${id}`);
  const c = entry("C");
  const b = entry("B");
  const a = entry("A");

  assert.equal(c?.totalPoints, 4);
  assert.equal(c?.overallPlace, 1, "the lowest total stays first even though C has the greatest distance");
  assert.equal(a?.totalPoints, 7);
  assert.equal(b?.totalPoints, 7);
  assert.equal(b?.overallPlace, 2);
  assert.equal(a?.overallPlace, 3, "the exact 0.001 distance difference orders B ahead of A");
  assert.equal(board.ties.some((tie) => tie.scope === "OVERALL"), false);
  assert.deepEqual(b?.proofScores.map((score) => score.points), [3, 1, 1, 2]);
});

test("Condition tie-breaks stay independent between RX and SC", () => {
  const rxRegistrations = conditionRegistrations.map((registration) => ({
    ...registration,
    id: registration.id.replace("condition-", "rx-condition-"),
    category: "RX",
  }));
  const rxRows = conditionResults({ A: "8000", B: "7000", C: "6000" }).map((result) => ({
    ...result,
    id: result.id.replace("condition-", "rx-condition-"),
    registrationId: result.registrationId.replace("condition-", "rx-condition-"),
  }));
  const results = calculateAllResultPlacements({
    eventId: "condition-event",
    categories: ["SC", "RX"],
    eventStatus: "FINISHED",
    proofs: conditionProofs,
    registrations: [...conditionRegistrations, ...rxRegistrations],
    results: [
      ...conditionResults({ A: "7000", B: "7001", C: "8000" }),
      ...rxRows,
    ],
  });
  const sc = results.leaderboards.find((board) => board.category === "SC");
  const rx = results.leaderboards.find((board) => board.category === "RX");
  assert.equal(sc?.entries[0]?.registrationId, "condition-C");
  assert.equal(sc?.entries.find((entry) => entry.registrationId === "condition-B")?.overallPlace, 2);
  assert.equal(rx?.entries[0]?.registrationId, "rx-condition-A");
  assert.equal(rx?.entries.find((entry) => entry.registrationId === "rx-condition-C")?.overallPlace, 2);
});

test("the final overall tie remains shared when Condition distances are exactly equal", () => {
  const results = conditionResults(
    { A: "7000.000", B: "7000.000", C: "8000.000" },
    { sharedFirstThree: true },
  );
  const board = calculateCategoryLeaderboard({
    eventId: "condition-event",
    category: "SC",
    eventStatus: "FINISHED",
    proofs: conditionProofs,
    registrations: conditionRegistrations,
    results,
  });
  const tie = board.ties.find((item) => item.scope === "OVERALL");
  assert.ok(tie);
  assert.deepEqual(tie.registrationIds, ["condition-A", "condition-B"]);
  assert.deepEqual(tie.conditionDistance, {
    proofId: "condition-p4",
    proofName: "Condition",
    proofOrder: 4,
    unit: "Distancia Total",
    exactValue: "7000",
  });
  assert.equal(board.entries.find((item) => item.registrationId === "condition-A")?.overallPlace, 2);
  assert.equal(board.entries.find((item) => item.registrationId === "condition-B")?.overallPlace, 2);
});

test("manual arbitration remains optional and applies only to the persistent final tie", () => {
  const input = {
    eventId: "condition-event",
    category: "SC",
    eventStatus: "FINISHED",
    proofs: conditionProofs,
    registrations: conditionRegistrations,
    results: conditionResults(
      { A: "7000", B: "7000", C: "8000" },
      { sharedFirstThree: true },
    ),
  };
  const unresolved = calculateCategoryLeaderboard(input);
  const tie = unresolved.ties.find((item) => item.scope === "OVERALL");
  assert.ok(tie);
  const resolved = calculateCategoryLeaderboard({
    ...input,
    tieBreaks: [{ key: tie.key, orderedRegistrationIds: ["condition-B", "condition-A"] }],
  });
  const a = resolved.entries.find((item) => item.registrationId === "condition-A");
  const b = resolved.entries.find((item) => item.registrationId === "condition-B");
  assert.equal(a?.overallPlace, 3);
  assert.equal(b?.overallPlace, 2);
  assert.equal(a?.totalPoints, b?.totalPoints);
  assert.deepEqual(a?.proofScores.map((score) => score.points), [1, 1, 1, 2]);
  assert.deepEqual(b?.proofScores.map((score) => score.points), [1, 1, 1, 2]);
});

test("Condition distance does not break partial standings or treat a missing result as zero", () => {
  const partial = calculateCategoryLeaderboard({
    category: "SC",
    eventStatus: "ACTIVE",
    proofs: conditionProofs,
    registrations: conditionRegistrations,
    results: conditionResults({ A: "7000", B: "7000.001", C: "8000" }),
  });
  const partialA = partial.entries.find((item) => item.registrationId === "condition-A");
  const partialB = partial.entries.find((item) => item.registrationId === "condition-B");
  assert.equal(partialA?.status, "PARTIAL");
  assert.equal(partialA?.overallPlace, partialB?.overallPlace, "an active event keeps the existing shared provisional tie");

  const missing = calculateCategoryLeaderboard({
    category: "SC",
    eventStatus: "FINISHED",
    proofs: conditionProofs,
    registrations: conditionRegistrations,
    results: conditionResults(
      { A: "7000", B: "7000", C: "8000" },
      { sharedFirstThree: true, missingConditionFor: "condition-A" },
    ),
  });
  const missingA = missing.entries.find((item) => item.registrationId === "condition-A");
  assert.equal(missingA?.completedProofs, 3);
  assert.equal(missingA?.proofScores[3]?.value, null);
  assert.equal(missingA?.proofScores[3]?.status, "MISSING");
  assert.notEqual(missingA?.status, "FINAL");
});

test("Condition tie-break requires an explicit distance unit, not a repetitions unit", () => {
  const proofsWithoutDistanceUnit = conditionProofs.map((proof) =>
    proof.id === "condition-p4" ? { ...proof, unit: "Reps" } : proof,
  );
  const board = calculateCategoryLeaderboard({
    eventId: "condition-event",
    category: "SC",
    eventStatus: "FINISHED",
    proofs: proofsWithoutDistanceUnit,
    registrations: conditionRegistrations,
    results: conditionResults(
      { A: "7000", B: "7000", C: "8000" },
      { sharedFirstThree: true },
    ),
  });
  const tie = board.ties.find((item) => item.scope === "OVERALL");
  assert.ok(tie);
  assert.equal(tie.conditionDistance, undefined);
  assert.equal(board.entries.find((item) => item.registrationId === "condition-A")?.overallPlace, 2);
  assert.equal(board.entries.find((item) => item.registrationId === "condition-B")?.overallPlace, 2);
});

test("manual overall order is not available for final ties without a verified distance Condition", () => {
  const ranksByProof = [
    [1, 2, 3, 4, 5],
    [2, 1, 3, 4, 5],
    [3, 4, 1, 2, 5],
    [4, 3, 1, 2, 5],
  ];
  const scRegistrations = registrations.filter((registration) => registration.category === "SC");
  const results = scRegistrations.flatMap((registration, teamIndex) =>
    proofs.map((proof, proofIndex) => {
      const rank = ranksByProof[proofIndex]?.[teamIndex];
      assert.ok(rank !== undefined);
      return {
        id: `${registration.id}-${proof.id}`,
        registrationId: registration.id,
        proofId: proof.id,
        rawValue: proof.direction === "LOWER" ? rank : 6 - rank,
        status: "VALIDATED",
      };
    }),
  );
  const input = { category: "SC", eventStatus: "FINISHED", proofs, registrations, results };
  const unresolved = calculateCategoryLeaderboard(input);
  const tie = unresolved.ties.find((item) => item.scope === "OVERALL" && item.value === 10);
  assert.ok(tie);
  const resolved = calculateCategoryLeaderboard({
    ...input,
    tieBreaks: [{ key: tie.key, orderedRegistrationIds: ["sc-Bravo", "sc-Alfa"] }],
  });
  assert.equal(resolved.entries.find((entry) => entry.registrationId === "sc-Bravo")?.overallPlace, 2);
  assert.equal(resolved.entries.find((entry) => entry.registrationId === "sc-Alfa")?.overallPlace, 2);
  assert.equal(resolved.entries.find((entry) => entry.registrationId === "sc-Bravo")?.totalPoints, 10);
  assert.equal(resolved.entries.find((entry) => entry.registrationId === "sc-Alfa")?.totalPoints, 10);
});

test("partial event rankings expose current overall places before event completion", () => {
  const board = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "ACTIVE",
    proofs,
    registrations,
    results: resultRows(),
  });
  assert.equal(board.status, "PARTIAL");
  assert.deepEqual(
    board.entries.map((entry) => [entry.registrationId, entry.totalPoints, entry.overallPlace]),
    [
      ["rx-Alfa", 4, 1],
      ["rx-Bravo", 8, 2],
      ["rx-Charlie", 12, 3],
      ["rx-Delta", 16, 4],
      ["rx-Echo", 20, 5],
    ],
  );
});

test("partial overall ties share a provisional place instead of an arbitrary order", () => {
  const results = resultRows().filter((result) =>
    result.registrationId.startsWith("rx-") &&
    ["p1", "p2"].includes(result.proofId ?? ""),
  );
  const p2Values: Record<string, number> = {
    "rx-Alfa": 1.5,
    "rx-Bravo": 2.5,
    "rx-Charlie": 4.5,
    "rx-Delta": 3.5,
    "rx-Echo": 0.5,
  };
  for (const result of results) {
    if (result.proofId === "p2") result.rawValue = p2Values[result.registrationId] ?? null;
  }
  const board = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "ACTIVE",
    proofs,
    registrations,
    results,
  });
  const alpha = board.entries.find((entry) => entry.registrationId === "rx-Alfa");
  const bravo = board.entries.find((entry) => entry.registrationId === "rx-Bravo");
  assert.equal(alpha?.totalPoints, 5);
  assert.equal(bravo?.totalPoints, 5);
  assert.equal(alpha?.overallPlace, 2);
  assert.equal(bravo?.overallPlace, 2);
});

test("unrounded marks remain distinct and missing values do not create false ties", () => {
  const twoRegistrations = registrations.filter((registration) => registration.category === "RX").slice(0, 2);
  const proof = proofs[0]!;
  const distinct = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "ACTIVE",
    proofs: [proof],
    registrations: twoRegistrations,
    results: [
      { id: "precise-1", registrationId: twoRegistrations[0]!.id, proofId: proof.id, rawValue: "65.251", status: "VALIDATED" },
      { id: "precise-2", registrationId: twoRegistrations[1]!.id, proofId: proof.id, rawValue: "65.254", status: "VALIDATED" },
    ],
  });
  assert.equal(distinct.ties.length, 0);
  assert.deepEqual(distinct.entries.map((entry) => entry.proofScores[0]?.points), [1, 2]);
  const missing = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "ACTIVE",
    proofs: [proof],
    registrations: twoRegistrations,
    results: [
      { id: "only-one-mark", registrationId: twoRegistrations[0]!.id, proofId: proof.id, rawValue: "65.251", status: "VALIDATED" },
    ],
  });
  assert.equal(missing.ties.length, 0);
  assert.equal(missing.entries.find((entry) => entry.registrationId === twoRegistrations[1]!.id)?.proofScores[0]?.status, "MISSING");

  const beyondFloatPrecision = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "ACTIVE",
    proofs: [proof],
    registrations: twoRegistrations,
    results: [
      { id: "large-1", registrationId: twoRegistrations[0]!.id, proofId: proof.id, rawValue: "9007199254740992", status: "VALIDATED" },
      { id: "large-2", registrationId: twoRegistrations[1]!.id, proofId: proof.id, rawValue: "9007199254740993", status: "VALIDATED" },
    ],
  });
  assert.equal(beyondFloatPrecision.ties.length, 0);
  assert.deepEqual(beyondFloatPrecision.entries.map((entry) => entry.proofScores[0]?.points), [1, 2]);
});

test("a validated zero is retained as a cancelled proof exception and never earns points", () => {
  const pair = registrations.filter((registration) => registration.category === "RX").slice(0, 2);
  for (const direction of ["LOWER", "HIGHER"] as const) {
    const proof = { ...proofs[0]!, direction };
    const board = calculateCategoryLeaderboard({
      category: "RX",
      eventStatus: "FINISHED",
      proofs: [proof],
      registrations: pair,
      results: [
        { id: `cancelled-${direction}`, registrationId: pair[0]!.id, proofId: proof.id, rawValue: "0.000", status: "VALIDATED" },
        { id: `valid-${direction}`, registrationId: pair[1]!.id, proofId: proof.id, rawValue: 10, status: "VALIDATED" },
      ],
    });

    const cancelled = board.entries.find((entry) => entry.registrationId === pair[0]!.id)!;
    const valid = board.entries.find((entry) => entry.registrationId === pair[1]!.id)!;
    assert.equal(cancelled.proofScores[0]?.value, 0, "the recorded zero remains visible");
    assert.equal(cancelled.proofScores[0]?.status, "DNF");
    assert.equal(cancelled.proofScores[0]?.points, null);
    assert.equal(cancelled.proofScores[0]?.placement, null);
    assert.equal(cancelled.status, "EXCEPTION_RULE_PENDING");
    assert.equal(valid.proofScores[0]?.placement, 1);
    assert.equal(valid.proofScores[0]?.points, 1);
    assert.equal(board.status, "EXCEPTION_RULE_PENDING");
  }
});

test("event-wide places include all 13 registrations instead of restarting by battery", () => {
  const thirteen = Array.from({ length: 13 }, (_, index) => ({
    id: `registration-${String(index + 1).padStart(2, "0")}`,
    category: "SC",
    teamName: `Equipe ${index + 1}`,
    athleteNames: [],
    laneLabel: null,
  }));
  const proof = proofs[0]!;
  const board = calculateCategoryLeaderboard({
    category: "SC",
    eventStatus: "ACTIVE",
    proofs: [proof],
    registrations: thirteen,
    results: thirteen.map((registration, index) => ({
      id: `result-${registration.id}`,
      registrationId: registration.id,
      proofId: proof.id,
      rawValue: 100 + index,
      status: "VALIDATED",
    })),
  });
  const last = board.entries.find((entry) => entry.registrationId === "registration-13");
  assert.equal(last?.proofScores[0]?.placement, 13);
  assert.equal(last?.proofScores[0]?.points, 13);
});

test("four proof placements 13, 4, 7, and 2 sum to 26 event points", () => {
  const targetPlacements = [13, 4, 7, 2];
  const thirteen = Array.from({ length: 13 }, (_, index) => ({
    id: `rx-registration-${String(index + 1).padStart(2, "0")}`,
    category: "RX",
    teamName: `Equipe ${index + 1}`,
    athleteNames: [],
    laneLabel: `P${String(index + 1).padStart(2, "0")}`,
  }));
  const results = thirteen.flatMap((registration, teamIndex) =>
    proofs.map((proof, proofIndex) => {
      const targetPlace = targetPlacements[proofIndex]!;
      const place = teamIndex === 12
        ? targetPlace
        : teamIndex < targetPlace - 1
          ? teamIndex + 1
          : teamIndex + 2;
      return {
        id: `${registration.id}:${proof.id}`,
        registrationId: registration.id,
        proofId: proof.id,
        rawValue: proof.direction === "LOWER" ? place : 14 - place,
        status: "VALIDATED",
      };
    }),
  );
  const board = calculateCategoryLeaderboard({
    eventId: "event-13",
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations: thirteen,
    results,
  });
  const target = board.entries.find((entry) => entry.registrationId === "rx-registration-13");
  assert.deepEqual(target?.proofScores.map((score) => score.points), targetPlacements);
  assert.equal(target?.totalPoints, 26);
});

test("event podium defaults to the category leaderboard and keeps shared places", () => {
  const podiums = rankingPodiumsFromLeaderboards([{
    category: "RX",
    entries: [
      { registrationId: "rx-a", teamName: "Equipe A", athleteNames: ["Atleta A"], overallPlace: 1, totalPoints: 4 },
      { registrationId: "rx-b", teamName: "Equipe B", athleteNames: ["Atleta B"], overallPlace: 1, totalPoints: 4 },
      { registrationId: "rx-c", teamName: "Equipe C", athleteNames: ["Atleta C"], overallPlace: 3, totalPoints: 6 },
      { registrationId: "rx-d", teamName: "Equipe D", athleteNames: ["Atleta D"], overallPlace: 4, totalPoints: 8 },
      { registrationId: "rx-pending", teamName: "Pendente", athleteNames: [], overallPlace: null, totalPoints: null },
    ],
  }]);
  assert.deepEqual(podiums, [{
    category: "RX",
    places: [
      { place: 1, registrationId: "rx-a", teamName: "Equipe A", athleteNames: ["Atleta A"] },
      { place: 1, registrationId: "rx-b", teamName: "Equipe B", athleteNames: ["Atleta B"] },
      { place: 3, registrationId: "rx-c", teamName: "Equipe C", athleteNames: ["Atleta C"] },
    ],
  }]);
});

test("manually published podium overrides only its event category presentation", () => {
  const calculated = [
    { category: "SC", places: [{ place: 1, registrationId: "sc-rank", teamName: "Classificada", athleteNames: ["Atleta"] }] },
    { category: "RX", places: [{ place: 1, registrationId: "rx-rank", teamName: "RX classificada", athleteNames: ["Atleta RX"] }] },
  ];
  const manual = [{
    category: "SC",
    places: [{ place: 1, registrationId: "sc-manual", teamName: "Indicação manual", athleteNames: ["Atleta 2"] }],
    arbitrationNote: "Homologado pela arbitragem.",
    placeObservations: [{ place: 1, registrationId: "sc-manual", note: "Observação do premiado." }],
  }];
  assert.deepEqual(mergeRankingPodiums(calculated, manual), [
    ...manual,
    calculated[1],
  ]);
  assert.equal(mergeRankingPodiums(calculated, manual)[0]?.arbitrationNote, "Homologado pela arbitragem.");
  assert.deepEqual(mergeRankingPodiums(calculated, manual)[0]?.placeObservations, manual[0]?.placeObservations);
  assert.equal(calculated[0]?.places[0]?.registrationId, "sc-rank");
});

test("DNS/DNF without an event exception rule cannot make the classification final", () => {
  const results = resultRows().filter((result) => result.registrationId !== "rx-Delta");
  results.push({
    id: "rx-Delta-p1",
    registrationId: "rx-Delta",
    proofId: "p1",
    rawValue: null,
    status: "DNF",
  });
  const board = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs,
    registrations,
    results,
  });
  const delta = board.entries.find((entry) => entry.registrationId === "rx-Delta");
  assert.equal(board.status, "EXCEPTION_RULE_PENDING");
  assert.equal(delta?.status, "EXCEPTION_RULE_PENDING");
  assert.equal(delta?.completedProofs, 0);
  assert.equal(delta?.totalPoints, null);
});
