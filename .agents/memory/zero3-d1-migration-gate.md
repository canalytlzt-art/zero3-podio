---
name: ZERO3 D1 staging migration gate
description: Operational guardrail for keeping the ZERO3 staging D1 schema aligned with its Worker.
---

Before releasing a Worker that depends on new D1 columns or tables, compare the remote `d1_migrations` history and relevant schema with the migration files. A successful build or dry-run does not apply the D1 migrations. Missing schema can surface as generic 503s for finalization or ranking routes.

Read-only verification on 2026-11-06 found `zero3-podio-dev` (ID `60416dac-0da6-48d9-a2d2-c267760f4b7a`) had migrations through `0013`; `zero3_podium_versions` lacked `arbitration_note`, which migration `0016` adds and the D1 podium-draft save already writes. The pending chain also includes `0014` (rebuilds battery timer rows) and `0015` (adds duration-audit data).

**Why:** the staging Worker code was ahead of the remote D1 schema; migrations 0010 and 0011 were absent and the server initially obscured the database cause.

**Why:** the podium draft save's generic HTTP 409 is explained by this missing column, while the earlier pending migrations affect timer/audit schema and must not be skipped or blindly applied.

**How to apply:** inspect remote migration history and `PRAGMA table_info`/`sqlite_master`, prepare a backup, and get approval before applying remote migrations. Review migrations 0014–0016 against the live schema as a chain. Do not change Replit PostgreSQL or production as part of a staging D1 migration.
