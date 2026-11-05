---
name: Cloudflare staging builds
description: Workers Builds authentication, production branches, and preview behavior for the ZERO3 Cloudflare Workers.
---

Use Cloudflare Workers Builds as the sole automatic publisher for the staging Worker. Configure its production branch to the intended staging branch and its deploy command to explicitly select the D1 Wrangler file. Disable staging previews when pushes should publish only to that Worker.

**Why:** Workers Builds rejects account-scoped API tokens with “Invalid token”; its configuration API needs a user-scoped token with Workers Builds Configuration edit and Workers Scripts read. Also, non-production branch pushes create Preview builds when Previews are enabled. The generic `wrangler preview` command failed because the project has no Preview-safe `[previews]` binding configuration.

**How to apply:** Before diagnosing a missing staging deployment, check the Workers Builds production branch, preview toggle, build/deploy commands, and build-time Clerk key. Do not modify the separate production Worker just to make a staging Preview pass; verify that only staging publishes from its development branch.
