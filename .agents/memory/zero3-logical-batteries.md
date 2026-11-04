---
name: ZERO3 logical batteries
description: The user-approved identity and TV behavior for a competition battery.
---

A logical battery is identified by the event, proof, and displayed battery number. Category-specific heat rows (such as RX and SC) are children of that group; the same number under another proof is a different battery. Only the selected logical battery occupies the TV's active battery area. Selecting it only changes the display; timer start/stop and battery finalization/publication are separate actions. Finalization requires a reviewed result or official exception for every expected registration, and the TV retains the last published snapshot until a corrected battery is finalized again. Repeated finalization of unchanged results must not create a duplicate publication.

Overall proof points rank only current results from finalized battery snapshots, across all published batteries within the same proof and category. A changed result makes its old snapshot stale and stays pending until the battery is reviewed and published again. Unresolved ties or exceptions do not earn zero points or make the event ranking final.

**Why:** The user selected grouping by proof and number so equal numbers across proofs cannot be mixed, while RX and Scale can appear together when present. They also require timer commands, TV selection, and finalization to remain independent, with corrections audited and republished only after confirmation. They defined event-wide proof points from finalized batteries and require missing results, ties, and unresolved exceptions to remain visibly incomplete.

**How to apply:** Keep event + proof + displayed number in active-selection, timer, and publication identities. Use category-specific rows only to assemble that group's panels. Do not infer battery finalization from timer state. Preserve prior publication snapshots and create a new version only after corrected results are reviewed and confirmed. Calculate proof ranks from current snapshots only; show unpublished or stale results as pending until the battery is confirmed again.
