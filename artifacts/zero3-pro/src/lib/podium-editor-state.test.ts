import assert from "node:assert/strict";
import test from "node:test";
import {
  changePodiumSelection,
  observationForPodiumPlace,
  observationsForPodiumSelection,
  podiumObservationsMatch,
} from "./podium-editor-state.ts";

test("each podium place keeps its observation with the selected registration", () => {
  const ids = ["reg-a", "reg-b", "reg-c"];
  const saved = [
    { place: 1, registrationId: "reg-a", note: "Ouro" },
    { place: 2, registrationId: "reg-b", note: "Prata" },
    { place: 3, registrationId: "reg-c", note: "Bronze" },
  ];
  const form = observationsForPodiumSelection(ids, saved);
  assert.deepEqual(form.map((item) => item.note), ["Ouro", "Prata", "Bronze"]);
  assert.equal(podiumObservationsMatch(ids, form, saved), true);
});

test("changing a place's registration clears only that place's note", () => {
  const ids = ["reg-a", "reg-b", "reg-c"];
  const form = observationsForPodiumSelection(ids, [
    { place: 1, registrationId: "reg-a", note: "Ouro" },
    { place: 2, registrationId: "reg-b", note: "Prata" },
    { place: 3, registrationId: "reg-c", note: "Bronze" },
  ]);
  const changed = changePodiumSelection(ids, form, 1, "reg-d");
  assert.deepEqual(changed.registrationIds, ["reg-a", "reg-d", "reg-c"]);
  assert.deepEqual(changed.observations.map((item) => item.note), ["Ouro", "", "Bronze"]);
  assert.equal(changed.observations[1]?.registrationId, "reg-d");
});

test("reload does not attach an observation to a different selected registration", () => {
  const loaded = observationsForPodiumSelection(["reg-new", "reg-b", null], [
    { place: 1, registrationId: "reg-old", note: "Do atleta anterior" },
    { place: 2, registrationId: "reg-b", note: "Nota válida" },
  ]);
  assert.deepEqual(loaded.map((item) => item.note), ["", "Nota válida", ""]);
});

test("public award lookup shows a note only under its exact place and registration", () => {
  const observations = [{ place: 2, registrationId: "reg-b", note: "Nota da segunda colocada." }] as const;
  assert.equal(observationForPodiumPlace(2, "reg-b", observations), "Nota da segunda colocada.");
  assert.equal(observationForPodiumPlace(1, "reg-a", observations), null);
  assert.equal(observationForPodiumPlace(2, "reg-replaced", observations), null);
});
