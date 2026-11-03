import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { workerRequestLogger } from "./lib/worker-logger";
import { d1StagingApi } from "./lib/d1-staging-api";
import { createApp } from "./app";

// This entry is intentionally separate from worker.ts so the production
// zero3-podio Worker continues to use its existing Hyperdrive configuration.
const stagingEnv = env as unknown as { DB: D1Database };
const app = createApp({
  beforeMiddleware: workerRequestLogger(),
  beforeRoutes: d1StagingApi(stagingEnv.DB, { allowRosterApply: true }),
});
app.listen(8080);

export default httpServerHandler({ port: 8080 });
