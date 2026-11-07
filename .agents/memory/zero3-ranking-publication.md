---
name: ZERO3 ranking publication
description: Product rules for separating reviewed result edits from the official event ranking.
---

The event leaderboard and public TV must use a versioned official snapshot. A result capture is partial; administrative review makes it eligible, but only an explicit event-level publication makes that revision official. A correction remains pending while the prior published value stays active. Republishing replaces the old contribution instead of counting it twice. RX and SC remain separate. Equal valid marks in a proof share the same place and points. The overall ranking sums the four proof-placement point totals, with the lower sum ahead.

When final overall point sums are equal, only the actual distance recorded by the fourth proof named `Condition` can break the tie: the higher distance ranks ahead, but does not change proof points or beat a lower point sum. Treat the stored raw mark as distance only when the proof is `Condition` and its unit explicitly denotes distance; this event uses `Distancia Total` even though the legacy metric type says repetitions. A missing, provisional, or non-distance value never breaks the tie. Exact point-sum and distance ties remain shared and do not block publication. Manual arbitration is optional only for that persistent final tie and is scoped to the event, category, exact sum/distance, and tied registration set. Earlier published snapshots remain unchanged until an explicit correction and republication.

The public podium defaults to the published category ranking, while a saved manual podium for that event/category overrides presentation only; ranking recalculation must not clear it or change marks and points.

For the current staging D1 schema, manual podiums persist through `registration_ids`, version, and publication fields; `arbitration_note` is absent. The user explicitly chose to avoid migrations for the medal-only flow. Keep note entry disabled and do not select or write the missing column in the podium save/read/publication paths.

**Why:** The organizer confirmed that this event's `Condition` raw mark represents total distance, not repetition count. Distance is a final-tie rule only, while proof ties still share points; treating the legacy metric label or an absent value as distance would silently change the ranking.

**How to apply:** Keep result editing, battery publication, event-wide ranking publication, and manual podium publication distinct. Use the shared server scorer for publication previews, category rankings, leaderboards, and default podiums. Preserve raw decimal precision; enable manual tie controls only for an exact final overall tie after the Condition rule. Recompute placements from published results on explicit ranking publication. For public output, use the category ranking as the default podium and prefer an existing published manual selection for that category; never feed podium choices back into scoring.

**Why:** The organizer requested medal-only manual podiums on the existing D1 schema and declined the pending migrations; depending on an absent column would keep both saving and public display broken.

**How to apply:** Before touching podium persistence in this staging project, inspect the active schema. Use compare-and-swap on the existing versioned rows, keep explicit publication separate, and do not run the deferred migrations unless the user later approves them.
