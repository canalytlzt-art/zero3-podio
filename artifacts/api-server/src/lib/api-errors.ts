import type { Request, Response } from "express";
import { logger } from "./logger";
import {
  isDependencyUnavailable,
  isInvalidAuthorizationSession,
} from "./api-error-classification";

export function writeApiFailure(
  req: Request,
  res: Response,
  error: unknown,
  fallbackMessage = "Falha interna da API.",
): void {
  const invalidSession = isInvalidAuthorizationSession(error);
  const unavailable = isDependencyUnavailable(error);
  const details =
    error instanceof Error
      ? {
          name: error.name,
          code: (error as Error & { code?: string }).code,
        }
      : { name: "UnknownError" };
  const requestId = (req as Request & { id?: string }).id;

  logger.error(
    {
      error: details,
      requestId,
      statusCode: invalidSession ? 401 : unavailable ? 503 : 500,
    },
    invalidSession
      ? "Authenticated user no longer exists"
      : unavailable
        ? "API dependency unavailable"
        : "Unhandled API request error",
  );

  res.status(invalidSession ? 401 : unavailable ? 503 : 500).json({
    code: invalidSession
      ? "SESSION_INVALID"
      : unavailable
        ? "DEPENDENCY_UNAVAILABLE"
        : "API_INTERNAL_ERROR",
    error: invalidSession
      ? "Sessão inválida."
      : unavailable
        ? "Não foi possível consultar o serviço de autorização ou os dados agora."
        : fallbackMessage,
    ...(requestId ? { requestId } : {}),
  });
}

export { isDependencyUnavailable };

