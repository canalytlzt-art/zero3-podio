import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { hasSignedInUserSession } from "./auth-session";

export type D1Member = {
  clerk_user_id: string;
  email: string;
  role: string;
  active: number;
};

export const newD1Id = () => crypto.randomUUID();
export const d1Date = (value: string | null | undefined) => value ? new Date(value) : null;
export const d1IsoNow = () => new Date().toISOString();

export function isD1SchemaNotReady(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bno such (?:table|column|index)\b|\bhas no column named\b|\bno column named\b/i.test(message);
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
  } catch {
    sendError(req, res, 503, "DATABASE_UNAVAILABLE", "Não foi possível consultar a autorização agora.");
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
