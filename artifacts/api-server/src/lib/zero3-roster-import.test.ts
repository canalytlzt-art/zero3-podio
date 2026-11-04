import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateZero3RegistrationBody,
  UpdateZero3RosterManagementBody,
} from "@workspace/api-zod";
import {
  buildRosterImportPlan,
  changedRosterManagementFields,
  rosterIdentityChanged,
  rosterIdentityChanges,
  rosterIdentityEditConflict,
  rosterSourceContentHash,
  validateRosterManagementEdit,
} from "./zero3-roster-import";

const event = {
  id: "event-test",
  name: "ZERO3 Games — Teste",
  proofName: "Prova 1",
  status: "PLANNED" as const,
  preparationSeconds: 10,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function plan(
  overrides: Partial<Parameters<typeof buildRosterImportPlan>[0]> = {},
) {
  return buildRosterImportPlan({
    event,
    environment: "Development isolado",
    existingAthletes: [],
    existingRegistrations: [],
    resolutions: [],
    scaleTargetCategory: "SC",
    contentHash: "source-hash",
    ...overrides,
  });
}

describe("ZERO3 roster import planning", () => {
  it("creates a stable SHA-256 source digest in the Worker-compatible runtime", async () => {
    const first = await rosterSourceContentHash();
    const second = await rosterSourceContentHash();
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(second, first);
  });

  it("predicts 58 people and 29 paid, confirmed teams on an empty base", () => {
    const preview = plan();
    assert.deepEqual(preview.counts, {
      sourcePeople: 58,
      sourceTeams: 29,
      peopleToCreate: 58,
      peopleToReuse: 0,
      unresolvedPeople: 0,
      teamsToCreate: 29,
      teamsToReuse: 0,
      conflicts: 0,
    });
    assert.equal(preview.teams.filter((team) => team.targetCategory === "RX").length, 16);
    assert.equal(preview.teams.filter((team) => team.targetCategory === "SC").length, 13);
    assert.ok(preview.teams.every(
      (team) => team.confirmationStatus === "CONFIRMED" && team.paymentStatus === "PAID",
    ));
  });

  it("requires an explicit decision when a similar existing athlete is found", () => {
    const candidate = { id: "existing-gabriel", fullName: "Gabriel Lorenzetti" };
    const initial = plan({ existingAthletes: [candidate] });
    const gabriel = initial.people.find((person) => person.fullName === "Gabriel");
    assert.equal(gabriel?.resolutionAction, null);
    assert.equal(gabriel?.resolvedAthleteId, null);
    assert.equal(initial.counts.unresolvedPeople, 1);

    const resolved = plan({
      existingAthletes: [candidate],
      resolutions: [{ sourceKey: "RX-15:2", action: "REUSE", athleteId: candidate.id }],
    });
    assert.equal(
      resolved.people.find((person) => person.sourceKey === "RX-15:2")?.resolvedAthleteId,
      candidate.id,
    );
    assert.equal(resolved.counts.unresolvedPeople, 0);
  });

  it("never reuses a candidate ID for a different source person", () => {
    assert.throws(
      () => plan({
        existingAthletes: [{ id: "same-id", fullName: "Flavio Montiel Ana Lucena" }],
        resolutions: [
          { sourceKey: "RX-01:1", action: "REUSE", athleteId: "same-id" },
          { sourceKey: "RX-01:2", action: "REUSE", athleteId: "same-id" },
        ],
      }),
      /Um mesmo cadastro/,
    );
  });

  it("reuses only a matching paid and confirmed team in the selected category", () => {
    const existing = {
      id: "registration-1",
      category: "SC",
      athleteIds: ["athlete-a", "athlete-b"],
      confirmationStatus: "CONFIRMED",
      paymentStatus: "PAID",
    };
    const preview = plan({
      existingAthletes: [
        { id: "athlete-a", fullName: "Gustavo Panda" },
        { id: "athlete-b", fullName: "Marilia" },
      ],
      existingRegistrations: [existing],
      resolutions: [
        { sourceKey: "SCALE-01:1", action: "REUSE", athleteId: "athlete-a" },
        { sourceKey: "SCALE-01:2", action: "REUSE", athleteId: "athlete-b" },
      ],
    });
    const sourceTeam = preview.teams.find((team) => team.sourceCode === "SCALE-01");
    assert.equal(sourceTeam?.existingRegistrationId, "registration-1");
    assert.equal(sourceTeam?.conflict, null);
    assert.equal(preview.counts.teamsToReuse, 1);
  });

  it("blocks reuse when confirmation or payment would be overwritten", () => {
    const preview = plan({
      existingAthletes: [
        { id: "athlete-a", fullName: "Gustavo Panda" },
        { id: "athlete-b", fullName: "Marilia" },
      ],
      existingRegistrations: [{
        id: "registration-1",
        category: "SC",
        athleteIds: ["athlete-b", "athlete-a"],
        confirmationStatus: "PENDING",
        paymentStatus: "UNVERIFIED",
      }],
      resolutions: [
        { sourceKey: "SCALE-01:1", action: "REUSE", athleteId: "athlete-a" },
        { sourceKey: "SCALE-01:2", action: "REUSE", athleteId: "athlete-b" },
      ],
    });
    const team = preview.teams.find((item) => item.sourceCode === "SCALE-01");
    assert.equal(team?.conflict, "EXISTING_CONFIRMATION_OR_PAYMENT_DIFFERS");
  });
});

describe("registration history edit guard", () => {
  it("detects a payment-only change without marking category, athletes, or confirmation changed", () => {
    assert.deepEqual(changedRosterManagementFields({
      teamName: "Equipe Demo",
      category: "RX",
      athleteIds: ["athlete-a", "athlete-b"],
      confirmationStatus: "CONFIRMED",
      paymentStatus: "PENDING",
    }, {
      teamName: "Equipe Demo",
      category: "RX",
      athleteIds: ["athlete-a", "athlete-b"],
      confirmationStatus: "CONFIRMED",
      paymentStatus: "PAID",
    }), {
      teamName: false,
      category: false,
      athleteIds: false,
      confirmationStatus: false,
      paymentStatus: true,
    });
  });

  it("treats athlete order swaps as the same roster identity", () => {
    assert.equal(rosterIdentityChanged(
      { category: "RX", athleteIds: ["a", "b"] },
      { category: "RX", athleteIds: ["b", "a"] },
    ), false);
  });

  it("allows replacing an athlete while the stable registration is linked to a heat or import", () => {
    const changes = rosterIdentityChanges(
      { category: "RX", athleteIds: ["a", "b"] },
      { category: "RX", athleteIds: ["a", "c"] },
    );
    assert.equal(rosterIdentityEditConflict(changes, {
      resultCount: 0, heatEntryCount: 1, importCount: 1, podiumCount: 0,
    }), null);
  });

  it("blocks identity changes after results or a published podium", () => {
    const changes = rosterIdentityChanges(
      { category: "RX", athleteIds: ["a", "b"] },
      { category: "RX", athleteIds: ["a", "c"] },
    );
    assert.match(rosterIdentityEditConflict(changes, {
      resultCount: 1, heatEntryCount: 1, importCount: 1, podiumCount: 0,
    }) ?? "", /1 resultado\(s\)/);
    assert.match(rosterIdentityEditConflict(changes, {
      resultCount: 0, heatEntryCount: 1, importCount: 1, podiumCount: 1,
    }) ?? "", /1 pódio\(s\) publicado\(s\)/);
  });

  it("blocks changing category while preserving a category-specific battery assignment", () => {
    const changes = rosterIdentityChanges(
      { category: "RX", athleteIds: ["a", "b"] },
      { category: "SC", athleteIds: ["a", "b"] },
    );
    assert.deepEqual(changes, { athleteIdsChanged: false, categoryChanged: true });
    assert.match(rosterIdentityEditConflict(changes, {
      resultCount: 0, heatEntryCount: 1, importCount: 0, podiumCount: 0,
    }) ?? "", /categoria.*bateria/s);
  });

  it("allows display-name changes while preserving podium registration references", () => {
    assert.equal(rosterIdentityEditConflict({ athleteIdsChanged: false, categoryChanged: false }, {
      resultCount: 0, heatEntryCount: 0, importCount: 0, podiumCount: 1,
    }), null);
  });
});

describe("ZERO3 team management validation", () => {
  it("allows one or two distinct existing athletes", () => {
    const existingAthleteIds = new Set(["a", "b", "c"]);
    assert.equal(validateRosterManagementEdit({ athleteIds: [], existingAthleteIds }), "A equipe precisa ter um ou dois atletas.");
    assert.equal(validateRosterManagementEdit({ athleteIds: ["a", "b", "c"], existingAthleteIds }), "A equipe precisa ter um ou dois atletas.");
    assert.equal(validateRosterManagementEdit({ athleteIds: ["a", "a"], existingAthleteIds }), "A equipe não pode repetir o mesmo atleta.");
    assert.equal(validateRosterManagementEdit({ athleteIds: ["a", "missing"], existingAthleteIds }), "Selecione atletas cadastrados.");
    assert.equal(validateRosterManagementEdit({ athleteIds: ["a"], existingAthleteIds }), null);
    assert.equal(validateRosterManagementEdit({ athleteIds: ["a", "b"], existingAthleteIds }), null);
  });
});

describe("ZERO3 registration creation contract", () => {
  it("requires exactly two athletes for a new event registration", () => {
    assert.equal(CreateZero3RegistrationBody.safeParse({ category: "SC", athleteIds: ["a"] }).success, false);
    assert.equal(CreateZero3RegistrationBody.safeParse({ category: "SC", athleteIds: ["a", "b"] }).success, true);
    assert.equal(CreateZero3RegistrationBody.safeParse({ category: "SC", athleteIds: ["a", "b", "c"] }).success, false);
  });

  it("accepts an athlete replacement without a user-entered reason", () => {
    const payload = {
      edits: [{
        registrationId: "registration-1",
        category: "RX",
        athleteIds: ["athlete-a", "athlete-c"],
        confirmationStatus: "PENDING",
        paymentStatus: "UNVERIFIED",
      }],
    };
    assert.equal(UpdateZero3RosterManagementBody.safeParse(payload).success, true);
  });
});
