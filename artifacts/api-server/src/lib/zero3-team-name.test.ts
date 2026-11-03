import assert from "node:assert/strict";
import test from "node:test";
import { parseZero3TeamName, resolveZero3DisplayTeamName } from "./zero3-team-name";

test("trims and collapses whitespace while preserving a blank optional name", () => {
  assert.deepEqual(parseZero3TeamName("  Tropa   do WOD  "), {
    success: true,
    value: "Tropa do WOD",
  });
  assert.deepEqual(parseZero3TeamName("   "), { success: true, value: null });
  assert.deepEqual(parseZero3TeamName(null), { success: true, value: null });
});

test("accepts names up to 40 characters and rejects longer names", () => {
  assert.equal(parseZero3TeamName("A".repeat(40)).success, true);
  assert.deepEqual(parseZero3TeamName("A".repeat(41)), {
    success: false,
    error: "O nome da equipe deve ter no máximo 40 caracteres.",
  });
});

test("rejects markup delimiters and control characters", () => {
  for (const value of ["<script>alert(1)</script>", "Equipe>RX", "Equipe\nRX", "Equipe\u009fRX"]) {
    assert.equal(parseZero3TeamName(value).success, false, JSON.stringify(value));
  }
  assert.deepEqual(parseZero3TeamName(1), {
    success: false,
    error: "O nome da equipe deve ser um texto.",
  });
});

test("uses the current registration name while retaining snapshots for orphaned history", () => {
  assert.equal(resolveZero3DisplayTeamName("New name", "Old name", true), "New name");
  assert.equal(resolveZero3DisplayTeamName(null, "Old name", true), null);
  assert.equal(resolveZero3DisplayTeamName(undefined, "Historical name", false), "Historical name");
});
