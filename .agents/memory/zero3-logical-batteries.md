---
name: ZERO3 logical batteries
description: The user-approved identity and TV behavior for a competition battery.
---

A logical battery has a stable internal ID; event + displayed order is its unique, editable position, shown as P01, P02, and so on. Renaming or moving it must retain its ID, registrations, timer, results, publications, and TV selection. If a target position is occupied, require an explicit atomic swap. Deletion must not renumber other batteries and may remove only that battery's own operational data; preserve the event, registrations, global athletes, proofs, and other batteries, and clear TV selection if it pointed to the deleted battery. It contains event registrations and runs all four configured proofs in parallel; RX and SC may share a battery but remain separate in results and rankings. The shared event timer is independent of TV selection and battery finalization. Selecting a battery only changes what the TV displays. Operational finalization stops and freezes only that battery's timer, may proceed with missing results after warning, and never publishes results, rankings, points, or podiums. Only explicit event-level ranking publication makes results official. Repeating operational finalization must not create a publication.

Overall proof points rank current results across finalized batteries of the same event, proof, and category. A changed result remains pending until the battery is reviewed and finalized again. Unresolved ties or exceptions do not earn zero points or make the event ranking final. When migrating legacy category/proof-specific heat rows, never merge rows with different registration sets automatically; compare their registrations and preserve the source rows and results until the user approves an explicit mapping.

**Why:** The user superseded the earlier proof-scoped model with event-scoped batteries containing four parallel proofs, while retaining separate RX/SC classifications. They require a stable battery ID across editable display positions, atomic explicit swaps, no renumbering after deletion, timer commands and TV selection to remain independent, review before merging legacy rows with different teams, and live results to stay distinct from official standings until explicit event publication. Operationally finishing a battery is not official publication.

**How to apply:** Use the stable battery ID for all links and event + displayed order for uniqueness and Pnn display. Attach each event registration at most once. Keep all four proof results under that battery; calculate official proof placements only after explicit event-level ranking publication and keep RX/SC rankings isolated. Public views may show unreviewed or un-published results as provisional, but they must not change official points or podiums before publication. Operational finalization only freezes that battery's timer; never infer ranking publication from its timer or finalization state. Preserve timer and TV references across reordering; when positions conflict, swap in one transaction. Delete only the selected battery and its dependent operational rows, never renumber survivors. Before migrating legacy rows, compare registration sets; stop and request mapping approval when they differ. Preserve source IDs and results until that mapping is explicitly resolved.

When a result has no legacy heat or battery link, preserve it as pending and do not infer its battery from category or proof alone. Require an explicit mapping decision before including it in battery cells or rankings.

**Why:** The user chose to leave two validated RX results without battery links and pause the staging release rather than risk attributing them to the wrong battery.

**How to apply:** Migration diagnostics may report these rows, but must not create battery entries or change result links automatically. Pause publication until the mapping is explicitly resolved.

Each battery has its own configurable runtime CAP (default 2 hours), excluding the preparation countdown. Reaching it freezes only that timer at the exact cap and does not operationally finalize the battery or publish results. The event duration is a separate wall-clock indicator from the earliest battery first-start time; never sum concurrent battery timers or use event duration to block another battery's start. Before the first start, ADMIN/JUIZ_CHEFE may change the CAP; after a start, only ADMIN may change it while paused, with an audit record. Stop, finalization, and ranking publication remain distinct actions.

**Why:** The user explicitly requested per-battery time limits while preserving independent timer state, a non-blocking chronological event-duration indicator, and the separation between timer stop, operational finalization, and official publication.

**How to apply:** Store the limit by stable battery ID in D1. Enforce role, timer state, expected version, and audit requirements on the server; derive the event indicator from the first-start timestamp and keep every other running battery unchanged.

An ADMIN may correct a finished battery's recorded duration without changing its CAP, finished state, timer start/stop history, results, ranking, or publication. Preserve each changed old/new value in a dedicated duration-audit record; do not reuse the CAP audit table.

**Why:** The user requested reviewable duration corrections, including legitimate times above CAP, while keeping CAP and official score records independent.

**How to apply:** Require a finished run and concurrency checks, update only its elapsed value/version, and atomically append the duration audit record. Include that audit in event backup/restore.

Scheduled start is also attached to the stable battery ID and event, but remains separate from the actual timer start and elapsed time. It is displayed in Brasília time, stays visible after launch, and may be edited without starting, pausing, resetting, or changing the timer. An unset schedule stays unset rather than being inferred from battery order.

**Why:** The user explicitly distinguished expected start time from recorded timer start and prohibited inventing intervals or coupling schedule edits to timer commands.

**How to apply:** Persist an optional scheduled instant on the event battery. Convert operator-entered local time using `America/Sao_Paulo`; keep timer state and CAP fields independent and only suggest an order for new batteries without renumbering existing ones.

The Worker D1 path stores independent runs by stable battery ID. The Replit/Node PostgreSQL path still has one event-level timer and cannot safely honor battery/proof-scoped timer commands; do not treat Preview testing as proof of independent battery timers.

**Why:** The older route can otherwise accept a command targeted at one battery while mutating the shared event timer.

**How to apply:** Use the Worker D1 path to validate per-battery operation. Until PostgreSQL is migrated, reject scoped commands there with an explicit conflict rather than returning a false success.
