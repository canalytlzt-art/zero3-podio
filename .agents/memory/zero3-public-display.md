---
name: ZERO3 public display
description: Product requirements for the ZERO3 PRO public competition TV.
---

The public display is one landscape TV page with a live `America/Sao_Paulo` civil clock, a separate sports duration, and simultaneous SC and RX panels. The existing SC category must not be renamed to SCALE unless that mapping is confirmed.

Each event has four proof slots. Once official metric direction and units are configured, the server ranks validated results independently by proof and category across all heats. Place 1 earns 1 point, place 2 earns 2, and so on; lower totals lead. Corrections recalculate from current results, missing proofs are not zero, and incomplete teams cannot be final champions. Provisional results do not earn official points. If a tie rule is undefined, withhold the affected points or final placement rather than inventing a tiebreaker.

Final podiums remain manually selected and published, and appear inside the same category panels. Keep the test event and its synthetic participants/proofs clearly marked as demonstration data; never mix them with official registrations.

**Why:** The user replaced the earlier split-screen plan with one TV, and the latest scoring scope supersedes the earlier instruction not to calculate points. Official proof names, metrics, tie rules, and the SC-to-SCALE mapping must come from the user or existing records, not be inferred.

**How to apply:** Keep operation and result editing authenticated and separate from the read-only TV. Preserve registration IDs and earlier results when heats change; use `America/Sao_Paulo` for the civil clock; never auto-publish podiums or score provisional results.

The primary entry flow is administrative: `/` and `/inicio` lead to `/admin`; `/tv` is the sole public, read-only TV route. Keep extra modules disabled and preserve the simplified event-operation flow.

**Why:** the user explicitly asked to keep those ZERO3 Games scope decisions intact while changing entry routing.

**How to apply:** When adjusting navigation or operation pages, do not restore a public landing route that prioritizes TV or activate disabled modules.
