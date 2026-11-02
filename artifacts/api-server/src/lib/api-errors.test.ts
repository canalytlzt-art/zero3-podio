import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { writeApiFailure } from "./api-errors";
import {
  AuthorizationProviderUnavailableError,
  AuthorizationSessionInvalidError,
  isAuthorizationProviderUnavailable,
  isDatabaseUnavailable,
  isDependencyUnavailable,
  isInvalidAuthorizationSession,
} from "./api-error-classification";

function capturedApiFailure(error: unknown): { status: number; body: unknown } {
  const result: { status: number; body: unknown } = { status: 0, body: null };
  const req = { id: "auth-error-test" } as unknown as Request;
  const res = {
    status(status: number) {
      result.status = status;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as Response;
  const originalError = console.error;
  console.error = () => {};
  try {
    writeApiFailure(req, res, error);
  } finally {
    console.error = originalError;
  }
  return result;
}

test("classifies PostgreSQL connectivity errors as dependency failures", () => {
  const connectionError = Object.assign(new Error("connection lost"), {
    code: "ECONNRESET",
  });
  assert.equal(
    isDependencyUnavailable(connectionError),
    true,
  );
  assert.equal(isDatabaseUnavailable(connectionError), true);
  assert.equal(
    isDependencyUnavailable(
      Object.assign(new Error("database unavailable"), { code: "57P03" }),
    ),
    true,
  );
  assert.equal(
    isAuthorizationProviderUnavailable(connectionError),
    false,
  );
});

test("classifies authorization-provider outages as dependency failures", () => {
  const providerError = new AuthorizationProviderUnavailableError();
  assert.equal(isDependencyUnavailable(providerError), true);
  assert.equal(isAuthorizationProviderUnavailable(providerError), true);
  assert.equal(isDatabaseUnavailable(providerError), false);
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

test("returns separate provider and database failure codes", () => {
  const provider = capturedApiFailure(new AuthorizationProviderUnavailableError());
  const database = capturedApiFailure(
    Object.assign(new Error("database unavailable"), { code: "ECONNRESET" }),
  );

  assert.equal(provider.status, 503);
  assert.equal((provider.body as { code: string }).code, "AUTH_PROVIDER_UNAVAILABLE");
  assert.equal(database.status, 503);
  assert.equal((database.body as { code: string }).code, "DATABASE_UNAVAILABLE");
});

test("keeps invalid sessions, inactive roles, and internal errors distinct", () => {
  const session = capturedApiFailure(new AuthorizationSessionInvalidError());
  const internal = capturedApiFailure(new Error("unexpected route failure"));

  assert.equal(session.status, 401);
  assert.equal((session.body as { code: string }).code, "SESSION_INVALID");
  assert.equal(internal.status, 500);
  assert.equal((internal.body as { code: string }).code, "API_INTERNAL_ERROR");
});

test("finds connection failures wrapped as an error cause", () => {
  const wrapped = new Error("query failed", {
    cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
  });
  assert.equal(isDependencyUnavailable(wrapped), true);
});
