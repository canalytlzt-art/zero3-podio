import pinoHttp from "pino-http";
import { createApp } from "./app";
import { logger } from "./lib/logger";

const app = createApp({
  beforeMiddleware: pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
});

export default app;
