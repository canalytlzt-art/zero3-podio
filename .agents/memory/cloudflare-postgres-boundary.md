---
name: Cloudflare PostgreSQL boundary
description: External-connectivity limits between Replit-managed PostgreSQL and Cloudflare Hyperdrive.
---

Replit-managed PostgreSQL is for application access inside Replit and does not expose public TCP connectivity or a configurable public firewall. Cloudflare Hyperdrive must not connect directly to it. The Cloudflare test Worker uses a separate Neon test database; Replit's database and records remain unchanged. The Neon test database also contains Neon Auth relations and must not be treated as wholly empty.

**Why:** Replit documentation confirmed the managed database has no public IP/firewall configuration. A separate Neon test database allows Cloudflare testing without moving or changing Replit data. Its existing `neon_auth.project_config` row was preserved when the ZERO3 schema was added.

**How to apply:** Keep Replit's API on its current `DATABASE_URL`; use Hyperdrive only for the separate Neon test database. Inspect before schema changes and preserve `neon_auth` relations. Do not copy or migrate Replit records, bind Hyperdrive to the Replit-managed database, or use a tunnel/personal proxy.
