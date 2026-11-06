---
name: ZERO3 public dialog browser testing
description: Browser automation details for testing public TV and leaderboard dialogs.
---

For local Chromium automation against the Replit Preview, bypass environment proxies for loopback URLs. Radix tabs and focus behavior should be exercised with browser pointer and keyboard input events, not only `element.click()`.

**Why:** A proxied browser connection and synthetic DOM clicks produced misleading empty-page and inactive-tab results even when the rendered Preview and real pointer interactions worked.

**How to apply:** Start Chromium with direct loopback networking, wait for the app to finish mounting, use pointer events for Radix tabs, and check the resulting active tab, focus restoration, and URL. Treat build output or a separate stale static bundle as distinct from the current Preview.
