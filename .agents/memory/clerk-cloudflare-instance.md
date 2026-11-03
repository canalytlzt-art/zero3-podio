---
name: Cloudflare Clerk instance
description: The intended Clerk instance mode for the published ZERO3 Cloudflare app.
---

Keep Cloudflare on the existing Clerk test instance. Do not switch to production, create another instance, or rotate keys unless the user directly changes this instruction.

**Why:** The user explicitly chose to keep the test instance after the published bundle was found to contain a test-mode publishable key.

**How to apply:** Keep the Cloudflare build publishable key and runtime Clerk keys from that same test instance. If the user requests production, confirm the existing production instance and its separate user store before changing configuration.
