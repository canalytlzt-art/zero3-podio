---
name: Cloudflare PostgreSQL boundary
description: External-connectivity limits between Replit-managed PostgreSQL and Cloudflare Hyperdrive.
---

Replit-managed PostgreSQL is for application access inside Replit and does not expose public TCP connectivity or a configurable public firewall. Cloudflare Hyperdrive cannot connect directly to this database.

**Why:** Replit documentation confirmed the managed database has no public IP/firewall configuration. ZERO3 PRO must keep its existing PostgreSQL data and schema unless the user explicitly approves a different strategy.

**How to apply:** Do not bind Hyperdrive to the Replit-managed database, use a tunnel/personal proxy, migrate data, or substitute another database without explicit approval. Keep Cloudflare database-backed runtime work marked pending until a supported path to the same data is approved.
