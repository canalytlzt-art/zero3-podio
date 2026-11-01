# ZERO3 PRO

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

- `artifacts/zero3-pro/src/App.tsx` — public routes, Clerk sign-in, and role-protected operations.
- `artifacts/zero3-pro/src/pages/PublicTV.tsx` — read-only, combined 16:9 TV page at `/` and `/tv`.
- `artifacts/zero3-pro/src/pages/PublicEntry.tsx` — optional public navigation at `/inicio`.
- `artifacts/zero3-pro/src/pages/OperationPage.tsx` — proof setup, provisional scoring inputs, review, and corrections at protected `/operacao`.
- `artifacts/zero3-pro/src/pages/AdminPages.tsx` — existing events, roster, registrations, heats, timer, and manual podium workflow.
- `artifacts/zero3-pro/src/index.css` — shared styling and TV layout.
- `artifacts/api-server/src/routes/zero3.ts` — authenticated operations and public board API.
- `artifacts/api-server/src/lib/zero3-scoring.ts` — server-owned per-proof and overall scoring.
- `lib/db/src/schema/zero3.ts` — PostgreSQL schema; preserve existing IDs and records.
- `lib/api-spec/openapi.yaml` — API source contract. Generated clients live under `lib/api-client-react` and `lib/api-zod`.
- `docs/zero3-live/` — current scope, implementation progress, and Development test evidence.

## Product rules

- `/` and `/tv` show the same read-only public TV; `/inicio` is optional navigation. The civil clock uses `America/Sao_Paulo` and remains independent from sports-timer state.
- A single TV displays SC and RX together, proof results, progress, scores, and only manually published podiums. Admin menus/forms stay off the TV.
- Events have four proof slots. Configure official names, units, metric direction, and tie handling only from confirmed event rules.
- For configured proofs, validated results receive 1, 2, 3… points by placement; the lower overall sum wins. The server recalculates from stored results after corrections. Provisional results earn no official points; missing proofs are not zero; incomplete entries are not final champions. Do not invent tie-breakers.
- Preserve timer, registrations, IDs, prior results, role checks, and audit history when changing the app. Keep SC and RX as stored; do not infer that SC means SCALE.
- Fictional seed records and preloaded podium fixtures are marked as demo data and must never be presented as official registrations or results.

## Operational cautions

- Confirm the target database is Development before schema pushes or seeding. Production has not been changed by this implementation.
- `seed:demo` is idempotent for its named test event and refuses to run unless `NODE_ENV=development`.
- Use the OpenAPI contract as the source of truth and regenerate clients after changing it.
- Do not bypass Clerk or server-side role checks to make a preview appear signed in.
- The demo proof definitions are test fixtures only; official proof descriptions, units, directions, tie rules, and participants remain to be supplied.
