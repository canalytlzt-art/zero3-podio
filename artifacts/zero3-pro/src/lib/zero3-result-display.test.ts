import assert from "node:assert/strict";
import test from "node:test";
import { cancelledProofLabel, isCancelledProofMark } from "./zero3-result-display.ts";

test("only an explicit numeric zero is treated as a cancelled proof", () => {
  assert.equal(isCancelledProofMark(0), true);
  assert.equal(isCancelledProofMark("0.000"), true);
  assert.equal(isCancelledProofMark(null), false);
  assert.equal(isCancelledProofMark(""), false);
  assert.equal(isCancelledProofMark("0.01"), false);
});

test("cancellation label distinguishes provisional from reviewed zero", () => {
  assert.equal(cancelledProofLabel("PROVISIONAL", 0), "Prova cancelada · provisório, aguarda revisão");
  assert.equal(cancelledProofLabel("VALIDATED", 0), "Prova cancelada · regra de pontuação pendente");
  assert.equal(cancelledProofLabel("VALIDATED", null), null);
});
