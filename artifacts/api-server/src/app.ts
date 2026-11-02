import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { writeApiFailure } from "./lib/api-errors";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

interface AppOptions {
  beforeMiddleware?: RequestHandler;
  beforeRoutes?: RequestHandler;
}

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();

  // API responses carry session-specific data; do not emit ETags that can
  // trigger stale 304 revalidation across Clerk session changes.
  app.set("etag", false);

  if (options.beforeMiddleware) {
    app.use(options.beforeMiddleware);
  }
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(cors({ credentials: true, origin: true }));
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (options.beforeRoutes) {
    app.use(options.beforeRoutes);
  }
  app.use("/api", router);
  app.use(apiErrorHandler);

  return app;
}

const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  writeApiFailure(req, res, error);
};
