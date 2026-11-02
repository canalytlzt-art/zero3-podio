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

test("assigns a response correlation ID without logging request credentials", () => {
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
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(requestId));
  assert.doesNotMatch(lines[0], /sensitive-session-cookie|sensitive-token|authorization|cookie/);
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
