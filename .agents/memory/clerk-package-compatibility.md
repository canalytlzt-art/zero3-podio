---
name: Clerk package compatibility
description: Clerk React/shared package mismatches that appear at Vite bundling rather than typechecking.
---

Keep Clerk React and `@clerk/shared` on compatible major versions. A workspace catalog can pin the shared package while an app's semver range resolves a newer React package; TypeScript may pass even though Rollup cannot find a runtime export.

**Why:** A Vite build failed during module linking despite successful installation and typechecking.

**How to apply:** When Clerk exports fail during bundling, inspect the resolved dependency tree and align Clerk package versions before broadening the workspace React version.
