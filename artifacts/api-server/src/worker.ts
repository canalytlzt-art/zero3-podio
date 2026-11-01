import { httpServerHandler } from "cloudflare:node";
import { configureDatabase } from "@workspace/db";
import app from "./app";

const port = 8080;
const server = app.listen(port);
const expressHandler = httpServerHandler(server);

export default {
  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    try {
      configureDatabase(env.HYPERDRIVE.connectionString, { max: 5 });
    } catch {
      return Response.json(
        { error: "Cloudflare PostgreSQL binding is not configured." },
        { status: 503 },
      );
    }

    return expressHandler.fetch(request, env, context);
  },
};
