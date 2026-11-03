---
name: Wrangler D1 query limits
description: Remote D1 API behavior when inspecting many tables with one compound query.
---

Avoid large `UNION ALL` count queries against remote D1 through Wrangler. The remote API can reject them with `SQLITE_ERROR` code 7500 and “too many terms in compound SELECT.” Scalar subqueries or separate `SELECT` statements worked.

**Why:** A remote read-only audit hit this error before returning any results or writing data.

**How to apply:** When auditing many D1 tables, use scalar subqueries or separate statements rather than a long compound `SELECT`.
