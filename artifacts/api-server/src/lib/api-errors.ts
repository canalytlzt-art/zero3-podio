import type { Request, Response } from "express";
import { workerLogger } from "./worker-logger";
import {
  isAuthorizationProviderUnavailable,
  isDependencyUnavailable,
  isDatabaseUnavailable,
  isInvalidAuthorizationSession,
} from "./api-error-classification";

export function writeApiFailure(
  req: Request,
  res: Response,
  error: unknown,
  fallbackMessage = "Falha interna da API.",
): void {
  const invalidSession = isInvalidAuthorizationSession(error);
  const providerUnavailable = isAuthorizationProviderUnavailable(error);
  const databaseUnavailable = isDatabaseUnavailable(error);
  const unavailable = providerUnavailable || databaseUnavailable;
  const statusCode = invalidSession ? 401 : unavailable ? 503 : 500;
  const code = invalidSession
    ? "SESSION_INVALID"
    : providerUnavailable
      ? "AUTH_PROVIDER_UNAVAILABLE"
      : databaseUnavailable
        ? "DATABASE_UNAVAILABLE"
        : "API_INTERNAL_ERROR";
  const message = invalidSession
    ? "Sessão inválida."
    : providerUnavailable
      ? "Não foi possível validar a sessão com o provedor de autenticação agora."
      : databaseUnavailable
        ? "Não foi possível consultar o banco de dados agora."
        : fallbackMessage;
  const details =
    error instanceof Error
      ? {
          name: error.name,
          code: (error as Error & { code?: string }).code,
        }
      : { name: "UnknownError" };
  const requestId = (req as Request & { id?: string }).id;

  workerLogger.error(
    {
      error: details,
      requestId,
      statusCode,
    },
    invalidSession
      ? "Authenticated user no longer exists"
      : providerUnavailable
        ? "Authorization provider unavailable"
        : databaseUnavailable
          ? "Database unavailable"
        : "Unhandled API request error",
  );

  res.status(statusCode).json({
    code,
    error: message,
    ...(requestId ? { requestId } : {}),
  });
}

export { isDependencyUnavailable };

