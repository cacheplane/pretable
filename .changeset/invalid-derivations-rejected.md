---
"@pretable/react": patch
---

An invalid `aggregate` arriving after mount is a rejected write, not a destroyed
grid.

The compiler's validation error was thrown synchronously out of the derivations
layout effect, so it escaped the commit and React unmounted the grid subtree —
measured as group rows 1 → 0 and a container of 0 bytes. Both doors into the
derivations seam were fatal: a bad `aggregate` written through
`setColumnAggregate`, and — the one every consumer can reach, with no pane, no
grouping state and no knowledge of this feature — a bad `aggregate` on the
`columns` prop on update.

The update is now rejected whole: the row model keeps the derivations it already
had, the grid stays interactive and keeps painting the values it was showing, and
a later valid update still lands. The rejection is reported through `warnOnce`,
keyed on the column, the fault location and the detail, so a second, different
misconfiguration still warns instead of being swallowed by the first one's latch.

Mount still throws, deliberately: there is no running grid to protect and a hard
error surfaces a config bug at its cheapest moment.
