---
"@pretable/react": patch
---

Accept `groupColumn`, `hideGroupedColumns`, `aggregateFilteredRows` and
`groupsDefaultExpanded` on `usePretable` and `<PretableSurface>`, and re-export
`PretableGroupColumnOptions`. `groupColumn={{ pinned: "left" }}` is now
reachable from React, which is the only way to seat the tree column ahead of
left-pinned data columns.
