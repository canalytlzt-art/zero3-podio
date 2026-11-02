import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import {
  createRequestDatabase,
  withDatabaseContext,
} from "@workspace/db";
import type { RequestHandler } from "express";
import { workerLogger, workerRequestLogger } from "./lib/worker-logger";
import { createApp } from "./app";

const databaseMiddleware: RequestHandler = (request, response, next) => {
  if (request.path === "/api/healthz") {
    next();
    return;
  }

  try {
    const database = createRequestDatabase(env.HYPERDRIVE.connectionString, {
      max: 2,
    });
    withDatabaseContext(database, next);
  } catch (error) {
    workerLogger.error(
      {
        error: error instanceof Error
          ? {
              name: error.name,
              code: (error as Error & { code?: string }).code,
            }
          : { name: "UnknownError" },
      },
      "Unable to initialize request database context",
    );
    response.status(503).json({
      code: "DEPENDENCY_UNAVAILABLE",
      error: "Banco da operação indisponível.",
    });
  }
};

const app = createApp({
  beforeMiddleware: workerRequestLogger(),
  beforeRoutes: databaseMiddleware,
});
app.listen(8080);

export default httpServerHandler({ port: 8080 });
