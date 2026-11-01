---
name: ZERO3 Development demo seed
description: Node ESM and package-resolution constraints for synthetic ZERO3 Development seed scripts.
---

When a seed script imports the TypeScript source of `@workspace/db`, running it directly with Node's type stripping is unreliable: workspace source uses directory imports that Node ESM does not resolve. Bundle it with esbuild, externalize `pg` and `drizzle-orm`, and place the transient output under the `lib/db` package so those dependencies resolve from that package's `node_modules`. Always remove the generated file and reject execution outside Development.

**Why:** Direct execution failed first on dependency resolution and then on an unsupported directory import; output under the API package also could not resolve database-only dependencies.

**How to apply:** Keep demo seeds isolated, idempotent, and explicitly Development-only; preserve the output location and cleanup behavior if changing the seed command.
