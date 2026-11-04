import assert from "node:assert/strict";
import test from "node:test";
import { findZero3RegistrationConflict } from "./zero3-registration-conflict";

test("allows homonymous registrations when their athletes are different", () => {
  const existing = [{
    teamName: "Dupla Fictícia",
    athleteIds: ["athlete-a", "athlete-b"],
  }];

  assert.equal(findZero3RegistrationConflict(existing, {
    teamName: "Dupla Fictícia",
    athleteIds: ["athlete-c", "athlete-d"],
  }), null);
});

test("keeps an identical athlete pair from being registered twice", () => {
  assert.equal(findZero3RegistrationConflict([{
    teamName: "Nome anterior",
    athleteIds: ["athlete-a", "athlete-b"],
  }], {
    teamName: "Outro nome",
    athleteIds: ["athlete-b", "athlete-a"],
  }), "DUPLICATE_ATHLETE_PAIR");
});

test("keeps an athlete from joining a second team in the same event", () => {
  assert.equal(findZero3RegistrationConflict([{
    teamName: "Dupla existente",
    athleteIds: ["athlete-a", "athlete-b"],
  }], {
    teamName: "Dupla nova",
    athleteIds: ["athlete-c", "athlete-b"],
  }), "ATHLETE_ALREADY_REGISTERED");
});
