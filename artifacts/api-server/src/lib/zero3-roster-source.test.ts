import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZERO3_ROSTER_SOURCE,
  findRosterIdentityCandidates,
  isPossibleRosterIdentityMatch,
  rosterSourcePeople,
} from "./zero3-roster-source";

describe("ZERO3 Games source roster", () => {
  it("preserves the approved 29 pairs and 58 distinct people", () => {
    const people = rosterSourcePeople();
    const names = people.map((person) => person.fullName);
    assert.equal(ZERO3_ROSTER_SOURCE.teams.length, 29);
    assert.equal(ZERO3_ROSTER_SOURCE.teams.filter((team) => team.category === "RX").length, 16);
    assert.equal(ZERO3_ROSTER_SOURCE.teams.filter((team) => team.category === "SCALE").length, 13);
    assert.equal(people.length, 58);
    assert.equal(new Set(names).size, 58);
  });

  it("keeps source cells attached to each person without importing excluded notes", () => {
    const people = rosterSourcePeople();
    assert.deepEqual(people.find((person) => person.sourceKey === "RX-01:1"), {
      sourceKey: "RX-01:1",
      sourceCode: "RX-01",
      sourceCell: "B3",
      sourceRow: 3,
      sourceCategory: "RX",
      fullName: "Flavio Montiel",
    });
    assert.equal(people.some((person) => person.fullName === "Isabella cristina"), false);
    assert.equal(ZERO3_ROSTER_SOURCE.excludedSourceNotes[0].createsRefund, false);
  });

  it("treats normalized and partial names as candidates, never as identity proof", () => {
    const existing = [
      { id: "athlete-1", fullName: "Gabriel Lorenzetti" },
      { id: "athlete-2", fullName: "Beatriz Couto" },
    ];
    assert.equal(isPossibleRosterIdentityMatch("Gabriel", "Gabriel Lorenzetti"), true);
    assert.equal(isPossibleRosterIdentityMatch("Beatriz", "Beatriz Couto"), true);
    assert.deepEqual(findRosterIdentityCandidates("Gabriel", existing), [existing[0]]);
    assert.deepEqual(findRosterIdentityCandidates("Maira", existing), []);
  });
});
