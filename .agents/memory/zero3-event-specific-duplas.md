---
name: ZERO3 event-specific duplas
description: The ZERO3 data model keeps athletes global while pairings and categories are event-specific.
---

Only individual athlete records are permanent and reusable across events. A dupla is an event-specific registration linking two athletes, one event, and one category. Do not create permanent/shared team records. Editing or deleting a registration must not affect athlete records or registrations in other events.

**Why:** the user clarified athletes may pair with different partners and compete in different categories at future events.

**How to apply:** Keep stable athlete IDs; treat category and athlete membership as registration-scoped, and preserve history when editing or cancelling a registration.
