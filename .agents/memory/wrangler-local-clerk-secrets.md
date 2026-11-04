---
name: Wrangler local Clerk configuration
description: Wrangler local needs its own runtime secret configuration for Clerk-authenticated route tests.
---

Wrangler local does not automatically receive Replit Secrets. When Clerk middleware is enabled, a local request can fail with a missing-secret 500 before reaching the route, even though the Replit Preview and Cloudflare runtime have their own credentials.

**Why:** A local D1 route check failed during Clerk initialization because Wrangler had no local Clerk secret configured; it did not indicate a D1 route or database failure.

**How to apply:** For local authenticated Worker tests, configure the needed Clerk runtime variables through Wrangler's ignored local secret configuration. Never print, commit, or bypass authentication to make the test pass.
