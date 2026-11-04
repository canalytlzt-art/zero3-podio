import assert from "node:assert/strict";
import test from "node:test";
import { publicationMatchesCurrentSnapshot } from "./d1-staging-event-batteries";

const results = [{ id: "result-1", status: "VALIDATED", rawValue: 42 }];
const leaderboards = [{ category: "RX", entries: [{ registrationId: "registration-1", placement: 1 }] }];

test("published result snapshots remain current when only battery display metadata changes", () => {
  assert.equal(publicationMatchesCurrentSnapshot({
    results_json: JSON.stringify(results),
    leaderboards_json: JSON.stringify(leaderboards),
  }, results, leaderboards), true);
});

test("a changed result or ranking does not match the previous publication snapshot", () => {
  assert.equal(publicationMatchesCurrentSnapshot({
    results_json: JSON.stringify(results),
    leaderboards_json: JSON.stringify(leaderboards),
  }, [{ ...results[0], rawValue: 41 }], leaderboards), false);
});

test("malformed historical snapshots are not treated as current", () => {
  assert.equal(publicationMatchesCurrentSnapshot({
    results_json: "{",
    leaderboards_json: JSON.stringify(leaderboards),
  }, results, leaderboards), false);
});
