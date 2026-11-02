import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import {
  createRequestDatabase,
  withDatabaseContext,
} from "@workspace/db";
import type { RequestHandler } from "express";
import { requestLogger } from "./lib/logger";
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
    request.log.error(
      { error: error instanceof Error ? { name: error.name } : { name: "UnknownError" } },
      "Unable to initialize request database context",
    );
    response.status(503).json({
      error: "Banco da operação indisponível.",
    });
  }
};

const app = createApp({
  beforeMiddleware: requestLogger(),
  beforeRoutes: databaseMiddleware,
});
app.listen(8080);

export default httpServerHandler({ port: 8080 });
