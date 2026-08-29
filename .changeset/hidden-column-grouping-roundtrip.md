---
"@pretable/react": patch
---

A hidden column stays hidden across a grouping round-trip.

Engine-owned per-column layout state — visibility from `setColumnVisible`, a
resize from `setColumnWidth`, a pin from `setColumnPinned` — used to be
silently discarded whenever the drawn roster changed (grouping removing a
grouped-away column, ungrouping restoring it, a synthetic column mounting):
the surface rebuilt the engine's column layout from prop-derived values. Now
the rebuild carries the live engine entry for columns still in the roster and
remembers the last engine entry for columns that leave it, so a column that
re-enters — hide-grouped switched off, or the grouping level removed — comes
back exactly as the user left it.
