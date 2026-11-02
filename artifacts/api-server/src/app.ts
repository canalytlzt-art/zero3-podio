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
import {
  beginRequestStage,
  instrumentRequestMiddleware,
} from "./lib/request-tracing";

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
  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      const requestHost = req.headers.host;
      let sameOrigin = false;
      if (typeof origin === "string" && typeof requestHost === "string") {
        try {
          sameOrigin =
            new URL(origin).host.toLowerCase() === requestHost.toLowerCase();
        } catch {
          sameOrigin = false;
        }
      }
      callback(null, {
        origin: sameOrigin ? origin : false,
        credentials: sameOrigin,
      });
    }),
  );
  const clerkAuthMiddleware = clerkMiddleware((req) => {
    const finishConfiguration = beginRequestStage(req, "configuration");
    const secretKey = process.env.CLERK_SECRET_KEY;
    const proxyHost = getClerkProxyHost(req);
    try {
      const publishableKey = publishableKeyFromHost(
        proxyHost ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      );
      const publishableKeyMode = clerkKeyMode(publishableKey);
      const secretKeyMode = clerkKeyMode(secretKey);
      const origin = safeOriginHost(req.headers.origin);
      const safeProxyHost = safeHostname(proxyHost);
      finishConfiguration(undefined, {
        clerkPublishableKeyConfigured: Boolean(publishableKey),
        clerkSecretKeyConfigured: Boolean(secretKey),
        clerkKeyModesMatch:
          publishableKeyMode === "unknown" || secretKeyMode === "unknown"
            ? undefined
            : publishableKeyMode === secretKeyMode,
        publishableKeyMode,
        secretKeyMode,
        clerkOriginHeaderPresent: Boolean(req.headers.origin),
        clerkProxyHostPresent: Boolean(proxyHost),
        clerkOriginHost: origin,
        clerkProxyHost: safeProxyHost,
      });
      return { publishableKey };
    } catch (error) {
      finishConfiguration(error, {
        clerkPublishableKeyConfigured: false,
        clerkSecretKeyConfigured: Boolean(secretKey),
        clerkOriginHeaderPresent: Boolean(req.headers.origin),
        clerkProxyHostPresent: Boolean(proxyHost),
        clerkOriginHost: safeOriginHost(req.headers.origin),
        clerkProxyHost: safeHostname(proxyHost),
      });
      throw error;
    }
  });
  app.use(instrumentRequestMiddleware("clerk_validation", clerkAuthMiddleware));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (options.beforeRoutes) {
    app.use(options.beforeRoutes);
  }
  app.use("/api", router);
  app.use(apiErrorHandler);

  return app;
}

function clerkKeyMode(key: string | undefined): "test" | "live" | "unknown" {
  if (key?.startsWith("pk_test_") || key?.startsWith("sk_test_")) return "test";
  if (key?.startsWith("pk_live_") || key?.startsWith("sk_live_")) return "live";
  return "unknown";
}

function safeOriginHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? safeHostname(url.host)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeHostname(value: string | undefined): string | undefined {
  if (!value || value.length > 255) return undefined;
  try {
    const parsed = new URL(`https://${value}`);
    return parsed.host === value ? value : undefined;
  } catch {
    return undefined;
  }
}

const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  writeApiFailure(req, res, error);
};
