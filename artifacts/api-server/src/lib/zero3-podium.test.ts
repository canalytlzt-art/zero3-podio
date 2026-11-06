import assert from "node:assert/strict";
import test from "node:test";
import { SaveZero3PodiumDraftBody } from "@workspace/api-zod";
import {
  encodePodiumPlaceObservations,
  hasUniquePodiumRegistrations,
  normalizePodiumArbitrationNote,
  readPodiumPlaceObservations,
  visiblePodiumObservations,
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

test("three observations persist independently with their place and registration", () => {
  const registrationIds = ["rx-a", "rx-b", "rx-c"];
  const encoded = encodePodiumPlaceObservations([
    { place: 1, registrationId: "rx-a", note: "Ouro" },
    { place: 2, registrationId: "rx-b", note: "Prata" },
    { place: 3, registrationId: "rx-c", note: "Bronze" },
  ], registrationIds);
  assert.ok(encoded);
  assert.deepEqual(readPodiumPlaceObservations(encoded, registrationIds), {
    arbitrationNote: null,
    placeObservations: [
      { place: 1, registrationId: "rx-a", note: "Ouro" },
      { place: 2, registrationId: "rx-b", note: "Prata" },
      { place: 3, registrationId: "rx-c", note: "Bronze" },
    ],
  });
});

test("only populated observations appear and drafts remain private", () => {
  const registrationIds = ["rx-a", "rx-b", "rx-c"];
  const encoded = encodePodiumPlaceObservations([
    { place: 1, registrationId: "rx-a", note: "  " },
    { place: 2, registrationId: "rx-b", note: "Somente a segunda colocação" },
    { place: 3, registrationId: "rx-c", note: "\n " },
  ], registrationIds);
  assert.ok(encoded);
  assert.deepEqual(visiblePodiumObservations(false, encoded, registrationIds), {
    arbitrationNote: null,
    placeObservations: [],
  });
  assert.deepEqual(visiblePodiumObservations(true, encoded, registrationIds), {
    arbitrationNote: null,
    placeObservations: [
      { place: 2, registrationId: "rx-b", note: "Somente a segunda colocação" },
    ],
  });
  assert.equal(encodePodiumPlaceObservations([
    { place: 1, registrationId: "rx-a", note: " " },
    { place: 2, registrationId: "rx-b", note: null },
    { place: 3, registrationId: "rx-c", note: "" },
  ], registrationIds), null);
});

test("changing the selected registration cannot transfer the previous note", () => {
  const stored = encodePodiumPlaceObservations([
    { place: 1, registrationId: "rx-old", note: "Do atleta anterior" },
  ], ["rx-old", null, null]);
  assert.deepEqual(readPodiumPlaceObservations(stored, ["rx-new", null, null]), {
    arbitrationNote: null,
    placeObservations: [],
  });
  assert.throws(() => encodePodiumPlaceObservations([
    { place: 1, registrationId: "rx-old", note: "Não corresponde" },
  ], ["rx-new", null, null]), { message: "PODIUM_OBSERVATION_REGISTRATION_MISMATCH" });
});

test("legacy scalar observations remain readable without becoming per-place notes", () => {
  assert.deepEqual(readPodiumPlaceObservations("Observação antiga", ["rx-a", "rx-b", "rx-c"]), {
    arbitrationNote: "Observação antiga",
    placeObservations: [],
  });
  assert.deepEqual(visiblePodiumObservations(false, "Rascunho interno", []), {
    arbitrationNote: null,
    placeObservations: [],
  });
});

test("the API contract accepts per-place notes and remains compatible with scalar clients", () => {
  const perPlace = SaveZero3PodiumDraftBody.safeParse({
    registrationIds: ["rx-a", "rx-b", "rx-c"],
    placeObservations: [
      { place: 1, registrationId: "rx-a", note: "Ouro" },
      { place: 2, registrationId: "rx-b", note: null },
      { place: 3, registrationId: "rx-c", note: "Bronze" },
    ],
  });
  const legacy = SaveZero3PodiumDraftBody.safeParse({
    registrationIds: ["rx-a", "rx-b", "rx-c"],
    arbitrationNote: "Observação antiga",
  });
  assert.equal(perPlace.success, true);
  assert.equal(legacy.success, true);
});

test("podium registration IDs are unique while empty places remain allowed in drafts", () => {
  assert.equal(hasUniquePodiumRegistrations(["rx-a", "rx-b", "rx-c"]), true);
  assert.equal(hasUniquePodiumRegistrations(["rx-a", null, null]), true);
  assert.equal(hasUniquePodiumRegistrations(["rx-a", "rx-a", "rx-c"]), false);
});
