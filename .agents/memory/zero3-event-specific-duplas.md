---
name: ZERO3 event-specific duplas
description: The ZERO3 data model keeps athletes global while pairings and categories are event-specific.
---

Only individual athlete records are permanent and reusable across events. A dupla is an event-specific registration linking two athletes, one event, and one event-configured category. Start with RX and SC, but support custom category names. Do not create permanent/shared team records. Do not change athlete membership or category once results, heat entries, imports, or podiums reference the registration. A custom team name is a display label, not registration identity: it may be changed while keeping IDs, results, podium references, and historical snapshots intact; current displays resolve the label by registration ID. Delete only unlinked registrations and offer cancellation when identity history exists.

**Why:** the user clarified athletes may pair with different partners and compete in different categories at future events, and that display names can change without reassigning existing results or published podium placements.

**How to apply:** Keep stable athlete and registration IDs; treat category and athlete membership as registration-scoped; resolve current custom names by registration ID for TV, results, heats, leaderboard, and podiums, while keeping snapshots as historical records. Preserve identity history when editing or cancelling a registration.
