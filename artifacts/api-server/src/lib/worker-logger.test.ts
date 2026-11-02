import assert from "node:assert/strict";
import { test } from "node:test";
import { workerLogger } from "./worker-logger";

test("worker logs include safe error metadata but omit credentials", () => {
  const lines: string[] = [];
  const originalConsoleError = console.error;
  console.error = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    const unsafeContext = {
      error: { name: "ApiError", code: "E_TEST" },
      requestId: "request-123",
      statusCode: 500,
      authorization: "Bearer fake-token",
      cookie: "fake-session",
      headers: {
        authorization: "Bearer fake-token",
        cookie: "fake-session",
      },
    } as unknown as Parameters<typeof workerLogger.error>[0];
    workerLogger.error(unsafeContext, "request failed");
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /"name":"ApiError"/);
  assert.match(lines[0], /"requestId":"request-123"/);
  assert.doesNotMatch(lines[0], /fake-token|fake-session|authorization|cookie/);
});
