---
name: ZERO3 Worker cutover
description: The intended staged transition from the PostgreSQL Worker to the D1 staging Worker.
---

The user intends to adopt `zero3-games-d1-staging` as the ZERO3 app they use and retire `zero3-podio` later. Do not delete the existing Worker until the D1 app has operational route parity, the Cloudflare GitHub build explicitly deploys the staging Wrangler config, Clerk redirects are verified on the new host, and required data and real-session workflows are validated. Keep PostgreSQL dependencies and `DATABASE_URL` while Preview or the old published Worker still depends on them.

**Why:** The staging Worker is a separate D1 implementation and is not yet a drop-in replacement for the existing PostgreSQL Worker.

**How to apply:** Treat retirement as a gated cutover, not a cleanup step. Confirm Cloudflare Workers Builds configuration in the dashboard, complete D1 route and data validation, then switch user-facing links/QRs and only afterward retire the old Worker.

The remote D1 `zero3-podio-dev` already has the initial tables and the manually added Clerk-user link/index, but its `d1_migrations` ledger is empty. Do not run `wrangler d1 migrations apply` blindly against this database.

**Why:** Applying the checked-in initial migrations to a database whose schema was created outside Wrangler can collide with existing tables or columns, despite the actual schema being present.

**How to apply:** Before any remote migration, compare tables, indexes, and columns with the migration files and decide how to baseline migration history without replacing or deleting existing records.

An unauthenticated 401 confirms only that a protected route reached its session guard; it does not prove the authenticated path works. When reports conflict, correlate the same Worker version, HTTP method, route, and request ID, and keep Replit Preview evidence separate from Cloudflare staging evidence.

**Why:** Staging returned 401 without a session while a browser report showed 501 for the same endpoint; the status difference could not be explained by the unauthenticated check alone.

**How to apply:** Use a real authorized session for protected-route validation. Ensure fallback 501 responses carry a request ID so the exact dispatch failure can be correlated safely.
