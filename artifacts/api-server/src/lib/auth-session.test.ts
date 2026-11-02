import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSignedInUserSession } from "./auth-session";

test("requires a verified user and session identifier", () => {
  assert.equal(
    hasSignedInUserSession({
      isAuthenticated: true,
      userId: "user_valid",
      sessionId: "sess_valid",
    }),
    true,
  );
});

test("rejects a signed-out state even if it contains a user identifier", () => {
  assert.equal(
    hasSignedInUserSession({
      isAuthenticated: false,
      userId: "user_stale",
      sessionId: null,
    }),
    false,
  );
});

test("rejects machine or incomplete auth states without a user session", () => {
  assert.equal(
    hasSignedInUserSession({
      isAuthenticated: true,
      userId: null,
      sessionId: null,
    }),
    false,
  );
  assert.equal(hasSignedInUserSession(undefined), false);
});
