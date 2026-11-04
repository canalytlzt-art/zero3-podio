import assert from "node:assert/strict";
import test from "node:test";
import { resolveHeatRegistrationAssignments } from "./zero3-heat-assignments";

test("assigns five registrations once each, including teams with two athletes", () => {
  const ids = ["reg-1", "reg-2", "reg-3", "reg-4", "reg-5"];
  const rows = ids.map((id, index) => ({
    id,
    eventId: "event-demo",
    category: "RX",
    athleteIds: [`athlete-${index * 2 + 1}`, `athlete-${index * 2 + 2}`],
  }));
  const result = resolveHeatRegistrationAssignments(ids, rows, "event-demo", "RX");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.registrations.length, 5);
  assert.deepEqual(result.registrations.map((row) => row.id), ids);
  assert.deepEqual(result.registrations[0]?.athleteIds, ["athlete-1", "athlete-2"]);
});

test("rejects duplicate IDs or athletes and registrations from another category or event", () => {
  const row = { id: "reg-1", eventId: "event-demo", category: "RX", athleteIds: ["a", "b"] };
  assert.deepEqual(
    resolveHeatRegistrationAssignments(["reg-1", "reg-1"], [row], "event-demo", "RX"),
    { ok: false, error: "Há inscrições duplicadas na bateria." },
  );
  assert.equal(
    resolveHeatRegistrationAssignments(["reg-1"], [row], "other-event", "RX").ok,
    false,
  );
  assert.equal(
    resolveHeatRegistrationAssignments(["reg-1"], [row], "event-demo", "SC").ok,
    false,
  );
  const otherRegistration = {
    id: "reg-2", eventId: "event-demo", category: "RX", athleteIds: ["b", "c"],
  };
  assert.deepEqual(
    resolveHeatRegistrationAssignments(
      ["reg-1", "reg-2"], [row, otherRegistration], "event-demo", "RX",
    ),
    {
      ok: false,
      error: "O mesmo atleta não pode aparecer em mais de uma inscrição desta bateria.",
    },
  );
});
