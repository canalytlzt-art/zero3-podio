export type SafeErrorDetails = {
  name: string;
  message?: string;
  code?: string;
  stack?: string;
  cause?: SafeErrorDetails;
  errors?: SafeErrorDetails[];
};

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]"],
  [/\b(?:set-cookie|cookie)\s*[:=]\s*[^\r\n]*/gi, "[REDACTED_COOKIE]"],
  [
    /\b(?:authorization|proxy-authorization)\s*[:=]\s*[^\r\n]*/gi,
    "[REDACTED_AUTH_HEADER]",
  ],
  [/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]"],
  [/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/gi, "[REDACTED_CLERK_KEY]"],
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?\b/g,
    "[REDACTED_JWT]",
  ],
  [
    /\b[\w.-]*(?:database[_-]?url|connection[_-]?string|password|passwd|secret(?:[_-]?key)?|token|authorization|cookie|api[_-]?key)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "[REDACTED_SETTING]",
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
];

export function sanitizeErrorText(value: unknown, maxLength = 12_000): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  let safe = value;
  for (const [pattern, replacement] of REDACTIONS) {
    safe = safe.replace(pattern, replacement);
  }
  return safe.length > maxLength ? `${safe.slice(0, maxLength)}…[truncated]` : safe;
}

export function serializeSafeError(
  error: unknown,
  depth = 0,
): SafeErrorDetails {
  if (depth > 4) return { name: "ErrorCauseDepthLimit" };

  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    const details: SafeErrorDetails = {
      name: sanitizeErrorText(error.name, 160) ?? "Error",
      message: sanitizeErrorText(error.message),
    };
    if (
      typeof candidate.code === "string" &&
      /^[A-Za-z0-9_.-]{1,100}$/.test(candidate.code)
    ) {
      details.code = candidate.code;
    } else if (typeof candidate.code === "string") {
      details.code = sanitizeErrorText(candidate.code, 100);
    }
    details.stack = sanitizeErrorText(error.stack, 12_000);

    if (candidate.cause !== undefined) {
      details.cause = serializeSafeError(candidate.cause, depth + 1);
    }
    if (Array.isArray(candidate.errors)) {
      details.errors = candidate.errors
        .slice(0, 4)
        .map((item) => serializeSafeError(item, depth + 1));
    }
    return details;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const read = (key: string): unknown => {
      try {
        return record[key];
      } catch {
        return undefined;
      }
    };
    const name = read("name");
    const message = read("message");
    const code = read("code");
    const stack = read("stack");
    const details: SafeErrorDetails = {
      name:
        (typeof name === "string" && sanitizeErrorText(name, 160)) ||
        "UnknownError",
      message: sanitizeErrorText(message),
      stack: sanitizeErrorText(stack),
    };
    if (
      typeof code === "string" &&
      /^[A-Za-z0-9_.-]{1,100}$/.test(code)
    ) {
      details.code = code;
    } else if (typeof code === "string") {
      details.code = sanitizeErrorText(code, 100);
    }
    const cause = read("cause");
    if (cause !== undefined) details.cause = serializeSafeError(cause, depth + 1);
    const errors = read("errors");
    if (Array.isArray(errors)) {
      details.errors = errors
        .slice(0, 4)
        .map((item) => serializeSafeError(item, depth + 1));
    }
    return details;
  }

  let message: string;
  try {
    message = String(error);
  } catch {
    message = "[Unprintable thrown value]";
  }
  return {
    name: error === null ? "NullError" : typeof error,
    message: sanitizeErrorText(message),
  };
}
