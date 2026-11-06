import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUniquePodiumRegistrations,
  normalizePodiumArbitrationNote,
  visiblePodiumArbitrationNote,
} from "./zero3-podium";

test("empty and whitespace-only arbitration observations are absent", () => {
  assert.equal(normalizePodiumArbitrationNote(undefined), null);
  assert.equal(normalizePodiumArbitrationNote(null), null);
  assert.equal(normalizePodiumArbitrationNote(""), null);
  assert.equal(normalizePodiumArbitrationNote(" \t \n "), null);
});

test("arbitration observation is trimmed as plain text and keeps line breaks", () => {
  assert.equal(
    normalizePodiumArbitrationNote("  Revisão confirmada\npor arbitragem.  "),
    "Revisão confirmada\npor arbitragem.",
  );
  assert.equal(normalizePodiumArbitrationNote("<script>texto</script>"), "<script>texto</script>");
});

test("only a published podium exposes a non-empty public observation", () => {
  assert.equal(visiblePodiumArbitrationNote(false, "Rascunho interno"), null);
  assert.equal(visiblePodiumArbitrationNote(true, " \n "), null);
  assert.equal(visiblePodiumArbitrationNote(true, "Final confirmado"), "Final confirmado");
});

test("podium registration IDs are unique while empty places remain allowed in drafts", () => {
  assert.equal(hasUniquePodiumRegistrations(["rx-a", "rx-b", "rx-c"]), true);
  assert.equal(hasUniquePodiumRegistrations(["rx-a", null, null]), true);
  assert.equal(hasUniquePodiumRegistrations(["rx-a", "rx-a", "rx-c"]), false);
});
