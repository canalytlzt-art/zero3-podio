# ZERO3 PRO

Authorization incident evidence and local-only diagnostic changes are documented
in `docs/zero3-live/AUTH-500-DIAGNOSTICO.md`. Do not treat the isolated Workerd
TCP failure reproduction as the cause of the reported authenticated Cloudflare 500.

Competition operations for SC/RX events: roster and registrations, heats, a shared sports timer, provisional result capture and correction, manually published podiums, and one public TV leaderboard. The UI is Portuguese.

## Run & operate

- Web preview: workflow `artifacts/zero3-pro: web` (`pnpm --filter @workspace/zero3-pro run dev`)
- API: workflow `artifacts/api-server: API Server` (`pnpm --filter @workspace/api-server run dev`)
- Full typecheck/build: `pnpm run typecheck` / `pnpm run build`
- Frontend checks: `pnpm --filter @workspace/zero3-pro run typecheck` and `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/zero3-pro run build`
- Scoring tests: `pnpm --filter @workspace/api-server run test:scoring`
- Regenerate API hooks and validators after OpenAPI changes: `pnpm --filter @workspace/api-spec run codegen`
- Apply Drizzle schema changes only to the intended Development database: `pnpm --filter @workspace/db run push`
- Seed clearly labeled fictional data in Development only: `pnpm --filter @workspace/api-server run seed:demo`
- Database connections use `DATABASE_URL`; authentication uses the existing Clerk integration. Manage credentials through Replit Secrets.

## Source map

- `artifacts/zero3-pro/src/App.tsx` — `/` and `/inicio` enter `/admin`; Clerk sign-in routes to `/sign-in`; `/tv` is public and `/admin` plus `/operacao` require a Clerk session and an active server-verified role.
- `artifacts/zero3-pro/src/pages/PublicTV.tsx` — read-only, combined 16:9 TV page at `/tv`.
- `artifacts/zero3-pro/src/pages/PublicEntry.tsx` — optional public navigation at `/inicio`.
- `artifacts/zero3-pro/src/pages/OperationPage.tsx` — proof setup, provisional scoring inputs, review, and corrections at protected `/operacao`.
- `artifacts/zero3-pro/src/pages/AdminPages.tsx` — existing events, roster, registrations, heats, timer, and manual podium workflow.
- `artifacts/zero3-pro/src/pages/RosterImportPage.tsx` and `RosterManagePage.tsx` — ADMIN-only import preview/apply and audited team management.
- `artifacts/zero3-pro/src/index.css` — shared styling and TV layout.
- `artifacts/api-server/src/routes/zero3.ts` — authenticated operations and public board API.
- `artifacts/api-server/src/routes/zero3-roster.ts` — guarded roster import and team-management endpoints.
- `docs/zero3-roster-import.md` — source lineage, safeguards, migration, and backup/restore guidance.
- `artifacts/api-server/src/lib/zero3-scoring.ts` — server-owned per-proof and overall scoring.
- `lib/db/src/schema/zero3.ts` — PostgreSQL schema; preserve existing IDs and records.
- `lib/api-spec/openapi.yaml` — API source contract. Generated clients live under `lib/api-client-react` and `lib/api-zod`.
- `docs/zero3-live/` — current scope, implementation progress, and Development test evidence.

## Product rules

- `/` redirects to the administrative entry; `/tv` is the single public read-only TV. `/inicio` does not replace the primary flow. The civil clock uses `America/Sao_Paulo` and remains independent from sports-timer state.
- A single TV displays SC and RX together, proof results, progress, scores, and only manually published podiums. Admin menus/forms stay off the TV.
- Events have four proof slots. Configure official names, units, metric direction, and tie handling only from confirmed event rules.
- For configured proofs, validated results receive 1, 2, 3… points by placement; the lower overall sum wins. The server recalculates from stored results after corrections. Provisional results earn no official points; missing proofs are not zero; incomplete entries are not final champions. Do not invent tie-breakers.
- Preserve timer, registrations, IDs, prior results, role checks, and audit history when changing the app. Keep SC and RX as stored; do not infer that SC means SCALE.
- Fictional seed records and preloaded podium fixtures are marked as demo data and must never be presented as official registrations or results.
- The current spreadsheet contains 29 source teams and has not been applied. For this workbook only, the user approved mapping SCALE to SC; do not generalize that mapping to other sources. Select a destination event, review candidate identities, and explicitly apply; never merge athletes by name.

## Operational cautions

