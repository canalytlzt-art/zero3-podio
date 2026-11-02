---
name: Cloudflare PostgreSQL boundary
description: External-connectivity limits between Replit-managed PostgreSQL and Cloudflare Hyperdrive.
---

Replit-managed PostgreSQL is for application access inside Replit and does not expose public TCP connectivity or a configurable public firewall. Cloudflare Hyperdrive must not connect directly to it. The Cloudflare test Worker uses a separate Neon test database; Replit's database and records remain unchanged. The Neon test database also contains Neon Auth relations and must not be treated as wholly empty.

**Why:** Replit documentation confirmed the managed database has no public IP/firewall configuration. A separate Neon test database allows Cloudflare testing without moving or changing Replit data. Its existing `neon_auth.project_config` row was preserved when the ZERO3 schema was added. The user specified Cloudflare publication through the GitHub integration.

**How to apply:** Keep Replit's API on its current `DATABASE_URL`; use Hyperdrive only for the separate Neon test database. Inspect before schema changes and preserve `neon_auth` relations. Use Wrangler for local checks only; do not deploy or push from this workspace unless explicitly asked. Do not copy or migrate Replit records, bind Hyperdrive to the Replit-managed database, or use a tunnel/personal proxy.

For Worker requests, carry the Drizzle handle in `AsyncLocalStorage` so concurrent requests never depend on a mutable global current-database pointer. A concurrency-safe pool may be shared within the isolate only while it remains bound to that isolate's single Hyperdrive connection string; keep Node/Replit's `DATABASE_URL` pool separate.

**Why:** Cloudflare reuses Worker isolates across requests, and request-scoped state must remain isolated while the underlying pool safely multiplexes connections.

**How to apply:** Wrap each Worker request in its own async database context. Do not mutate a module-global Drizzle handle or allow the Replit and Hyperdrive connection targets to share a pool.

Treat a GitHub push as source delivery, not proof of Cloudflare publication. A public health response can still come from an older Worker revision.

**Why:** The repository's GitHub main advanced while the public Worker continued serving older assets and behavior.

**How to apply:** After an authorized push, verify a distinctive changed behavior or build marker on the Cloudflare URL; do not infer deployment from GitHub main alone.

Keep Node/Replit logging out of the Cloudflare Worker import graph. The Node logger may use `pino-http` and transports; Worker request and API-error logging should use a Worker-compatible logger that emits only allowlisted metadata.

**Why:** The Workers runtime can reject Node logger internals during initialization even when the bundle passes a dry-run.

**How to apply:** Check transitive imports from `worker.ts`, then test a real `wrangler dev --local` startup and HTTP request. For local Hyperdrive emulation, Wrangler requires a local connection string for each binding; use a disposable placeholder only for routes that do not query the database.
