import { createApp } from "./app";
import { requestLogger } from "./lib/logger";

const app = createApp({ beforeMiddleware: requestLogger() });

export default app;
