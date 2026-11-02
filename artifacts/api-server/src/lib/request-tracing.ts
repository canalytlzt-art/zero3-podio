import type { Request, Response } from "express";
import { serializeSafeError } from "./safe-error";
import { workerLogger } from "./worker-logger";

export type RequestStageName =
  | "configuration"
  | "clerk_validation"
  | "hyperdrive_context"
  | "hyperdrive_connection"
  | "clerk_user_lookup"
  | "authorization_role_query"
  | "response";

export type SafeStageMetadata = {
  clerkPublishableKeyConfigured?: boolean;
  clerkSecretKeyConfigured?: boolean;
  clerkKeyModesMatch?: boolean;
  publishableKeyMode?: "test" | "live" | "unknown";
  secretKeyMode?: "test" | "live" | "unknown";
  hyperdriveBindingConfigured?: boolean;
  databaseContextReady?: boolean;
  clerkOriginHeaderPresent?: boolean;
  clerkProxyHostPresent?: boolean;
  clerkOriginHost?: string;
  clerkProxyHost?: string;
  primaryEmailPresent?: boolean;
  memberFound?: boolean;
  memberActive?: boolean;
  responseStatusCode?: number;
};

export function requestIdOf(req: Request): string | undefined {
  const id = (req as Request & { id?: string | number }).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

export function platformRayIdOf(req: Request): string | undefined {
  const value = req.headers["cf-ray"];
  const rayId = Array.isArray(value) ? value[0] : value;
  return typeof rayId === "string" && /^[A-Za-z0-9-]{1,100}$/.test(rayId)
    ? rayId
    : undefined;
}

export function shouldTraceAuthorizationRequest(req: Request): boolean {
  return req.path === "/api/zero3/me";
}

export function beginRequestStage(
  req: Request,
  stage: RequestStageName,
  metadata: SafeStageMetadata = {},
): (error?: unknown, finalMetadata?: SafeStageMetadata) => void {
  if (!shouldTraceAuthorizationRequest(req)) return () => {};
  const startedAt = performance.now();
  const requestId = requestIdOf(req);
  const cfRayId = platformRayIdOf(req);
  workerLogger.info(
    { requestId, cfRayId, stage, stageEvent: "start", ...metadata },
    `${stage} started`,
  );

  let finished = false;
  return (error, finalMetadata = {}) => {
    if (finished) return;
    finished = true;
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    workerLogger[error === undefined ? "info" : "error"](
      {
        requestId,
        cfRayId,
        stage,
        stageEvent: "finish",
        durationMs,
        ...finalMetadata,
        ...(error === undefined ? {} : { error: serializeSafeError(error) }),
      },
      `${stage} ${error === undefined ? "finished" : "failed"}`,
    );
  };
}

export function instrumentRequestMiddleware(
  stage: RequestStageName,
  middleware: (req: Request, res: Response, next: (error?: unknown) => void) => void,
) {
  return (req: Request, res: Response, next: (error?: unknown) => void): void => {
    const finishStage = beginRequestStage(req, stage);
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      finishStage(error, { responseStatusCode: res.statusCode });
    };

    res.once("finish", () => finish());
    res.once("close", () => finish());
    let advanced = false;
    const advance = (error?: unknown) => {
      if (advanced) return;
      advanced = true;
      finish(error);
      next(error);
    };
    try {
      const result = middleware(req, res, advance) as unknown;
      if (
        result &&
        typeof result === "object" &&
        "then" in result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        void Promise.resolve(result).catch(advance);
      }
    } catch (error) {
      advance(error);
    }
  };
}
