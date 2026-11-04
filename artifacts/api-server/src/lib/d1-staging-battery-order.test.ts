import assert from "node:assert/strict";
import test from "node:test";
import { resolveBatteryOrderChange } from "./d1-staging-battery-order";

const batteries = [
  { id: "battery-1", order: 1, name: "Bateria vazia" },
  { id: "battery-2", order: 2, name: "Bateria com equipes" },
];

test("moves to an unused order without changing battery identity", () => {
  assert.deepEqual(resolveBatteryOrderChange(batteries, "battery-1", 4), {
    kind: "move",
    current: batteries[0],
    order: 4,
  });
});

test("reports which battery owns an occupied order until the operator confirms a swap", () => {
  const decision = resolveBatteryOrderChange(batteries, "battery-1", 2);
  assert.equal(decision.kind, "occupied");
  if (decision.kind === "occupied") {
    assert.deepEqual(decision.other, batteries[1]);
  }
});

test("swaps only with the explicitly confirmed battery at the requested position", () => {
  const decision = resolveBatteryOrderChange(batteries, "battery-1", 2, "battery-2");
  assert.equal(decision.kind, "swap");
  if (decision.kind === "swap") {
    assert.equal(decision.current.id, "battery-1");
    assert.equal(decision.other.id, "battery-2");
  }
  assert.deepEqual(
    resolveBatteryOrderChange(batteries, "battery-1", 2, "stale-battery"),
    { kind: "conflict", reason: "SWAP_TARGET_CHANGED" },
  );
});

test("rejects a swap target when the requested order became free", () => {
  assert.deepEqual(
    resolveBatteryOrderChange([batteries[0]!], "battery-1", 2, "battery-2"),
    { kind: "conflict", reason: "SWAP_TARGET_CHANGED" },
  );
});
