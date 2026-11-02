import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customFetch,
  setAuthTokenGetter,
  setBaseUrl,
} from "../../lib/api-client-react/src/custom-fetch";

type CapturedRequest = {
  authorization: string | null;
  credentials: RequestCredentials | undefined;
  cache: RequestCache | undefined;
};

function captureRequest(init?: RequestInit): CapturedRequest {
  return {
    authorization: new Headers(init?.headers).get("authorization"),
    credentials: init?.credentials,
    cache: init?.cache,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("sends a bearer token only to protected first-party ZERO3 API routes", async () => {
  const requests: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  setBaseUrl(null);
  setAuthTokenGetter(async () => "fixture-token");
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(captureRequest(init));
    return jsonResponse(200, { ok: true });
  }) as typeof fetch;

  try {
    await customFetch("/api/zero3/events");
    await customFetch("/api/zero3/public-board");
    await customFetch("https://example.invalid/api/zero3/events");
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
  }

  assert.equal(requests[0].authorization, "Bearer fixture-token");
  assert.equal(requests[0].credentials, "same-origin");
  assert.equal(requests[0].cache, "no-store");
  assert.equal(requests[1].authorization, null);
  assert.equal(requests[2].authorization, null);
});

test("renews a token and retries one failed GET exactly once", async () => {
  const requests: CapturedRequest[] = [];
  const tokenOptions: Array<{ skipCache?: boolean } | undefined> = [];
  const originalFetch = globalThis.fetch;
  setBaseUrl(null);
  setAuthTokenGetter(async (options) => {
    tokenOptions.push(options);
    return options?.skipCache ? "fresh-fixture-token" : "stale-fixture-token";
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(captureRequest(init));
    return requests.length === 1
      ? jsonResponse(401, { code: "SESSION_INVALID", error: "Session invalid" })
      : jsonResponse(200, { role: "ADMIN" });
  }) as typeof fetch;

  try {
    const result = await customFetch<{ role: string }>("/api/zero3/me");
    assert.deepEqual(result, { role: "ADMIN" });
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].authorization, "Bearer stale-fixture-token");
  assert.equal(requests[1].authorization, "Bearer fresh-fixture-token");
  assert.equal(tokenOptions.length, 2);
  assert.equal(tokenOptions[1]?.skipCache, true);
});

test("does not replay a write after an authorization failure", async () => {
  let requestCount = 0;
  let tokenReadCount = 0;
  const originalFetch = globalThis.fetch;
  setBaseUrl(null);
  setAuthTokenGetter(async () => {
    tokenReadCount += 1;
    return "fixture-token";
  });
  globalThis.fetch = (async () => {
    requestCount += 1;
    return jsonResponse(401, { code: "SESSION_INVALID" });
  }) as typeof fetch;

  try {
    await assert.rejects(
      customFetch("/api/zero3/results", {
        method: "POST",
        body: JSON.stringify({ elapsedMs: 1000 }),
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
  }

  assert.equal(requestCount, 1);
  assert.equal(tokenReadCount, 1);
});
