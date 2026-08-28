---
"@pretable/react": minor
"@pretable/ui": minor
---

Tool panel: a grouping section on the rail — the third pane.

`ToolPanelSectionId` widens to `"columns" | "filters" | "grouping"`, and the
rail grows a third tab. The pane holds four blocks, top to bottom:

- A **group-by list**: one row per grouping level, in level order — add a
  level from the `+ Add group` menu (any data column not already grouped),
  remove one with its ✕, reorder by dragging the grip or with
  `Shift+ArrowUp`/`Shift+ArrowDown` on it. The list is a pure projection of
  the query's `rowGroups` — the same model the drag-to-group strip writes, so
  the two surfaces never disagree.
- **Expand all / Collapse all**, disabled while nothing is grouped.
- A **Hide grouped columns** switch over the engine's `hideGroupedColumns`.
  A consumer who keeps driving the surface prop of the same name after mount
  retains ownership — the prop writes back and clobbers pane writes; one who
  leaves it alone after mount cedes the state to the pane.
- A per-column **aggregate picker** (rows mode only — in explicit-model mode
  the block is absent, since the caller owns their row model and an override
  would change nothing a group row shows). Options are `Default (…)` — no
  override, showing what the column's prop declares — `None`, and the
  type-valid builtins (number columns: Sum/Average/Min/Max/Count; every other
  type: Count). `None` writes the new `null` override, meaning "show no
  aggregate"; `Default (…)` clears the override entirely, so "no override"
  and "overridden to the same value" never look alike.

A grouped column also gains a quiet "grouped" marker in the filters section's
column picker, shown only while the column is not drawn (grouped with
hide-grouped on) — distinct from the "hidden" marker, which wins when both
apply.

Every string the section renders is a message: `toolPanelGroupingLabel` for
the tab, the group-by labels (`toolPanelGroupByLabel`,
`toolPanelAddRowGroupLabel`, `toolPanelRemoveGroupLabel`,
`toolPanelReorderGroupLabel`, `toolPanelNoGroupsMessage`), the expansion pair,
`toolPanelHideGroupedColumnsLabel`, the aggregate strings
(`toolPanelAggregatesLabel`, `toolPanelAggregateColumnLabel`, the
`Default`/`None`/`Custom` options, and the five builtin names), and
`toolPanelColumnGroupedMarker` for the filters-picker marker.

`@pretable/ui` ships the section's rules — the group-by rows and their grips,
the expansion button pair, the switch row, and the aggregates block.
