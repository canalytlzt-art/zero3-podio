import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { beginRequestStage } from "./request-tracing";

test("times authorization stages and correlates them to request and Cloudflare Ray IDs", () => {
  const request = {
    id: "request-fixture",
    path: "/me",
    baseUrl: "/api/zero3",
    originalUrl: "/api/zero3/me?probe=1",
    headers: { "cf-ray": "ray-fixture-XYZ" },
  } as unknown as Request;
  const lines: string[] = [];
  const originalConsoleInfo = console.info;
  console.info = (message?: unknown) => lines.push(String(message));

  try {
    const finish = beginRequestStage(request, "authorization_role_query", {
      hyperdriveBindingConfigured: true,
    });
    finish(undefined, { memberFound: true, memberActive: true });
  } finally {
    console.info = originalConsoleInfo;
  }

  assert.equal(lines.length, 2);
  assert.match(lines[0], /"stage":"authorization_role_query","stageEvent":"start"/);
  assert.match(lines[1], /"stage":"authorization_role_query","stageEvent":"finish"/);
  assert.match(lines[0], /"requestId":"request-fixture"/);
  assert.match(lines[0], /"cfRayId":"ray-fixture-XYZ"/);
  assert.match(lines[1], /"durationMs":\d+/);
});

test("Clerk and DB stages retain wait, failure cause, and correlation", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const records: Array<Record<string, unknown>> = [];
  const capture = (line: unknown) => records.push(JSON.parse(String(line)));
  context.mock.method(console, "info", capture);
  context.mock.method(console, "error", capture);
  const request = {
    id: "controlled-failure", originalUrl: "/api/zero3/me",
    headers: { "cf-ray": "controlled-ray" },
  } as unknown as Request;
  for (const stage of ["clerk_validation", "clerk_user_lookup", "hyperdrive_connection", "authorization_role_query"] as const) {
    const finish = beginRequestStage(request, stage);
    context.mock.timers.tick(5000);
    finish(Object.assign(new Error("controlled failure"), { code: "ETIMEDOUT" }));
    const entries = records.filter(record => record.stage === stage);
    assert.deepEqual(entries.map(record => record.stageEvent), ["start", "still_running", "finish"]);
    assert.ok(entries.every(record => record.requestId === "controlled-failure" && record.cfRayId === "controlled-ray"));
    assert.equal((entries[2].error as { code: string }).code, "ETIMEDOUT");
  }
});

test("does not emit authorization stage logs for unrelated requests", () => {
  const request = {
    id: "request-fixture",
    path: "/events",
    baseUrl: "/api/zero3",
    originalUrl: "/api/zero3/events",
    headers: {},
  } as unknown as Request;
  const lines: string[] = [];
  const originalConsoleInfo = console.info;
  console.info = (message?: unknown) => lines.push(String(message));

  try {
    const finish = beginRequestStage(request, "authorization_role_query");
    finish();
  } finally {
    console.info = originalConsoleInfo;
  }

  assert.equal(lines.length, 0);
});

test("marks a long-running stage without cancelling it, then logs its completion", async () => {
  const request = {
    id: "request-stalled-fixture",
    path: "/me",
    baseUrl: "/api/zero3",
    originalUrl: "/api/zero3/me",
    headers: { "cf-ray": "ray-stalled-fixture" },
  } as unknown as Request;
  const lines: string[] = [];
  const originalConsoleInfo = console.info;
  console.info = (message?: unknown) => lines.push(String(message));

  try {
    const finish = beginRequestStage(
      request,
      "authorization_role_query",
      {},
      { stalledAfterMs: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish();
  } finally {
    console.info = originalConsoleInfo;
  }

  assert.equal(lines.length, 3);
  assert.match(lines[0], /"stageEvent":"start"/);
  assert.match(lines[1], /"stageEvent":"still_running"/);
  assert.match(lines[1], /"requestId":"request-stalled-fixture"/);
  assert.match(lines[2], /"stageEvent":"finish"/);
  assert.match(lines[2], /"durationMs":\d+/);
});
