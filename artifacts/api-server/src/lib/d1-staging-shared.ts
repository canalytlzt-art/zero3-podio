import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { hasSignedInUserSession } from "./auth-session";
import { workerLogger } from "./worker-logger";

export type D1Member = {
  clerk_user_id: string;
  email: string;
  role: string;
  active: number;
};

export const newD1Id = () => crypto.randomUUID();
export const d1Date = (value: string | null | undefined) => value ? new Date(value) : null;
export const d1IsoNow = () => new Date().toISOString();

export type D1FailureKind =
  | "SCHEMA_NOT_READY"
  | "READ_QUOTA_EXCEEDED"
  | "WRITE_QUOTA_EXCEEDED"
  | "PODIUM_VERSION_CONFLICT"
  | "DATABASE_UNAVAILABLE";

function d1ErrorChain(error: unknown): Array<{ message: string; code?: string }> {
  const chain: Array<{ message: string; code?: string }> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "string") {
      chain.push({ message: current });
      break;
    }
    if (typeof current !== "object" && typeof current !== "function") {
      chain.push({ message: String(current) });
      break;
    }
    const record = current as Record<string, unknown>;
    let message = "";
    let code: string | undefined;
    let cause: unknown;
    try {
      if (typeof record.message === "string") message = record.message;
      if (typeof record.code === "string") code = record.code;
      cause = record.cause;
    } catch {
      // Error-like provider objects can expose throwing getters. Treat them as
      // an unknown database failure rather than allowing diagnostics to throw.
    }
    if (message || code) chain.push({ message, code });
    if (cause === current) break;
    current = cause;
  }
  return chain;
}

export function classifyD1Failure(error: unknown): D1FailureKind {
  const chain = d1ErrorChain(error);
  const messages = chain.map((item) => item.message).join("\n").toLowerCase();
  if (/no such (?:table|column|index)|has no column named|no column named/.test(messages)) {
    return "SCHEMA_NOT_READY";
  }
  if (/account has exceeded d1['’]s free tier daily row read limit|daily row read limit/.test(messages)) {
    return "READ_QUOTA_EXCEEDED";
  }
  if (/account has exceeded d1['’]s free tier daily row write limit|daily row write limit/.test(messages)) {
    return "WRITE_QUOTA_EXCEEDED";
  }
  const podiumPrimaryKeyCollision = chain.some((item) => {
    const message = item.message.toLowerCase();
    return /(?:unique|primary key) constraint failed/.test(message) &&
      message.includes("zero3_podium_versions.event_id") &&
      message.includes("zero3_podium_versions.category") &&
      message.includes("zero3_podium_versions.version");
  });
  if (podiumPrimaryKeyCollision) return "PODIUM_VERSION_CONFLICT";
  return "DATABASE_UNAVAILABLE";
}

export function isD1SchemaNotReady(error: unknown): boolean {
  return classifyD1Failure(error) === "SCHEMA_NOT_READY";
}

/**
 * Send a stable client error and a correlated, non-sensitive server log.
 * Raw D1 exception text and bound values are intentionally not logged here.
 */
export function respondD1Failure(
  req: Request,
  res: Response,
  error: unknown,
  stage: string,
  fallbackMessage: string,
): D1FailureKind {
  const kind = classifyD1Failure(error);
  const requestId = (req as Request & { id?: string }).id;
  workerLogger.error(
    {
      requestId,
      method: req.method,
      path: req.path,
      stage,
    },
    `D1 operation failed (${kind})`,
  );
  switch (kind) {
    case "SCHEMA_NOT_READY":
      sendError(req, res, 503, "D1_SCHEMA_NOT_READY",
        "O schema D1 deste ambiente está incompleto; a migration necessária ainda não foi aplicada.");
      break;
    case "READ_QUOTA_EXCEEDED":
      sendError(req, res, 503, "D1_READ_QUOTA_EXCEEDED",
        "O limite diário de leituras do D1 foi atingido. Tente novamente após a renovação do limite em UTC.");
      break;
    case "WRITE_QUOTA_EXCEEDED":
      sendError(req, res, 503, "D1_WRITE_QUOTA_EXCEEDED",
        "O limite diário de gravações do D1 foi atingido. Tente novamente após a renovação do limite em UTC.");
      break;
    case "PODIUM_VERSION_CONFLICT":
      sendError(req, res, 409, "PODIUM_VERSION_CONFLICT",
        "O rascunho do pódio foi alterado em outra operação. Atualize antes de salvar novamente.");
      break;
    case "DATABASE_UNAVAILABLE":
      sendError(req, res, 503, "DATABASE_UNAVAILABLE", fallbackMessage);
      break;
  }
  return kind;
}

export function d1JsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  const requestId = (req as Request & { id?: string }).id;
  res.status(status).json({ code, error: message, ...(requestId ? { requestId } : {}) });
}

/**
 * Returns the verified, active ZERO3 member when the caller has one of the
 * requested roles. The Clerk subject is the database key; email is checked
 * against the verified primary address but never used to grant a role.
 */
export async function requireD1Member(
  req: Request,
  res: Response,
  DB: D1Database,
  roles: readonly string[],
): Promise<D1Member | null> {
  if (!DB) {
    workerLogger.error(
      {
        requestId: (req as Request & { id?: string }).id,
        method: req.method,
        path: req.path,
        stage: "d1_binding",
      },
      "D1 operation failed (BINDING_MISSING)",
    );
    sendError(req, res, 503, "D1_BINDING_MISSING",
      "O binding D1 não está configurado neste ambiente.");
    return null;
  }
  const auth = getAuth(req);
  if (!hasSignedInUserSession(auth) || !auth.userId) {
    sendError(req, res, 401, "SESSION_INVALID", "Sessão inválida.");
    return null;
  }

  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    user = await clerkClient.users.getUser(auth.userId);
  } catch {
    sendError(req, res, 503, "AUTH_PROVIDER_UNAVAILABLE", "Não foi possível validar a sessão agora.");
    return null;
  }
  const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") {
    sendError(req, res, 403, "ZERO3_ROLE_INACTIVE", "Acesso ZERO3 não autorizado.");
    return null;
  }

  let member: D1Member | null;
  try {
    member = await DB.prepare(
      "SELECT clerk_user_id, email, role, active FROM zero3_members WHERE clerk_user_id = ? LIMIT 1",
    ).bind(auth.userId).first<D1Member>();
  } catch (error) {
    respondD1Failure(req, res, error, "authorization_role_query",
      "Não foi possível consultar a autorização agora.");
    return null;
  }
  if (!member || member.active !== 1 ||
      member.email.toLowerCase() !== primary.emailAddress.toLowerCase()) {
    sendError(req, res, 403, "ZERO3_ROLE_INACTIVE", "Acesso ZERO3 não autorizado.");
    return null;
  }
  if (!roles.includes(member.role)) {
    sendError(req, res, 403, "ZERO3_ROLE_INSUFFICIENT", "Permissão insuficiente.");
    return null;
  }
  return member;
}

export function d1ApiError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  sendError(req, res, status, code, message);
}
