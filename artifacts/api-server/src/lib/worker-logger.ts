import type { RequestHandler } from "express";
import { serializeSafeError } from "./safe-error";

type WorkerLogContext = {
  error?: unknown;
  authState?: {
    isAuthenticated: boolean;
    hasUserId: boolean;
    hasSessionId: boolean;
    cookiePresent: boolean;
    authorizationPresent: boolean;
  };
  requestId?: string | number;
  cfRayId?: string;
  stage?: string;
  stageEvent?: "start" | "still_running" | "finish";
  responseStatusCode?: number;
  cookiePresent?: boolean;
  authorizationPresent?: boolean;
  clerkPublishableKeyConfigured?: boolean;
  clerkSecretKeyConfigured?: boolean;
  clerkKeyModesMatch?: boolean;
  publishableKeyMode?: "test" | "live" | "unknown";
  secretKeyMode?: "test" | "live" | "unknown";
  clerkOriginHeaderPresent?: boolean;
  clerkProxyHostPresent?: boolean;
  clerkOriginHost?: string;
  clerkProxyHost?: string;
  primaryEmailPresent?: boolean;
  hyperdriveBindingConfigured?: boolean;
  databaseContextReady?: boolean;
  memberFound?: boolean;
  memberActive?: boolean;
  statusCode?: number;
  method?: string;
  path?: string;
  durationMs?: number;
};

function writeLog(
  level: "info" | "error",
  context: WorkerLogContext,
  message: string,
): void {
  const record = {
    level,
    message,
    ...(Object.prototype.hasOwnProperty.call(context, "error")
      ? {
          error: {
            ...serializeSafeError(context.error),
          },
        }
      : {}),
    ...(context.authState ? { authState: context.authState } : {}),
    requestId: context.requestId,
    cfRayId: context.cfRayId,
    stage: context.stage,
    stageEvent: context.stageEvent,
    responseStatusCode: context.responseStatusCode,
    cookiePresent: context.cookiePresent,
    authorizationPresent: context.authorizationPresent,
    clerkPublishableKeyConfigured: context.clerkPublishableKeyConfigured,
    clerkSecretKeyConfigured: context.clerkSecretKeyConfigured,
    clerkKeyModesMatch: context.clerkKeyModesMatch,
    publishableKeyMode: context.publishableKeyMode,
    secretKeyMode: context.secretKeyMode,
    clerkOriginHeaderPresent: context.clerkOriginHeaderPresent,
    clerkProxyHostPresent: context.clerkProxyHostPresent,
    clerkOriginHost: context.clerkOriginHost,
    clerkProxyHost: context.clerkProxyHost,
    primaryEmailPresent: context.primaryEmailPresent,
    hyperdriveBindingConfigured: context.hyperdriveBindingConfigured,
    databaseContextReady: context.databaseContextReady,
    memberFound: context.memberFound,
    memberActive: context.memberActive,
    statusCode: context.statusCode,
    method: context.method,
    path: context.path,
    durationMs: context.durationMs,
  };
  const serialized = JSON.stringify(record);
  if (level === "error") {
    console.error(serialized);
  } else {
    console.info(serialized);
  }
}

export const workerLogger = {
  error(context: WorkerLogContext, message: string): void {
    writeLog("error", context, message);
  },
  info(context: WorkerLogContext, message: string): void {
    writeLog("info", context, message);
  },
};

export function workerRequestLogger(): RequestHandler {
  return (request, response, next) => {
    const requestId = crypto.randomUUID();
    const rawRayId = request.headers["cf-ray"];
    const candidateRayId = Array.isArray(rawRayId) ? rawRayId[0] : rawRayId;
    const cfRayId =
      typeof candidateRayId === "string" &&
      /^[A-Za-z0-9-]{1,100}$/.test(candidateRayId)
        ? candidateRayId
        : undefined;
    (request as typeof request & { id?: string }).id = requestId;
    response.setHeader("x-request-id", requestId);
    const startedAt = Date.now();
    const traceAuthorization = request.path === "/api/zero3/me";
    let completed = false;
    const pendingTimer = traceAuthorization ? setTimeout(() => {
      if (completed) return;
      workerLogger.info({
        requestId, cfRayId, stage: "response", stageEvent: "still_running",
        durationMs: Date.now() - startedAt,
      }, "request still running");
    }, 5_000) : undefined;
    response.once("close", () => {
      if (pendingTimer) clearTimeout(pendingTimer);
    });
    if (traceAuthorization) {
      workerLogger.info(
        {
          requestId,
          cfRayId,
          stage: "response",
          stageEvent: "start",
          method: request.method,
          path: request.path,
          cookiePresent: Boolean(request.headers.cookie),
          authorizationPresent: Boolean(request.headers.authorization),
        },
        "request started",
      );
    }
    response.on("finish", () => {
      completed = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      workerLogger.info(
        {
          requestId,
          cfRayId,
          ...(traceAuthorization
            ? { stage: "response", stageEvent: "finish" as const }
            : {}),
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          responseStatusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        },
        "request completed",
      );
    });
    next();
  };
}
