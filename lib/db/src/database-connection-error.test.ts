import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DatabaseConnectionUnavailableError,
  DATABASE_CONNECTION_UNAVAILABLE_CODE,
} from "./database-connection-error";

test("wraps connection acquisition failures while retaining the original cause", () => {
  const cause = Object.assign(new Error("connection attempt failed"), {
    code: "ECONNREFUSED",
  });
  const error = new DatabaseConnectionUnavailableError(cause);

  assert.equal(error.name, "DatabaseConnectionUnavailableError");
  assert.equal(error.code, DATABASE_CONNECTION_UNAVAILABLE_CODE);
  assert.equal(error.cause, cause);
  assert.equal((error.cause as Error & { code?: string }).code, "ECONNREFUSED");
});
