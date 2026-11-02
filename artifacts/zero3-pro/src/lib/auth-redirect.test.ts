import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalClerkSearch,
  clerkLocationWithSearch,
  clerkRedirectDestination,
  defaultAdminRedirect,
  endCurrentSessionForReauthentication,
  safeProtectedRedirect,
  sanitizeClerkRedirectSearch,
  signInHrefForProtectedPath,
} from "./auth-redirect.ts";

const origin = "https://zero3.example";

test("uses a query representation without a leading question mark", () => {
  const rawSearch = "?redirect_url=%2Fadmin";
  const normalizedSearch = canonicalClerkSearch(rawSearch);
  const safeSearch = sanitizeClerkRedirectSearch(rawSearch, "", origin);

  assert.equal(normalizedSearch, "redirect_url=%2Fadmin");
  assert.equal(safeSearch, normalizedSearch);
  assert.equal(sanitizeClerkRedirectSearch(safeSearch, "", origin), safeSearch);
});

test("canonicalizes query values with or without a leading question mark", () => {
  // Current Wouter returns location.search; the reported bundle exposed a
  // query-only value. Both representations must normalize to the same string.
  const wouterSearch = "redirect_url=%2Fadmin";
  const currentWouterSearch = "?redirect_url=%2Fadmin";
  const rawLocationSearch = "?redirect_url=%2Fadmin";
  const wouterCanonical = canonicalClerkSearch(wouterSearch);
  const currentWouterCanonical = canonicalClerkSearch(currentWouterSearch);
  const locationCanonical = canonicalClerkSearch(rawLocationSearch);
  const safeSearch = sanitizeClerkRedirectSearch(
    rawLocationSearch,
    "",
    origin,
  );

  assert.equal(wouterCanonical, "redirect_url=%2Fadmin");
  assert.equal(currentWouterCanonical, wouterCanonical);
  assert.equal(locationCanonical, wouterCanonical);
  assert.equal(safeSearch, wouterCanonical);
  assert.equal(sanitizeClerkRedirectSearch(safeSearch, "", origin), safeSearch);
});

test("canonicalizes equivalent spaces, Unicode, and literal percent encodings", () => {
  const encoded = "?label=caf%C3%A9&note=hello%20world&value=%25";
  const decoded = "label=café&note=hello+world&value=%";

  assert.equal(canonicalClerkSearch(encoded), canonicalClerkSearch(decoded));
});

test("renders a bare sign-in route without waiting for query normalization", () => {
  const rawSearch = "";
  assert.equal(
    sanitizeClerkRedirectSearch(rawSearch, "", origin),
    canonicalClerkSearch(rawSearch),
  );
  assert.equal(clerkRedirectDestination(rawSearch, "sign-in", "", origin), "/admin");
});

test("keeps pathname, extra query parameters, and hash when composing a replacement", () => {
  assert.equal(
    clerkLocationWithSearch(
      "/sign-in",
      "campaign=event&redirect_url=%2Fadmin",
      "#email",
    ),
    "/sign-in?campaign=event&redirect_url=%2Fadmin#email",
  );
  assert.equal(clerkLocationWithSearch("/sign-in", "", "#email"), "/sign-in#email");
});

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

test("preserves extra and nested encoded parameters across repeated normalization", () => {
  const nestedDestination =
    "/admin/events/event-123?tab=résumé 100%&note=50% complete";
  const rawSearch = new URLSearchParams([
    ["campaign", "Café 50%"],
    ["redirect_url", nestedDestination],
  ]).toString();
  const first = sanitizeClerkRedirectSearch(`?${rawSearch}`, "", origin);
  const second = sanitizeClerkRedirectSearch(first, "", origin);
  const params = new URLSearchParams(first);
  const destination = new URL(
    clerkRedirectDestination(first, "sign-in", "", origin),
    origin,
  );

  assert.equal(second, first);
  assert.equal(params.get("campaign"), "Café 50%");
  assert.equal(destination.pathname, "/admin/events/event-123");
  assert.equal(destination.searchParams.get("tab"), "résumé 100%");
  assert.equal(destination.searchParams.get("note"), "50% complete");
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

test("re-authentication ends the current session once and redirects to safe sign-in", async () => {
  const calls: Array<{ redirectUrl: string }> = [];
  const redirectTo = signInHrefForProtectedPath(
    "/admin/events/event-123?tab=results",
    "",
    origin,
  );

  await endCurrentSessionForReauthentication(async (options) => {
    calls.push(options);
  }, redirectTo);

  assert.deepEqual(calls, [
    {
      redirectUrl:
        "/sign-in?redirect_url=%2Fadmin%2Fevents%2Fevent-123%3Ftab%3Dresults",
    },
  ]);
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

test("returns to a specific protected event for sign-in and sign-up", () => {
  const signInSearch =
    "?redirect_url=%2Fadmin%2Fevents%2Fevent-123%3Ftab%3Dresults";
  const signUpSearch = new URLSearchParams({
    sign_up_force_redirect_url: "/admin/events/event-456?tab=teams",
  }).toString();

  assert.equal(
    clerkRedirectDestination(signInSearch, "sign-in", "", origin),
    "/admin/events/event-123?tab=results",
  );
  assert.equal(
    clerkRedirectDestination(signUpSearch, "sign-up", "", origin),
    "/admin/events/event-456?tab=teams",
  );
});

test("removes invalid or external destinations without blocking sign-in or sign-up", () => {
  for (const flow of ["sign-in", "sign-up"] as const) {
    for (const unsafe of [
      "https://attacker.example/admin",
      "//attacker.example/admin",
      "%",
      "/admin/../tv",
    ]) {
      const rawSearch = new URLSearchParams([
        ["campaign", "test"],
        ["redirect_url", unsafe],
      ]).toString();
      const safeSearch = sanitizeClerkRedirectSearch(rawSearch, "", origin);

      assert.equal(canonicalClerkSearch(`?${safeSearch}`), safeSearch);
      assert.equal(new URLSearchParams(safeSearch).get("campaign"), "test");
      assert.equal(new URLSearchParams(safeSearch).has("redirect_url"), false);
      assert.equal(clerkRedirectDestination(safeSearch, flow, "", origin), "/admin");
      assert.equal(
        sanitizeClerkRedirectSearch(safeSearch, "", origin),
        safeSearch,
      );
    }
  }
});

test("uses the app's admin path as the fallback", () => {
  assert.equal(defaultAdminRedirect(""), "/admin");
  assert.equal(defaultAdminRedirect("/zero3-pro/"), "/zero3-pro/admin");
});
