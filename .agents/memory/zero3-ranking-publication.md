---
name: ZERO3 ranking publication
description: Product rules for separating reviewed result edits from the official event ranking.
---

The event leaderboard and public TV must use a versioned official snapshot. A result capture is partial; administrative review makes it eligible, but only an explicit event-level publication makes that revision official. A correction remains pending while the prior published value stays active. Republishing replaces the old contribution instead of counting it twice. RX and SC remain separate. Exact unresolved ties share competition places and points; they do not block publication. An administrator may optionally order a tie manually, but never derive an order from lane, name, ID, entry order, or another proof.

Manual tie decisions are scoped to the event, category, proof/overall scope, exact mark, and tied registration set. They belong in the versioned ranking snapshot and apply only while that exact tie remains valid. Once an event ranking has been published, derive the public event podium from that same leaderboard; keep the existing manually published podium as the display fallback before the first event-ranking publication.

**Why:** The publication snapshot already versions the official leaderboard. Storing tie decisions there preserves the audit/republication model without a schema migration or a separate mutable source of official ranking state. Deriving the event podium from the published leaderboard prevents two public views from disagreeing after a republish.

**How to apply:** Keep result editing, battery publication, and event-wide ranking publication as distinct operations. Preserve the previous published snapshot on edits, require an authorized administrator for publication, and make the ranking/TV consume only published values. Recompute all event placements from the current published result set on every explicit publication; after the first such publication, derive the public event podium from the same ranking.
