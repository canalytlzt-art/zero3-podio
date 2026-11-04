import assert from "node:assert/strict";
import test from "node:test";
import { calculateCategoryLeaderboard, type ScoreProof, type ScoreRegistration } from "./zero3-scoring";
import { buildD1LeaderboardResults, type PublishedBatterySnapshot } from "./d1-staging-ranking";

const proof: ScoreProof = {
  id: "proof-1",
  order: 1,
  name: "Carga",
  metricType: "LOAD",
  unit: "kg",
  direction: "HIGHER",
};

const registrations: ScoreRegistration[] = [
  { id: "rx-a", category: "RX", teamName: "RX A", athleteNames: [], laneLabel: "R01" },
  { id: "rx-b", category: "RX", teamName: "RX B", athleteNames: [], laneLabel: "R02" },
  { id: "rx-c", category: "RX", teamName: "RX C", athleteNames: [], laneLabel: "R03" },
  { id: "sc-a", category: "SC", teamName: "SC A", athleteNames: [], laneLabel: "S01" },
];

const snapshots: PublishedBatterySnapshot[] = [
  {
    proofId: "proof-1",
    resultFingerprint: "battery-1-current",
    currentFingerprint: "battery-1-current",
    resultsJson: JSON.stringify([
      { id: "a-result", registrationId: "rx-a", proofId: "proof-1", category: "RX", rawValue: 100, status: "VALIDATED" },
      { id: "b-result", registrationId: "rx-b", proofId: "proof-1", category: "RX", rawValue: 90, status: "VALIDATED" },
      { id: "sc-result", registrationId: "sc-a", proofId: "proof-1", category: "SC", rawValue: 70, status: "VALIDATED" },
    ]),
  },
  {
    proofId: "proof-1",
    resultFingerprint: "battery-2-old",
    currentFingerprint: "battery-2-corrected",
    resultsJson: JSON.stringify([
      { id: "c-result", registrationId: "rx-c", proofId: "proof-1", category: "RX", rawValue: 80, status: "VALIDATED" },
    ]),
  },
];

const liveResults = [
  { id: "a-result", registrationId: "rx-a", proofId: "proof-1", rawValue: 100, status: "VALIDATED" },
  { id: "b-result", registrationId: "rx-b", proofId: "proof-1", rawValue: 90, status: "VALIDATED" },
  { id: "c-result", registrationId: "rx-c", proofId: "proof-1", rawValue: 110, status: "VALIDATED" },
  { id: "sc-result", registrationId: "sc-a", proofId: "proof-1", rawValue: 70, status: "VALIDATED" },
];

function categoryBoard(results: ReturnType<typeof buildD1LeaderboardResults>, category: string) {
  return calculateCategoryLeaderboard({
    category,
    eventStatus: "ACTIVE",
    proofs: [proof],
    registrations,
    results,
  });
}

test("proof points rank across current published batteries and keep categories separate", () => {
  const results = buildD1LeaderboardResults({
    registrationIds: new Set(registrations.map((registration) => registration.id)),
    liveResults,
    publications: snapshots,
  });
  const rx = categoryBoard(results, "RX");
  const sc = categoryBoard(results, "SC");

  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-a")?.proofScores[0]?.placement, 1);
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-b")?.proofScores[0]?.points, 2);
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-c")?.proofScores[0]?.status, "PUBLICATION_PENDING");
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-c")?.proofScores[0]?.points, null);
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-c")?.completedProofs, 0);
  assert.equal(rx.status, "PARTIAL");
  assert.equal(sc.entries.find((entry) => entry.registrationId === "sc-a")?.proofScores[0]?.placement, 1);
});

test("publishing another battery recomputes proof places across the category", () => {
  const updatedSnapshots = snapshots.map((snapshot) =>
    snapshot.resultFingerprint === "battery-2-old"
      ? {
          ...snapshot,
          resultFingerprint: "battery-2-corrected",
          currentFingerprint: "battery-2-corrected",
          resultsJson: JSON.stringify([
            { id: "c-result", registrationId: "rx-c", proofId: "proof-1", category: "RX", rawValue: 110, status: "VALIDATED" },
          ]),
        }
      : snapshot,
  );
  const results = buildD1LeaderboardResults({
    registrationIds: new Set(registrations.map((registration) => registration.id)),
    liveResults,
    publications: updatedSnapshots,
  });
  const rx = categoryBoard(results, "RX");

  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-c")?.proofScores[0]?.placement, 1);
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-a")?.proofScores[0]?.placement, 2);
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-b")?.proofScores[0]?.placement, 3);
  assert.equal(rx.entries.find((entry) => entry.registrationId === "rx-c")?.proofScores[0]?.points, 1);
});

test("missing exception policy remains visible instead of finalizing points", () => {
  const exception = calculateCategoryLeaderboard({
    category: "RX",
    eventStatus: "FINISHED",
    proofs: [proof],
    registrations,
    results: [
      { id: "a", registrationId: "rx-a", proofId: "proof-1", rawValue: null, status: "DNF" },
      { id: "b", registrationId: "rx-b", proofId: "proof-1", rawValue: 90, status: "VALIDATED" },
    ],
  });
  assert.equal(exception.status, "EXCEPTION_RULE_PENDING");
  assert.equal(exception.entries.find((entry) => entry.registrationId === "rx-a")?.status, "EXCEPTION_RULE_PENDING");
  assert.equal(exception.entries.find((entry) => entry.registrationId === "rx-a")?.proofScores[0]?.points, null);
});

test("snapshot corruption or duplicate published registration fails explicitly", () => {
  const malformed = buildD1LeaderboardResults.bind(null, {
    registrationIds: new Set(registrations.map((registration) => registration.id)),
    liveResults: [],
    publications: [{ ...snapshots[0]!, resultsJson: "not-json" }],
  });
  assert.throws(malformed, /inválida/);

  const duplicate = {
    ...snapshots[0]!,
    resultsJson: JSON.stringify([
      { id: "a1", registrationId: "rx-a", proofId: "proof-1", rawValue: 100, status: "VALIDATED" },
      { id: "a2", registrationId: "rx-a", proofId: "proof-1", rawValue: 101, status: "VALIDATED" },
    ]),
  };
  assert.throws(() => buildD1LeaderboardResults({
    registrationIds: new Set(registrations.map((registration) => registration.id)),
    liveResults: [],
    publications: [duplicate],
  }), /mais de uma bateria/);
});
