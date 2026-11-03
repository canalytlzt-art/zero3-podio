import assert from "node:assert/strict";
import test from "node:test";
import {
  pollingIntervalAfterError,
  queryErrorMessage,
  shouldRefetchAfterError,
  shouldRetryZero3Query,
} from "./api-error-policy.ts";

test("HTTP 501 stays visible and disables automatic retries and polling", () => {
  const error = { status: 501 };
  assert.equal(shouldRetryZero3Query(0, error), false);
  assert.equal(pollingIntervalAfterError(error, 20_000), false);
  assert.equal(shouldRefetchAfterError(error), false);
  assert.match(queryErrorMessage(error), /HTTP 501/);
});

test("authorization errors do not retry, while other failures retain one retry", () => {
  assert.equal(shouldRetryZero3Query(0, { status: 401 }), false);
  assert.equal(shouldRetryZero3Query(0, { status: 403 }), false);
  assert.equal(shouldRetryZero3Query(0, { status: 503 }), true);
  assert.equal(shouldRetryZero3Query(1, { status: 503 }), false);
  assert.equal(pollingIntervalAfterError({ status: 503 }, 20_000), 20_000);
  assert.equal(shouldRefetchAfterError({ status: 503 }), true);
});
