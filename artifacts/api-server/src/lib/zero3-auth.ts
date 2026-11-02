import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  withCurrentDatabaseClient,
  zero3MembersTable,
} from "@workspace/db";
import { writeApiFailure } from "./api-errors";
import {
  AuthorizationProviderUnavailableError,
  AuthorizationSessionInvalidError,
} from "./api-error-classification";
import { hasSignedInUserSession } from "./auth-session";
import { beginRequestStage } from "./request-tracing";

export type Zero3Role = "ADMIN" | "JUIZ_CHEFE" | "JUIZ";
export type Zero3MemberContext = {
  email: string;
  role: Zero3Role;
};

export type Zero3Request = Request & {
  zero3Member?: Zero3MemberContext;
};

export async function resolveZero3Member(
  req: Request,
): Promise<{ userId: string; member: Zero3MemberContext } | null> {
  const auth = getAuth(req);
  if (!hasSignedInUserSession(auth)) return null;
  const { userId } = auth;
  if (!userId) return null;

  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  const finishClerkLookup = beginRequestStage(req, "clerk_user_lookup");
  try {
    user = await clerkClient.users.getUser(userId);
    finishClerkLookup(undefined, {
      primaryEmailPresent: Boolean(user.primaryEmailAddressId),
    });
  } catch (error) {
    finishClerkLookup(error);
    const status =
      error instanceof Error
        ? (error as Error & { status?: number; statusCode?: number }).status ??
          (error as Error & { statusCode?: number }).statusCode
        : undefined;
    if (status === 404) {
      throw new AuthorizationSessionInvalidError(error);
    }
    throw new AuthorizationProviderUnavailableError(error);
  }
  const email = user.emailAddresses
    .find((address) => address.id === user.primaryEmailAddressId)
    ?.emailAddress.toLowerCase();
  if (!email) return null;

  let connectionAcquired = false;
  const finishConnection = beginRequestStage(req, "hyperdrive_connection");
  let member: typeof zero3MembersTable.$inferSelect | undefined;
  try {
    member = await withCurrentDatabaseClient(async (database) => {
      const finishRoleQuery = beginRequestStage(
        req,
        "authorization_role_query",
      );
      try {
        let [currentMember] = await database
          .select()
          .from(zero3MembersTable)
          .where(eq(zero3MembersTable.email, email))
          .limit(1);

        const initialAdminEmail = process.env.ZERO3_INITIAL_ADMIN_EMAIL
          ?.trim()
          .toLowerCase();
        if (!currentMember && initialAdminEmail && email === initialAdminEmail) {
          await database
            .insert(zero3MembersTable)
            .values({ email, role: "ADMIN", active: true })
            .onConflictDoNothing();
          [currentMember] = await database
            .select()
            .from(zero3MembersTable)
            .where(eq(zero3MembersTable.email, email))
            .limit(1);
        }

        finishRoleQuery(undefined, {
          memberFound: Boolean(currentMember),
          memberActive: Boolean(currentMember?.active),
        });
        return currentMember;
      } catch (error) {
        finishRoleQuery(error);
        throw error;
      }
    }, () => {
      connectionAcquired = true;
      finishConnection();
    });
  } catch (error) {
    if (!connectionAcquired) finishConnection(error);
    throw error;
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
          const authenticatedUser = hasSignedInUserSession(getAuth(req));
          const requestId = (req as Request & { id?: string }).id;
          res.status(authenticatedUser ? 403 : 401).json({
            code: authenticatedUser ? "ZERO3_ROLE_INACTIVE" : "SESSION_INVALID",
            error: authenticatedUser
              ? "Acesso ZERO3 não autorizado."
              : "Sessão inválida.",
            ...(requestId ? { requestId } : {}),
          });
          return;
        }
        if (!roles.includes(resolved.member.role)) {
          const requestId = (req as Request & { id?: string }).id;
          res.status(403).json({
            code: "ZERO3_ROLE_INSUFFICIENT",
            error: "Permissão insuficiente.",
            ...(requestId ? { requestId } : {}),
          });
          return;
        }
        (req as Zero3Request).zero3Member = resolved.member;
        next();
      })
      .catch((error: unknown) => {
        writeApiFailure(req, res, error, "Não foi possível verificar a autorização.");
      });
  };
}
