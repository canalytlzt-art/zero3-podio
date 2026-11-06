import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicTvResultCell } from "./public-tv-placement.ts";

function result(overrides: Record<string, unknown> = {}) {
  return {
    id: "result-1",
    registrationId: "registration-1",
    proofId: "proof-1",
    rawValue: 140,
    status: "VALIDATED",
    revision: 2,
    publishedRevision: 2,
    placement: 1,
    ...overrides,
  } as Parameters<typeof resolvePublicTvResultCell>[0][number];
}

const cell = (battery: ReturnType<typeof result>[], event: ReturnType<typeof result>[]) =>
  resolvePublicTvResultCell(battery, event, "registration-1", "proof-1");

test("uses the event-wide published placement rather than the battery-local place", () => {
  const current = result({ placement: 1 });
  const eventWide = result({ placement: 5 });
  assert.deepEqual(cell([current], [eventWide]), {
    result: current,
    placement: 5,
    label: "PUBLICADO",
    published: true,
  });
});

test("shows a partial mark without a placement", () => {
  const partial = result({ status: "PROVISIONAL", revision: 3, publishedRevision: 2 });
  const oldPublishedResult = result({ revision: 2, publishedRevision: 2, placement: 4 });
  const resolved = cell([partial], [oldPublishedResult]);
  assert.equal(resolved.result, partial);
  assert.equal(resolved.placement, null);
  assert.equal(resolved.label, "PARCIAL");
});

test("shows a reviewed revision without reusing its previous published placement", () => {
  const reviewed = result({ status: "VALIDATED", revision: 3, publishedRevision: 2 });
  const oldPublishedResult = result({ revision: 3, publishedRevision: 2, placement: 4 });
  const resolved = cell([reviewed], [oldPublishedResult]);
  assert.equal(resolved.placement, null);
  assert.equal(resolved.label, "REVISADO");
});

test("publishes a position only when the displayed revision matches the event result", () => {
  const displayed = result({ revision: 4, publishedRevision: 4 });
  const eventResult = result({ revision: 4, publishedRevision: 4, placement: 7 });
  const resolved = cell([displayed], [eventResult]);
  assert.equal(resolved.placement, 7);
  assert.equal(resolved.label, "PUBLICADO");
});

test("does not show a position when the event-wide result is unavailable", () => {
  const resolved = cell([result()], []);
  assert.equal(resolved.placement, null);
  assert.equal(resolved.label, "REVISADO");
});

test("does not associate an event placement with a different registration or proof", () => {
  const displayed = result();
  const unrelated = result({ registrationId: "other-registration", proofId: "other-proof", placement: 2 });
  const resolved = cell([displayed], [unrelated]);
  assert.equal(resolved.placement, null);
  assert.equal(resolved.label, "REVISADO");
});

test("keeps the empty cell pending without inventing a zero or a place", () => {
  const resolved = cell([], []);
  assert.equal(resolved.result, undefined);
  assert.equal(resolved.placement, null);
  assert.equal(resolved.label, "PENDENTE");
});
