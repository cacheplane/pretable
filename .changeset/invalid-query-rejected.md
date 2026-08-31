---
"@pretable/react": patch
---

An invalid `query` arriving on the prop after mount is a rejected write, not a
destroyed grid.

The compiler's validation error was thrown synchronously out of the same layout
effect that already guards derivations, so it escaped the commit and React
unmounted the grid subtree — measured as rows 3 → 0 and a container of 0 bytes.
Two faults reach it, both from an ordinary `query` prop: a filter whose operator
requires an operand and has none, and a `rowGroups` entry naming a column the
model does not have.

The update is now rejected whole: the row model keeps the query it already had,
the grid stays interactive and keeps painting the rows that query selected, and a
later valid query still lands. The rejection is reported through `warnOnce`, keyed
on the column, the fault location and the detail, so a second, different fault
still warns instead of being swallowed by the first one's latch.

Two throws are deliberate and unchanged. Mount still throws: there is no running
grid to protect, and a hard error surfaces a config bug at its cheapest moment.
An uncontrolled `grid.setQuery` still throws synchronously to its caller, who
asked for the write, can catch it, and whose grid survives either way.
