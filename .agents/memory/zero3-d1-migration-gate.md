---
name: ZERO3 D1 staging migration gate
description: Operational guardrail for keeping the ZERO3 staging D1 schema aligned with its Worker.
---

Before releasing a Worker that depends on new D1 columns or tables, compare the remote `d1_migrations` history and relevant schema with the migration files. A successful build or dry-run does not apply the D1 migrations. Missing schema can surface as generic 503s for finalization or ranking routes.

**Why:** the staging Worker code was ahead of the remote D1 schema; migrations 0010 and 0011 were absent and the server initially obscured the database cause.

**How to apply:** inspect remote migration history and `PRAGMA table_info`/`sqlite_master`, prepare a backup, and get approval before applying remote migrations. Do not change Replit PostgreSQL or production as part of a staging D1 migration.
