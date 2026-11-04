---
name: ZERO3 logical batteries
description: The user-approved identity and TV behavior for a competition battery.
---

A logical battery is identified by event and displayed order, unique within that event. It contains the event registrations and runs all four configured proofs in parallel; RX and SC may share a battery but remain separate in results and rankings. The shared event timer is independent of TV selection and battery finalization. Selecting a battery only changes what the TV displays. Finalization requires a reviewed result or configured official exception for every expected registration and proof, publishes the complete battery snapshot, and updates ranking. Repeating finalization without changes must not create a duplicate publication.

Overall proof points rank current results across finalized batteries of the same event, proof, and category. A changed result remains pending until the battery is reviewed and finalized again. Unresolved ties or exceptions do not earn zero points or make the event ranking final. When migrating legacy category/proof-specific heat rows, never merge rows with different registration sets automatically; compare their registrations and preserve the source rows and results until the user approves an explicit mapping.

**Why:** The user superseded the earlier proof-scoped model with event-scoped batteries containing four parallel proofs, while retaining separate RX/SC classifications. They require timer commands, TV selection, and finalization to remain independent, explicitly require review before merging legacy rows with different teams, and want live results distinguishable from official standings until publication.

**How to apply:** Use event + displayed order as the battery identity and attach each event registration at most once. Keep all four proof results under that battery; calculate official proof placements only from finalized snapshots and keep RX/SC rankings isolated. Public views may show open-battery results as provisional, but they must not change official points or podiums before publication. Do not infer finalization from timer state. Before migrating legacy rows, compare registration sets; stop and request mapping approval when they differ. Preserve source IDs and results until that mapping is explicitly resolved.

When a result has no legacy heat or battery link, preserve it as pending and do not infer its battery from category or proof alone. Require an explicit mapping decision before including it in battery cells or rankings.

**Why:** The user chose to leave two validated RX results without battery links and pause the staging release rather than risk attributing them to the wrong battery.

**How to apply:** Migration diagnostics may report these rows, but must not create battery entries or change result links automatically. Pause publication until the mapping is explicitly resolved.
