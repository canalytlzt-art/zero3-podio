import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { beginRequestStage } from "./request-tracing";

test("times authorization stages and correlates them to request and Cloudflare Ray IDs", () => {
  const request = {
    id: "request-fixture",
    path: "/api/zero3/me",
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

test("does not emit authorization stage logs for unrelated requests", () => {
  const request = {
    id: "request-fixture",
    path: "/api/zero3/events",
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