- Confirm the target database is Development before schema pushes or seeding. Production has not been changed by this implementation.
- `seed:demo` is idempotent for its named test event and refuses to run unless `NODE_ENV=development`.
- Use the OpenAPI contract as the source of truth and regenerate clients after changing it.
- Do not bypass Clerk or server-side role checks to make a preview appear signed in.
- An unauthenticated visit to a protected page redirects to `/sign-in` with a sanitized, internal return destination; after Clerk sign-in the API still authorizes the member role. “Entrar novamente” signs out through Clerk before returning to the internal sign-in URL.
- The sign-in/sign-up query guard uses `useSearch()` only as a Wouter navigation subscription. Compare canonical queries derived from `window.location.search`; preserve extras/hash and replace only unsafe or noncanonical redirects.
- Browser API requests use Clerk's same-origin session cookie; do not register `getToken()`/`setAuthTokenGetter()` for this web app. Keep Bearer-token support limited to clients without a browser cookie jar.
- For Cloudflare builds, verify the published Clerk key mode and explicitly configure the public `VITE_CLERK_PROXY_URL` when using the first-party `/api/__clerk` proxy. Replit's managed-key swapping is not a substitute for Cloudflare Build configuration. Never derive or rotate Clerk keys from the `workers.dev` hostname.
- `zero3_members` currently authorizes by the Clerk-verified primary email; it does not persist a Clerk user ID. Do not silently remap or elevate existing members. Any provider-ID migration must be additive and based on verified account identity.
- The browser uses same-origin credentials for protected ZERO3 APIs; the optional Bearer-token getter is not registered for this web app. Do not add Bearer transport without evidence from the real request. If another client registers the getter, it is restricted to protected `/api/zero3/*` paths and may retry one GET, never score writes.
- On sign-out or identity change, remove only private ZERO3 query data; preserve the public-board cache.
- API responses are private/no-store and ETags are disabled to avoid stale 304 responses across session changes. For `/api/zero3/me`, Worker diagnostics correlate `requestId` with Cloudflare `cf-ray` and time Clerk configuration/validation/user lookup, Hyperdrive context/connection, role query, and response. Server-side exceptions retain sanitized message/cause/code/stack; cookies, JWTs, keys, connection strings, and emails must never be logged or returned to clients.
- The browser capture environment cannot validate a real organization login. A local anonymous 401 is not evidence of the reported post-login failure; correlate a real attempt with its response `requestId` before diagnosing Cloudflare/Clerk settings.

## Acesso rápido

- Operadores: abra `/admin` (ou `/`) e autentique-se pela instância Clerk de teste já escolhida. A sessão, sozinha, não concede acesso: o servidor valida o papel ativo existente.
- Operação de resultados: `/operacao`, protegida por sessão e papel operacional.
- Transmissão: `/tv`, pública e somente leitura; participantes não precisam de conta. O endpoint do placar público é GET; lançamentos e alterações permanecem protegidos.
- `/sign-in?redirect_url=%2Fadmin` é um destino interno válido. Não use endereços de login externos nem crie outra instância Clerk. O vínculo atual de papéis usa e-mail primário verificado; não altere ou eleve papéis para contornar erros.
- O login real no domínio Cloudflare ainda precisa ser validado com uma sessão autorizada. A tela local e respostas anônimas não substituem esse teste.

## Cloudflare publication boundary

- Root build command `pnpm run build` runs typecheck and workspace builds. Cloudflare's static output is `artifacts/zero3-pro/dist/public/`; the Worker entry is `artifacts/api-server/src/worker.ts`.
- `pnpm run build:cloudflare` builds the Vite assets then runs a Wrangler dry-run; it does not publish. `pnpm run deploy:cloudflare` performs a real Wrangler deploy with `--keep-vars` but does not build first. Do not use either to claim a GitHub Workers Build was published.
- Cloudflare Workers Builds settings are managed outside the repository. Keep root directory `/`, pnpm 10.26.1, and ensure the pipeline builds the assets before Wrangler deploys `wrangler.toml`. Set `VITE_CLERK_PUBLISHABLE_KEY` in Build Variables; set `VITE_CLERK_PROXY_URL` only after `/api/__clerk` is repaired and tested. Keep `CLERK_SECRET_KEY` and `ZERO3_INITIAL_ADMIN_EMAIL` in runtime Secrets, never in the bundle.
- Do not run `pnpm run deploy:cloudflare` from Replit. Publish only through the GitHub-connected Cloudflare pipeline when explicitly approved.
- A local build or dry-run does not prove the currently published Worker revision, a real Clerk session, role authorization, or production database access. Verify those on the published `zero3-podio` URL after the Cloudflare GitHub deployment completes.
- The demo proof definitions are test fixtures only; official proof descriptions, units, directions, tie rules, and participants remain to be supplied.
- Release gate: run `pnpm run check:cloudflare` and the navigation, auth-session, API error, request-tracing, and scoring tests. Separately verify an authorized Clerk session reaches `/api/zero3/me` with 200 and can read events; a no-session 401, demo login form, or public-board read is not proof of administrative access.
- If a live API returns 5xx, correlate its `requestId` and Cloudflare `cf-ray` with Worker runtime logs before attributing the failure to Clerk or PostgreSQL. Do not change roles, keys, or database contents to mask an unverified cause.
