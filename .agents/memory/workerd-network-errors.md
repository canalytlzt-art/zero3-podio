---
name: Workerd network error evidence
description: Workerd PostgreSQL connection failures may lack Node-style error codes.
---

Workerd can report a failed PostgreSQL TCP connection only as `connection attempt failed`, without an error code.

**Why:** an intentionally unreachable local PostgreSQL endpoint reproduced this in actual Wrangler HTTP calls, not merely a dry-run.

**How to apply:** require the surrounding SQL error context when classifying this case; do not generalize arbitrary error text or elapsed time to a database outage. This local reproduction does not establish the cause of historical Cloudflare incidents.
