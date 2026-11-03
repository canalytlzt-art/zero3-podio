import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { workerLogger, workerRequestLogger } from "./worker-logger";

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

test("records protected-request credential presence without logging values", () => {
  const headers = new Map<string, string>();
  const lines: string[] = [];
  const request = {
    method: "GET",
    path: "/api/zero3/me",
    headers: {
      cookie: "sensitive-session-cookie",
      authorization: "Bearer sensitive-token",
    },
  } as unknown as Request;
  let finish: (() => void) | undefined;
  const response = {
    statusCode: 401,
    once() { return this; },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    on(event: string, listener: () => void) {
      if (event === "finish") finish = listener;
      return this;
    },
  } as unknown as Response;
  const originalConsoleInfo = console.info;
  console.info = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    workerRequestLogger()(request, response, () => {});
    finish?.();
  } finally {
    console.info = originalConsoleInfo;
  }

  const requestId = (request as Request & { id?: string }).id;
  assert.ok(requestId);
  assert.match(requestId, /^[\da-f-]{36}$/i);
  assert.equal(headers.get("x-request-id"), requestId);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /"stageEvent":"start"/);
  assert.match(lines[1], /"stageEvent":"finish"/);
  assert.match(lines[0], /"cookiePresent":true/);
  assert.match(lines[0], /"authorizationPresent":true/);
  assert.match(lines[0], new RegExp(requestId));
  assert.match(lines[1], new RegExp(requestId));
  assert.doesNotMatch(
    lines.join("\n"),
    /sensitive-session-cookie|sensitive-token/,
  );
});

test("records auth-header presence only as booleans", () => {
  const lines: string[] = [];
  const originalConsoleInfo = console.info;
  console.info = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    workerLogger.info(
      {
        authState: {
          isAuthenticated: false,
          hasUserId: false,
          hasSessionId: false,
          cookiePresent: true,
          authorizationPresent: true,
        },
        authorization: "sensitive-token",
        cookie: "sensitive-cookie",
      } as unknown as Parameters<typeof workerLogger.info>[0],
      "session diagnostics",
    );
  } finally {
    console.info = originalConsoleInfo;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /"cookiePresent":true/);
  assert.match(lines[0], /"authorizationPresent":true/);
  assert.doesNotMatch(lines[0], /sensitive-token|sensitive-cookie/);
});

test("retains falsy thrown values instead of silently dropping diagnostics", () => {
  const lines: string[] = [];
  const previous = console.error;
  console.error = (line?: unknown) => { lines.push(String(line)); };
  try {
    for (const error of [null, 0, "", false]) {
      workerLogger.error({ error }, "failure");
    }
  } finally {
    console.error = previous;
  }
  assert.equal(lines.length, 4);
  for (const line of lines) assert.ok(JSON.parse(line).error);
});

test("response wait is correlated and its timer is cleared on completion", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const lines: string[] = [];
  context.mock.method(console, "info", (line: unknown) => lines.push(String(line)));
  const callbacks = new Map<string, () => void>();
  const req = { method: "GET", path: "/api/zero3/me", headers: { "cf-ray": "fixture-ray" } } as unknown as Request;
  const res = {
    statusCode: 500,
    setHeader() {},
    once(event: string, callback: () => void) { callbacks.set(event, callback); },
    on(event: string, callback: () => void) { callbacks.set(event, callback); },
  } as unknown as Response;
  workerRequestLogger()(req, res, () => {});
  context.mock.timers.tick(5000);
  callbacks.get("finish")?.();
  context.mock.timers.tick(10000);
  const records = lines.map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.stageEvent), ["start", "still_running", "finish"]);
  assert.equal(records[1].durationMs, 5000);
  assert.ok(records.every(record => record.requestId === records[0].requestId && record.cfRayId === "fixture-ray"));
});
