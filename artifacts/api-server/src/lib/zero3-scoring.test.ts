import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAllResultPlacements,
  calculateCategoryLeaderboard,
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

test("keeps incomplete teams out of final placement and does not treat a missing proof as zero", () => {
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
  assert.equal(delta?.overallPlace, null);
  assert.equal(delta?.status, "PARTIAL");
});

test("provisional results are visible as progress but do not earn placement points", () => {
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
  assert.equal(alpha?.completedProofs, 4);
  assert.equal(alpha?.overallPlace, null);
});

test("ties without a defined official rule block proof points and final standings", () => {
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
  assert.equal(board.status, "TIE_RULE_PENDING");
  assert.equal(
    board.entries.find((entry) => entry.registrationId === "rx-Alfa")?.proofScores[1]?.points,
    null,
  );
  assert.equal(
    board.entries.find((entry) => entry.registrationId === "rx-Bravo")?.proofScores[1]?.status,
    "TIE_RULE_PENDING",
  );
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
