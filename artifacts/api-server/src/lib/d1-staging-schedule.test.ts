import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateZero3EventBatteryBody,
  UpdateZero3EventBatteryBody,
} from "@workspace/api-zod";

test("battery create and update contracts accept a nullable scheduled instant", () => {
  const scheduledStartAt = "2026-11-05T15:30:00.000Z";
  const created = CreateZero3EventBatteryBody.parse({
    name: "Bateria P01",
    order: 1,
    registrationIds: [],
    scheduledStartAt,
  });
  assert.equal(created.scheduledStartAt?.toISOString(), scheduledStartAt);

  const updated = UpdateZero3EventBatteryBody.parse({
    expectedName: "Bateria P01",
    expectedOrder: 1,
    expectedScheduledStartAt: scheduledStartAt,
    expectedRegistrationIds: [],
    name: "Bateria P01",
    order: 1,
    registrationIds: [],
    scheduledStartAt: null,
  });
  assert.equal(updated.expectedScheduledStartAt?.toISOString(), scheduledStartAt);
  assert.equal(updated.scheduledStartAt, null);
});
