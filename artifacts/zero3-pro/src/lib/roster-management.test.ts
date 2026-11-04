import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryDisplayName,
  findAthleteRegistrationConflicts,
  normalizeTeamNameInput,
  registrationIdentityEditLock,
  summarizeManagedRegistrations,
  teamNameInputError,
} from "./roster-management.ts";

const registrations = [
  {
    id: "r1", category: "RX", teamName: "Dupla 1", athleteIds: ["a", "b"],
    athleteNames: ["Ana", "Bia"], confirmationStatus: "CONFIRMED",
  },
  {
    id: "r2", category: "SC", teamName: null, athleteIds: ["b", "c"],
    athleteNames: ["Bia", "Caio"], confirmationStatus: "CANCELLED",
  },
];

test("counts active registrations and unique athletes without counting cancelled entries", () => {
  assert.deepEqual(summarizeManagedRegistrations(registrations), {
    registrationCount: 2,
    activeRegistrationCount: 1,
    cancelledRegistrationCount: 1,
    uniqueAthleteCount: 3,
    uniqueActiveAthleteCount: 2,
  });
  assert.deepEqual(summarizeManagedRegistrations([]), {
    registrationCount: 0,
    activeRegistrationCount: 0,
    cancelledRegistrationCount: 0,
    uniqueAthleteCount: 0,
    uniqueActiveAthleteCount: 0,
  });
});

test("warns about existing athlete links, including cancelled history", () => {
  assert.deepEqual(
    findAthleteRegistrationConflicts("b", registrations).map(({ id }) => id),
    ["r1", "r2"],
  );
  assert.deepEqual(findAthleteRegistrationConflicts("", registrations), []);
});

test("allows swaps only when results and published podiums do not lock the registration", () => {
  const original = { category: "RX", athleteIds: ["a", "b"] };
  const changed = { category: "RX", athleteIds: ["a", "c"] };
  assert.equal(registrationIdentityEditLock(original, changed, {
    resultCount: 2, heatEntryCount: 1, podiumCount: 1, sourceCodes: ["RX01"],
  }), "Não é possível trocar atletas ou categoria: esta inscrição tem 2 resultado(s) e 1 pódio(s) publicado(s). A edição comum preserva a identidade histórica da inscrição.");
  assert.equal(registrationIdentityEditLock(original, changed, {
    resultCount: 0, heatEntryCount: 1, podiumCount: 0, sourceCodes: ["RX01"],
  }), null);
});

test("blocks category changes that would invalidate an assigned battery", () => {
  const original = { category: "RX", athleteIds: ["a", "b"] };
  assert.equal(registrationIdentityEditLock(original, { category: "RX", athleteIds: ["b", "a"] }, {
    resultCount: 0, heatEntryCount: 1, podiumCount: 0, sourceCodes: ["RX01"],
  }), null);
  assert.match(registrationIdentityEditLock(original, { category: "SC", athleteIds: ["a", "b"] }, {
    resultCount: 0, heatEntryCount: 1, podiumCount: 0, sourceCodes: [],
  }) ?? "", /categoria atual/);
});

test("uses the event category label while leaving custom names intact", () => {
  assert.equal(categoryDisplayName("SC"), "SC / Scale");
  assert.equal(categoryDisplayName("Master 40+"), "Master 40+");
});

test("normalizes custom team names and validates the 40-character public-display limit", () => {
  assert.equal(normalizeTeamNameInput("  Tropa   do WOD  "), "Tropa do WOD");
  assert.equal(normalizeTeamNameInput("   "), null);
  assert.equal(teamNameInputError("A".repeat(40)), null);
  assert.match(teamNameInputError("A".repeat(41)) ?? "", /40 caracteres/);
  assert.match(teamNameInputError("<Tropa>") ?? "", /caracteres/);
  assert.match(teamNameInputError("Tropa\nWOD") ?? "", /caracteres/);
});

test("allows display-name changes without changing podium-linked registration identity", () => {
  assert.equal(registrationIdentityEditLock(
    { category: "RX", athleteIds: ["a", "b"] },
    { category: "RX", athleteIds: ["a", "b"], teamName: "Novo nome" },
    { resultCount: 1, heatEntryCount: 1, podiumCount: 1, sourceCodes: [] },
  ), null);
});
