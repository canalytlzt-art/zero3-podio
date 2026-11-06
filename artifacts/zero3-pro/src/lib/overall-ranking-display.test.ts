import assert from "node:assert/strict";
import test from "node:test";
import {
  entriesForOverallCategory,
  formatPublishedProofMark,
  overallCategoryLabel,
  overallEntryPublicationState,
  overallProofScorePresentation,
  preferredOverallCategory,
} from "./overall-ranking-display.ts";

const timeProof = {
  id: "proof-1",
  order: 1,
  name: "Arrasto — tempo total",
  metricType: "TIME",
  unit: "s",
};

const score = (overrides: Partial<{
  proofId: string;
  value: number | null;
  status: string;
  placement: number | null;
  points: number | null;
}> = {}) => ({
  proofId: "proof-1",
  value: 72.345,
  status: "VALIDATED",
  placement: 2,
  points: 2,
  ...overrides,
});

const entry = (overrides: Partial<{
  registrationId: string;
  proofScores: ReturnType<typeof score>[];
  proofCount: number;
  status: string;
}> = {}) => ({
  registrationId: "team-1",
  proofScores: [score()],
  proofCount: 1,
  status: "PARTIAL",
  ...overrides,
});

test("maps the existing SC category to Scale without changing its stored key", () => {
  assert.equal(overallCategoryLabel("SC"), "Scale");
  assert.equal(overallCategoryLabel("RX"), "RX");
  assert.equal(preferredOverallCategory(["SC", "RX"]), "SC");
});

test("filters only the selected existing category and preserves its calculated entries", () => {
  const rx = { category: "RX", totalPoints: 1, registrationId: "rx-1" };
  const scale = { category: "SC", totalPoints: 9, registrationId: "sc-1" };
  assert.deepEqual(entriesForOverallCategory([rx, scale], "SC"), [scale]);
  assert.equal(entriesForOverallCategory([rx, scale], "SC")[0]?.totalPoints, 9);
});

test("proof display uses the configured name, published mark, placement and points together", () => {
  assert.deepEqual(overallProofScorePresentation(timeProof, score()), {
    proofName: "Arrasto — tempo total",
    mark: "01:12.35",
    detail: "2º lugar · 2 pontos",
    published: true,
    ranked: true,
  });
  assert.equal(formatPublishedProofMark(102.5, {
    ...timeProof,
    metricType: "DISTANCE",
    unit: "m",
  }), "102,5 m");
});

test("provisional and unpublished marks are hidden rather than shown as official", () => {
  assert.equal(overallProofScorePresentation(timeProof, score({
    value: 99,
    status: "PROVISIONAL",
  })).mark, "—");
  assert.equal(overallProofScorePresentation(timeProof, score({
    value: 99,
    status: "PUBLICATION_PENDING",
  })).mark, "—");
  assert.equal(overallProofScorePresentation(timeProof).mark, "—");
});

test("partial registrations stay partial even when other teams have published results", () => {
  assert.equal(overallEntryPublicationState(entry({
    proofCount: 2,
    proofScores: [score(), score({ proofId: "proof-2", value: null, status: "MISSING", placement: null, points: null })],
  }), []), "partial");
});

test("fully published marks can be shown before the whole event is final", () => {
  assert.equal(overallEntryPublicationState(entry({ status: "PARTIAL" }), [
    { registrationId: "team-1", proofId: "proof-1", revision: 4, publishedRevision: 4 },
  ]), "published");
});

test("a revised but unpublished result keeps the team pending and does not replace the published score", () => {
  const pending = entry({ status: "PARTIAL" });
  const displayed = overallProofScorePresentation(timeProof, pending.proofScores[0]);
  const state = overallEntryPublicationState(pending, [
    { registrationId: "team-1", proofId: "proof-1", revision: 5, publishedRevision: 4 },
  ]);
  assert.equal(state, "pending");
  assert.equal(displayed.mark, "01:12.35");
  assert.equal(displayed.detail, "2º lugar · 2 pontos");
});

test("a pending result for another team does not change this team's publication status", () => {
  assert.equal(overallEntryPublicationState(entry(), [
    { registrationId: "other-team", proofId: "proof-1", revision: 2, publishedRevision: 1 },
  ]), "published");
});
