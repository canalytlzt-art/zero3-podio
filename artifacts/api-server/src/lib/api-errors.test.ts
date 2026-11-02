import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthorizationProviderUnavailableError,
  AuthorizationSessionInvalidError,
  isDependencyUnavailable,
  isInvalidAuthorizationSession,
} from "./api-error-classification";

test("classifies PostgreSQL connectivity errors as dependency failures", () => {
  assert.equal(
    isDependencyUnavailable(Object.assign(new Error("connection lost"), { code: "ECONNRESET" })),
    true,
  );
  assert.equal(
    isDependencyUnavailable(Object.assign(new Error("database unavailable"), { code: "57P03" })),
    true,
  );
});

test("classifies authorization-provider outages as dependency failures", () => {
  assert.equal(isDependencyUnavailable(new AuthorizationProviderUnavailableError()), true);
});

test("classifies a deleted Clerk user as an invalid session", () => {
  assert.equal(
    isInvalidAuthorizationSession(new AuthorizationSessionInvalidError()),
    true,
  );
  assert.equal(
    isInvalidAuthorizationSession(new AuthorizationProviderUnavailableError()),
    false,
  );
});

test("does not classify application errors as permission or connection failures", () => {
  assert.equal(isDependencyUnavailable(new Error("unexpected route failure")), false);
});

test("finds connection failures wrapped as an error cause", () => {
  const wrapped = new Error("query failed", {
    cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
  });
  assert.equal(isDependencyUnavailable(wrapped), true);
});
