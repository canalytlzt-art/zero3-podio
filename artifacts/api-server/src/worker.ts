import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import {
  createRequestDatabase,
  withDatabaseContext,
} from "@workspace/db";
import type { RequestHandler } from "express";
import { workerRequestLogger } from "./lib/worker-logger";
import { createApp } from "./app";
import { beginRequestStage, requestIdOf } from "./lib/request-tracing";

const databaseMiddleware: RequestHandler = (request, response, next) => {
  if (request.path === "/api/healthz") {
    next();
    return;
  }

  const finishContext = beginRequestStage(request, "hyperdrive_context", {
    hyperdriveBindingConfigured: Boolean(env.HYPERDRIVE?.connectionString),
  });
  try {
    const database = createRequestDatabase(env.HYPERDRIVE.connectionString, {
      max: 2,
    });
    finishContext(undefined, { databaseContextReady: true });
    withDatabaseContext(database, next);
  } catch (error) {
    finishContext(error, { databaseContextReady: false });
    response.status(503).json({
      code: "DATABASE_UNAVAILABLE",
      error: "Banco da operação indisponível.",
      ...(requestIdOf(request) ? { requestId: requestIdOf(request) } : {}),
    });
  }
};

const app = createApp({
  beforeMiddleware: workerRequestLogger(),
  beforeRoutes: databaseMiddleware,
});
app.listen(8080);

export default httpServerHandler({ port: 8080 });
