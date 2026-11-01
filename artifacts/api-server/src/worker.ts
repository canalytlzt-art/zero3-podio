import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { configureDatabase } from "@workspace/db";
import type { RequestHandler } from "express";
import { createApp } from "./app";

const databaseMiddleware: RequestHandler = (_request, response, next) => {
  try {
    configureDatabase(env.HYPERDRIVE.connectionString, { max: 5 });
    next();
  } catch {
    response.status(503).json({
      error: "Cloudflare PostgreSQL binding is not configured.",
    });
  }
};

const app = createApp({ beforeRoutes: databaseMiddleware });
app.listen(8080);

export default httpServerHandler({ port: 8080 });
