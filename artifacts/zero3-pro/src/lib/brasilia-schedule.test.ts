import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBrasiliaDateTimeInput,
  formatBrasiliaDateTime,
  formatBrasiliaTime,
  parseBrasiliaDateTimeInput,
} from "./brasilia-schedule.ts";

test("scheduled start is converted as Brasília time regardless of host timezone", () => {
  const instant = parseBrasiliaDateTimeInput("2026-11-05T12:30");
  assert.equal(instant, "2026-11-05T15:30:00.000Z");
  assert.equal(formatBrasiliaDateTimeInput(instant), "2026-11-05T12:30");
  assert.equal(formatBrasiliaTime(instant), "12:30");
  assert.equal(formatBrasiliaDateTime(instant), "05/11/2026, 12:30");
});

test("an unset schedule stays unset and displays no invented time", () => {
  assert.equal(parseBrasiliaDateTimeInput(""), null);
  assert.equal(formatBrasiliaDateTimeInput(null), "");
  assert.equal(formatBrasiliaTime(null), "—");
});

test("invalid local date-time input is rejected", () => {
  assert.throws(() => parseBrasiliaDateTimeInput("2026-02-30T13:10"), /não é válido/);
  assert.throws(() => parseBrasiliaDateTimeInput("13:10"), /fuso de Brasília/);
});
