---
"@pretable/react": minor
"@pretable/ui": minor
---

Tool panel: a filters section on the rail, building the query's AND/OR tree.

`ToolPanelSectionId` widens to `"columns" | "filters"`, and the rail grows a
second tab. The pane it opens is a filter builder over `query.filters` as the
engine holds it — leaves, groups, and nesting — rather than the per-column view
the header funnel offers:

- A row per leaf: column, operator, and a value control typed off the column
  (`text`, `number`, `date`, a checklist for enums and booleans). The operator
  vocabulary is the funnel menu's, so the same filter reads identically in both
  places, and a column's `filterOperators` prunes both lists.
- `+ filter` and `+ group` at every level; the join between siblings is one
  control per run, because a sibling list has exactly one connective.
- Commits are live — discrete changes at once, a value the user is still typing
  after a short dwell — so there is no Apply button. A row whose operator has no
  operand yet holds its place as an empty group, which constrains nothing: an
  unfinished row never moves the grid.
- Enum columns that declare no `options` load their choices through the
  surface's distinct-value path, and inherit its incomplete-universe warning
  under external filtering.
- The section subscribes to the row model itself, so a filter committed
  elsewhere — a header funnel, a controlled `query` — is reflected in the panel
  as it lands.

Every string the section renders is a message, resolved off the `messages`
prop like the rest of the grid: `toolPanelFiltersLabel` for the tab,
`toolPanelAddFilterLabel`/`toolPanelAddGroupLabel` for the add pair,
`toolPanelFilterWhereLabel`/`toolPanelFilterJoinLabel` and the join's action
sentence, the control labels, the remove button, and the nesting refusal.

`@pretable/ui` ships the section's rules — the row grid, the run rail and its
join control, the nested-group indent, and the refusal styling for a disabled
add action.
