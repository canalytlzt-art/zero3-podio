export const CLERK_REDIRECT_QUERY_KEYS = [
  "redirect_url",
  "sign_in_force_redirect_url",
  "sign_in_fallback_redirect_url",
  "sign_up_force_redirect_url",
  "sign_up_fallback_redirect_url",
] as const;

/**
 * Returns a canonical query representation without a leading question mark.
 * URLSearchParams handles equivalent percent encodings, spaces, and Unicode.
 */
export function canonicalClerkSearch(search: string): string {
  return new URLSearchParams(search).toString();
}

export function clerkLocationWithSearch(
  pathname: string,
  search: string,
  hash: string,
): string {
  return `${pathname}${search ? `?${search}` : ""}${hash}`;
}

const protectedRoutes = new Set([
  "/admin",
  "/admin/events",
  "/admin/roster",
  "/admin/members",
  "/operacao",
]);

function removeBasePath(pathname: string, basePath: string): string {
  const base = basePath.replace(/\/+$/, "");
  if (!base) return pathname;
  if (pathname === base) return "/";
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

function isProtectedPath(pathname: string): boolean {
  return (
    protectedRoutes.has(pathname) ||
    /^\/admin\/events\/[^/]+$/.test(pathname)
  );
}

export function safeProtectedRedirect(
  value: string | null | undefined,
  basePath: string,
  origin: string,
): string | null {
  const candidate = value?.trim();
  if (
    !candidate ||
    candidate.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }

  let target: URL;
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(origin).origin;
    target = new URL(candidate, expectedOrigin);
  } catch {
    return null;
  }

  if (target.origin !== expectedOrigin || target.username || target.password) {
    return null;
  }

  const routePath = removeBasePath(target.pathname, basePath)
    .replace(/\/+$/, "") || "/";
  if (!isProtectedPath(routePath)) return null;

  const base = basePath.replace(/\/+$/, "");
  const appPath = base ? `${base}${routePath}` : routePath;
  const query = new URLSearchParams(target.search);
  for (const key of CLERK_REDIRECT_QUERY_KEYS) query.delete(key);
  const queryString = query.toString();

  return `${appPath}${queryString ? `?${queryString}` : ""}${target.hash}`;
}

export function sanitizeClerkRedirectSearch(
  search: string,
  basePath: string,
  origin: string,
): string {
  const params = new URLSearchParams(search);

  for (const key of CLERK_REDIRECT_QUERY_KEYS) {
    const values = params.getAll(key);
    if (values.length === 0) continue;

    const safeDestination = values
      .map((value) => safeProtectedRedirect(value, basePath, origin))
      .find((value): value is string => value !== null);

    params.delete(key);
    if (safeDestination) params.set(key, safeDestination);
  }

  return params.toString();
}

export function clerkRedirectDestination(
  search: string,
  flow: "sign-in" | "sign-up",
  basePath: string,
  origin: string,
): string {
  const params = new URLSearchParams(search);
  const candidates =
    flow === "sign-in"
      ? [
          params.get("sign_in_force_redirect_url"),
          params.get("redirect_url"),
          params.get("sign_in_fallback_redirect_url"),
        ]
      : [
          params.get("sign_up_force_redirect_url"),
          params.get("redirect_url"),
          params.get("sign_up_fallback_redirect_url"),
        ];

  for (const candidate of candidates) {
    const destination = safeProtectedRedirect(candidate, basePath, origin);
    if (destination) return destination;
  }

  return defaultAdminRedirect(basePath);
}

export function signInHrefForProtectedPath(
  pathname: string,
  basePath: string,
  origin: string,
): string {
  const destination = safeProtectedRedirect(pathname, basePath, origin);
  if (!destination) return "/sign-in";
  return `/sign-in?${new URLSearchParams({ redirect_url: destination })}`;
}

export type CurrentSessionSignOut = (options: {
  redirectUrl: string;
}) => Promise<unknown>;

export function endCurrentSessionForReauthentication(
  signOut: CurrentSessionSignOut,
  redirectTo: string,
): Promise<unknown> {
  return signOut({ redirectUrl: redirectTo });
}

export function defaultAdminRedirect(basePath: string): string {
  const base = basePath.replace(/\/+$/, "");
  return `${base}/admin` || "/admin";
}
