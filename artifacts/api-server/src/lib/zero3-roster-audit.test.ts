import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeRosterAuditChange } from "./zero3-roster-audit";

describe("automatic roster audit descriptions", () => {
  const names = new Map([["a", "Ana"], ["b", "Bia"], ["c", "Caio"]]);

  it("records the names leaving and entering without a user-supplied reason", () => {
    assert.equal(
      describeRosterAuditChange(
        { athleteIds: ["a", "b"] },
        { athleteIds: ["a", "c"] },
        names,
      ),
      "Atletas substituídos — saíram: Bia; entraram: Caio.",
    );
  });

  it("records non-identity edits automatically", () => {
    assert.equal(
      describeRosterAuditChange(
        { athleteIds: ["a", "b"], teamName: null },
        { athleteIds: ["a", "b"], teamName: "Dupla" },
        names,
      ),
      "Nome da equipe atualizado; atletas preservados.",
    );
  });
});
