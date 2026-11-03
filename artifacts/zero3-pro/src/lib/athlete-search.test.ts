import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeAthleteReplacement,
  normalizeAthleteSearch,
  searchAthletes,
} from "./athlete-search.ts";

const athletes = [
  { id: "a", fullName: "José Ávila", createdAt: new Date() },
  { id: "b", fullName: "Joana D'Ávila", createdAt: new Date() },
  { id: "c", fullName: "Gabriel Silva", createdAt: new Date() },
];

describe("athlete search", () => {
  it("ignores accents, case, and surrounding whitespace", () => {
    assert.equal(normalizeAthleteSearch("  JOSÉ "), "jose");
    assert.deepEqual(searchAthletes(athletes, "avila").map(({ id }) => id), ["a", "b"]);
    assert.deepEqual(searchAthletes(athletes, "GABRIEL").map(({ id }) => id), ["c"]);
  });

  it("searches the complete supplied catalog and excludes the other slot", () => {
    assert.deepEqual(searchAthletes(athletes, "", "b").map(({ id }) => id), ["a", "c"]);
  });

  it("describes athlete changes for explicit confirmation", () => {
    assert.equal(
      describeAthleteReplacement(["a", "b"], ["a", "c"], athletes),
      "Confirme a alteração dos atletas desta inscrição:\nSai: Joana D'Ávila\nEntra: Gabriel Silva",
    );
    assert.equal(describeAthleteReplacement(["a", "b"], ["b", "a"], athletes), null);
  });
});
