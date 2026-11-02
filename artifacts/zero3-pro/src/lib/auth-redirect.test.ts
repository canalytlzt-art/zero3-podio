import assert from "node:assert/strict";
import test from "node:test";
import {
  clerkRedirectDestination,
  defaultAdminRedirect,
  safeProtectedRedirect,
  sanitizeClerkRedirectSearch,
  signInHrefForProtectedPath,
} from "./auth-redirect.ts";

const origin = "https://zero3.example";

test("keeps an internal protected destination and its event identifier", () => {
  assert.equal(
    safeProtectedRedirect(
      "/zero3-pro/admin/events/event-123?tab=results",
      "/zero3-pro",
      origin,
    ),
    "/zero3-pro/admin/events/event-123?tab=results",
  );
});

test("normalizes an allowed same-origin URL to the app base path", () => {
  assert.equal(
    safeProtectedRedirect("https://zero3.example/operacao", "/zero3-pro", origin),
    "/zero3-pro/operacao",
  );
});

test("rejects public, sign-in, and unknown routes as return destinations", () => {
  for (const route of ["/tv", "/sign-in", "/inicio", "/unknown"]) {
    assert.equal(safeProtectedRedirect(route, "", origin), null);
  }
});

test("rejects external, protocol-relative, and malformed destinations", () => {
  for (const route of [
    "https://attacker.example/admin",
    "//attacker.example/admin",
    "/\\attacker.example/admin",
    "javascript:alert(1)",
    "/admin/../tv",
  ]) {
    assert.equal(safeProtectedRedirect(route, "", origin), null);
  }
});

test("strips unsafe Clerk redirect parameters and retains safe internal ones", () => {
  const result = new URLSearchParams(
    sanitizeClerkRedirectSearch(
      "?campaign=event&redirect_url=%2Foperacao&sign_in_force_redirect_url=https%3A%2F%2Fattacker.example%2Fadmin&sign_in_fallback_redirect_url=%2Fadmin",
      "/zero3-pro",
      origin,
    ),
  );

  assert.equal(result.get("campaign"), "event");
  assert.equal(result.get("redirect_url"), "/zero3-pro/operacao");
  assert.equal(result.has("sign_in_force_redirect_url"), false);
  assert.equal(result.get("sign_in_fallback_redirect_url"), "/zero3-pro/admin");
});

test("builds a sign-in link that carries only a protected in-app path", () => {
  assert.equal(
    signInHrefForProtectedPath("/admin/events/event-123?tab=results", "", origin),
    "/sign-in?redirect_url=%2Fadmin%2Fevents%2Fevent-123%3Ftab%3Dresults",
  );
  assert.equal(
    signInHrefForProtectedPath("/tv", "", origin),
    "/sign-in",
  );
});

test("uses the valid protected route first and defaults safely to admin", () => {
  assert.equal(
    clerkRedirectDestination("?redirect_url=%2Foperacao", "sign-in", "", origin),
    "/operacao",
  );
  assert.equal(
    clerkRedirectDestination(
      "?sign_in_force_redirect_url=https%3A%2F%2Fattacker.example%2Fadmin&redirect_url=%2Foperacao",
      "sign-in",
      "",
      origin,
    ),
    "/operacao",
  );
  assert.equal(
    clerkRedirectDestination("?redirect_url=%2Ftv", "sign-in", "", origin),
    "/admin",
  );
});

test("uses the app's admin path as the fallback", () => {
  assert.equal(defaultAdminRedirect(""), "/admin");
  assert.equal(defaultAdminRedirect("/zero3-pro/"), "/zero3-pro/admin");
});
