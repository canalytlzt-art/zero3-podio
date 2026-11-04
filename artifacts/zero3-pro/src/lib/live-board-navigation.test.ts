import assert from "node:assert/strict";
import test from "node:test";
import {
  liveBoardHrefForBattery,
  liveBoardHrefForEvent,
} from "./live-board-navigation.ts";

test("live board event links preserve event and requested view", () => {
  assert.equal(
    liveBoardHrefForEvent("event 1", "overall"),
    "/placar-ao-vivo?eventId=event+1&view=overall",
  );
});

test("live board battery links preserve event, proof, and battery selection", () => {
  assert.equal(
    liveBoardHrefForBattery("event-1", "proof/2", 3),
    "/placar-ao-vivo?proofId=proof%2F2&batteryOrder=3&view=battery&eventId=event-1",
  );
});

test("live board can open without an event selected", () => {
  assert.equal(liveBoardHrefForEvent(), "/placar-ao-vivo");
  assert.equal(
    liveBoardHrefForBattery(undefined, "proof-1", 1),
    "/placar-ao-vivo?proofId=proof-1&batteryOrder=1&view=battery",
  );
});
