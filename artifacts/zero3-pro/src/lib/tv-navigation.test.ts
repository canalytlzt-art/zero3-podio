import assert from "node:assert/strict";
import test from "node:test";
import { tvHrefForEvent } from "./tv-navigation.ts";

test("opens the single TV route with the selected event filter", () => {
  assert.equal(
    tvHrefForEvent("event id/with spaces"),
    "/tv?eventId=event+id%2Fwith+spaces",
  );
});

test("opens the same TV route without a filter when no event is selected", () => {
  assert.equal(tvHrefForEvent(), "/tv");
  assert.equal(tvHrefForEvent(""), "/tv");
});
