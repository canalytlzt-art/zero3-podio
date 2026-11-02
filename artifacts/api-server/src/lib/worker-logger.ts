import type { RequestHandler } from "express";

type SafeErrorDetails = {
  name?: string;
  code?: string;
};

type WorkerLogContext = {
  error?: SafeErrorDetails;
  requestId?: string;
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
    ...(context.error
      ? {
          error: {
            name: context.error.name,
            code: context.error.code,
          },
        }
      : {}),
    requestId: context.requestId,
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
    const startedAt = Date.now();
    response.on("finish", () => {
      workerLogger.info(
        {
          requestId: (request as typeof request & { id?: string }).id,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        },
        "request completed",
      );
    });
    next();
  };
}
