---
name: ZERO3 ranking publication
description: Product rules for separating reviewed result edits from the official event ranking.
---

The event leaderboard and public TV must use a versioned official snapshot. A result capture is partial; administrative review makes it eligible, but only an explicit event-level publication makes that revision official. A correction remains pending while the prior published value stays active. Republishing replaces the old contribution instead of counting it twice. RX and SC remain separate. Exact unresolved ties share competition places and points; they do not block publication. An administrator may optionally order a tie manually, but never derive an order from lane, name, ID, entry order, or another proof.

Manual tie decisions are scoped to the event, category, proof/overall scope, exact mark, and tied registration set. They belong in the versioned ranking snapshot and apply only while that exact tie remains valid. The public podium defaults to the published category ranking, while a saved manual podium for that event/category overrides presentation only; ranking recalculation must not clear it or change marks and points.

**Why:** The ranking snapshot versions official scores and tie decisions. Manual podium versions are a separate, existing event/category-scoped presentation choice, so they can coexist without altering scoring or requiring a schema migration.

**How to apply:** Keep result editing, battery publication, event-wide ranking publication, and manual podium publication distinct. Recompute all event placements from the current published result set on explicit ranking publication. For public output, use the category ranking as the default podium and prefer an existing published manual selection for that category; never feed podium choices back into scoring.
