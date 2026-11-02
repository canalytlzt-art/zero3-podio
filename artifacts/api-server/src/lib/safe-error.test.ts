import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeSafeError } from "./safe-error";
import { workerLogger } from "./worker-logger";

test("serializes nested errors while redacting credentials and personal identifiers", () => {
  const cause = Object.assign(
    new Error(
      "DB connect failed: postgres://db-user:db-pass@host.example/db password=secret-value session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.signature contact test@example.com\nAuthorization: Basic fake-token\nCookie: session=fake-cookie\nSet-Cookie: refresh=fake-refresh",
    ),
    { code: "ECONNRESET" },
  );
  const outer = new Error("authorization lookup failed", { cause });

  const serialized = serializeSafeError(outer);
  const text = JSON.stringify(serialized);
  const logLines: string[] = [];
  const originalConsoleError = console.error;
  console.error = (message?: unknown) => logLines.push(String(message));
  try {
    workerLogger.error(
      { error: outer, requestId: "request-test" },
      "authorization failed",
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(serialized.name, "Error");
  assert.match(text, /authorization lookup failed/);
  assert.match(text, /ECONNRESET/);
  assert.match(text, /\[REDACTED_DATABASE_URL\]/);
  assert.match(text, /\[REDACTED_SETTING\]/);
  assert.match(text, /\[REDACTED_JWT\]/);
  assert.match(text, /\[REDACTED_EMAIL\]/);
  assert.match(text, /\[REDACTED_AUTH_HEADER\]/);
  assert.match(text, /\[REDACTED_COOKIE\]/);
  assert.doesNotMatch(
    text,
    /db-user|db-pass|secret-value|fake-token|eyJhbGci|test@example\.com|fake-cookie|fake-refresh/,
  );
  assert.equal(logLines.length, 1);
  assert.match(logLines[0], /"message":"authorization lookup failed"/);
  assert.match(logLines[0], /"stack":/);
  assert.doesNotMatch(
    logLines[0],
    /db-user|db-pass|secret-value|fake-token|eyJhbGci|test@example\.com|fake-cookie|fake-refresh/,
  );
});
