---
name: ZERO3 fullscreen browser testing
description: Distinguishes native Fullscreen API behavior from the expanded-page fallback when validating ZERO3 TV screens.
---

Use the browser's `fullscreenchange` event to synchronize UI state for native exits, including browser controls and Escape. Headless Chromium driven through synthetic CDP keyboard events may remain in native fullscreen after Escape, even when button-driven entry and exit work. Test the same-button exit, native state synchronization, and fallback Escape separately; mark real-device native Escape as unverified if the harness cannot trigger it.

**Why:** A headless validation attempt on 2026-11-06 entered native fullscreen and toggled off through the app button, but synthetic Escape did not leave native fullscreen; it is not reliable evidence of actual browser Escape behavior.

**How to apply:** For fullscreen changes on `/tv`, keep the `fullscreenchange` listener and validate native fullscreen controls in a real browser when possible. Do not conflate native Escape testing with the page-level fallback Escape handler.
