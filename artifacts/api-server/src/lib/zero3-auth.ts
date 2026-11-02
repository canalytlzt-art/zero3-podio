import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, zero3MembersTable } from "@workspace/db";
import { logger } from "./logger";

export type Zero3Role = "ADMIN" | "JUIZ_CHEFE" | "JUIZ";
export type Zero3MemberContext = {
  email: string;
  role: Zero3Role;
};

export type Zero3Request = Request & {
  zero3Member?: Zero3MemberContext;
};

function logRoleResolutionFailure(req: Request, error: unknown): void {
  const details =
    error instanceof Error
      ? { name: error.name, code: (error as Error & { code?: string }).code }
      : { name: "UnknownError" };
  const requestLog = (req as Request & {
    log?: { error: (context: unknown, message: string) => void };
  }).log;
  if (requestLog) {
    requestLog.error({ error: details }, "Unable to resolve ZERO3 role");
  } else {
    logger.error({ error: details }, "Unable to resolve ZERO3 role");
  }
}

export async function resolveZero3Member(
  req: Request,
): Promise<{ userId: string; member: Zero3MemberContext } | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;

  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses
    .find((address) => address.id === user.primaryEmailAddressId)
    ?.emailAddress.toLowerCase();
  if (!email) return null;

  let [member] = await db
    .select()
    .from(zero3MembersTable)
    .where(eq(zero3MembersTable.email, email))
    .limit(1);

  const initialAdminEmail = process.env.ZERO3_INITIAL_ADMIN_EMAIL
    ?.trim()
    .toLowerCase();
  if (!member && initialAdminEmail && email === initialAdminEmail) {
    await db
      .insert(zero3MembersTable)
      .values({ email, role: "ADMIN", active: true })
      .onConflictDoNothing();
    [member] = await db
      .select()
      .from(zero3MembersTable)
      .where(eq(zero3MembersTable.email, email))
      .limit(1);
  }

  if (!member || !member.active) return null;
  return {
    userId,
    member: { email, role: member.role as Zero3Role },
  };
}

export function requireZero3Roles(
  roles: Zero3Role[],
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next): void => {
    void resolveZero3Member(req)
      .then((resolved) => {
        if (!resolved) {
          const { userId } = getAuth(req);
          res.status(userId ? 403 : 401).json({
            error: userId
              ? "Acesso ZERO3 não autorizado."
              : "Sessão inválida.",
          });
          return;
        }
        if (!roles.includes(resolved.member.role)) {
          res.status(403).json({ error: "Permissão insuficiente." });
          return;
        }
        (req as Zero3Request).zero3Member = resolved.member;
        next();
      })
      .catch((error: unknown) => {
        logRoleResolutionFailure(req, error);
        res.status(503).json({
          error: "Não foi possível verificar a autorização agora.",
        });
      });
  };
}
