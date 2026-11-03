---
name: Drizzle composite foreign keys
description: Ensure fresh Drizzle PostgreSQL pushes create the referenced composite key before a child foreign key.
---

When a Drizzle child table references multiple parent columns, declare the matching parent key with a table-level `unique()` constraint, not only `uniqueIndex()`. Preserve existing unique indexes by attaching them to the named constraint in an additive migration when needed.

**Why:** A fresh `drizzle-kit push` attempted to create the child foreign key before creating the parent unique index, and PostgreSQL rejected the reference. A table-level unique constraint is emitted with the parent table and makes the fresh push succeed.

**How to apply:** Check both a fresh empty PostgreSQL database and the existing Development/Neon test schemas after changing composite references. Keep the migration idempotent and convert an existing unique index with `UNIQUE USING INDEX` rather than dropping/rebuilding it.
