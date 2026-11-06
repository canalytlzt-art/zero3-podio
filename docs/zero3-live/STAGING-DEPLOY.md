# ZERO3 staging deployment

The Cloudflare Workers Builds configuration for `zero3-games-d1-staging`
tracks `feat/zero3-results-by-registration` in this repository.

- Build: `pnpm run build`
- Deploy: `pnpm exec wrangler deploy --config wrangler.d1-staging.toml`
- Worker: `zero3-games-d1-staging`
- Database binding: `DB` → `zero3-podio-dev`
- D1 migrations are not run by the deployment pipeline.

Only this staging Worker is configured to publish from the development branch.
The separate `zero3-podio` Worker configuration is not changed here.
