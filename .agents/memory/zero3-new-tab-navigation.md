---
name: ZERO3 new-tab navigation
description: A browser click on a Wouter Link with target=_blank can be canceled instead of opening a new tab.
---

For links that should open the live board in a new tab, render a native anchor with `target="_blank"` and `rel="noopener noreferrer"` rather than Wouter's `Link`.

**Why:** A real Preview click on the TV's Wouter link showed `defaultPrevented: true` and opened no tab. Replacing it with a native anchor opened a separate tab and kept the event ID in the URL.

**How to apply:** When adding or changing public TV links that open another tab, verify the click in a browser; helper tests for URL construction alone do not catch router click interception.
