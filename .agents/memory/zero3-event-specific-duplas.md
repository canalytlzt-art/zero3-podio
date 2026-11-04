---
name: ZERO3 event-specific duplas
description: Event registrations keep stable IDs while eligible athlete swaps preserve linked batteries and import lineage.
---

Only individual athlete records are permanent and reusable across events. A dupla is an event-specific registration linking athletes, one event, and one event-configured category. Do not create permanent/shared team records. Before results or a published podium exist, replacing an athlete may keep the same registration ID even when a heat or import references it; update member-slot rows and audit while preserving heat-entry IDs. Do not change category while the registration is assigned to a category-specific heat. Results and published podiums protect registration identity from ordinary edits. Custom team names are display labels, not registration identity; they may change while historical result and podium snapshots retain their prior references.

**Why:** the user explicitly clarified that a heat or import link alone must not block a pre-result athlete swap. Results and published podiums remain historical records tied to the existing registration.

**How to apply:** Keep the registration ID as the battery reference. For eligible athlete swaps, update the registration and slot-membership rows atomically, preserve heat entries/import lineage, and audit before/after identities. Category changes with heat entries need a separate battery reorganization.
