import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeRosterPreviewResolutions } from "./roster-import-review.ts";

describe("roster import preview decisions", () => {
  it("accepts the server's create suggestion for people with no identity candidates", () => {
    const result = mergeRosterPreviewResolutions(
      [
        { sourceKey: "RX-01:1", resolutionAction: "CREATE", resolvedAthleteId: null },
        { sourceKey: "RX-01:2", resolutionAction: "CREATE", resolvedAthleteId: null },
      ],
      [],
    );

    assert.deepEqual(result, [
      { sourceKey: "RX-01:1", action: "CREATE", athleteId: null },
      { sourceKey: "RX-01:2", action: "CREATE", athleteId: null },
    ]);
  });

  it("leaves possible identity matches unresolved for explicit review", () => {
    const result = mergeRosterPreviewResolutions(
      [
        { sourceKey: "RX-15:2", resolutionAction: null, resolvedAthleteId: null },
      ],
      [],
    );

    assert.deepEqual(result, []);
  });

  it("preserves operator choices and restores an already-applied mapping", () => {
    const result = mergeRosterPreviewResolutions(
      [
        { sourceKey: "RX-01:1", resolutionAction: "CREATE", resolvedAthleteId: null },
        { sourceKey: "RX-15:2", resolutionAction: null, resolvedAthleteId: null },
        { sourceKey: "SCALE-01:1", resolutionAction: "REUSE", resolvedAthleteId: "athlete-existing" },
      ],
      [
        { sourceKey: "RX-15:2", action: "REUSE", athleteId: "athlete-reviewed" },
      ],
    );

    assert.deepEqual(result, [
      { sourceKey: "RX-01:1", action: "CREATE", athleteId: null },
      { sourceKey: "RX-15:2", action: "REUSE", athleteId: "athlete-reviewed" },
      { sourceKey: "SCALE-01:1", action: "REUSE", athleteId: "athlete-existing" },
    ]);
  });
});
