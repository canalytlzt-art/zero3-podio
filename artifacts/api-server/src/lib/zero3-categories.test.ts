import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCategoryName,
  normalizeEventCategories,
  validateEventCategories,
} from "./zero3-categories.js";

test("preserves built-in ordering and appends custom event categories", () => {
  assert.deepEqual(normalizeEventCategories(["Masters", "rx", "SC", "Scale", "RX"]), [
    "SC", "RX", "Masters", "Scale",
  ]);
});

test("validates category count, names, control characters, and duplicates", () => {
  assert.equal(validateEventCategories(["SC", "RX", "Masters"]), null);
  assert.match(validateEventCategories([]) ?? "", /1 a 10/);
  assert.match(validateEventCategories([" RX ", "rx"]) ?? "", /duplicatas/);
  assert.match(validateEventCategories(["\n"]) ?? "", /caracteres válidos/);
  assert.match(validateEventCategories(["x".repeat(33)]) ?? "", /32 caracteres/);
  assert.match(validateEventCategories(Array.from({ length: 11 }, (_, index) => `C${index}`)) ?? "", /1 a 10/);
});

test("canonicalizes built-in names but trims custom names", () => {
  assert.equal(normalizeCategoryName(" rx "), "RX");
  assert.equal(normalizeCategoryName(" Masters 40+ "), "Masters 40+");
});
