const DATABASE_UNAVAILABLE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "57P04",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ERR_SOCKET_CLOSED",
]);

export class AuthorizationProviderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "The authorization provider could not be reached.",
      cause === undefined ? undefined : { cause },
    );
    this.name = "AuthorizationProviderUnavailableError";
  }
}

export class AuthorizationSessionInvalidError extends Error {
  constructor(cause?: unknown) {
    super(
      "The authenticated user no longer exists.",
      cause === undefined ? undefined : { cause },
    );
    this.name = "AuthorizationSessionInvalidError";
  }
}

function getErrorChain(error: unknown): Array<Error & { code?: string }> {
  const chain: Array<Error & { code?: string }> = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length < 5) {
    chain.push(current as Error & { code?: string });
    current = (current as Error & { cause?: unknown }).cause;
  }
  return chain;
}

export function isDependencyUnavailable(error: unknown): boolean {
  return (
    isAuthorizationProviderUnavailable(error) ||
    isDatabaseUnavailable(error)
  );
}

export function isAuthorizationProviderUnavailable(error: unknown): boolean {
  return getErrorChain(error).some(
    (item) => item instanceof AuthorizationProviderUnavailableError,
  );
}

export function isDatabaseUnavailable(error: unknown): boolean {
  return getErrorChain(error).some(
    (item) =>
      typeof item.code === "string" &&
      DATABASE_UNAVAILABLE_CODES.has(item.code),
  );
}

export function isInvalidAuthorizationSession(error: unknown): boolean {
  return getErrorChain(error).some(
    (item) => item instanceof AuthorizationSessionInvalidError,
  );
}
