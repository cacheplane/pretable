# Row grouping correctness follow-up

Date: 2026-08-08
Status: ready for user review
Predecessors: `2026-08-07-row-grouping-engine-design.md` (SP1, #237),
`2026-08-07-row-grouping-render-design.md` (SP2, #254), and
`2026-08-07-row-grouping-panel-design.md` (SP3, #258)

## Problem

SP1 through SP3 shipped the grouping engine, rendered tree rows, and the
drag-to-group panel. The completed surface still has correctness gaps at the
boundaries between those sub-projects:

- selection and focus sometimes use source rows/columns while rendering uses
  the derived grouped model;
- row-model changes can leave group focus dangling or unnecessarily clear it;
- column-definition changes can leave grouping keys and aggregates stale;
- copy still drops group rows under a stale SP2 TODO;
- the treegrid reports the source row count rather than the visible flat row
  count and does not expose leaf depth;
- header keyboard events are mistaken for cell-navigation events;
- menu and chip mutations can unmount the focused node without a successor;
- expansion has no deterministic live announcement;
- the synthetic group column advertises resize and reorder operations the
  engine cannot perform; and
- the public changes have no Changesets release record.

These are not separate features. They are violations of one shared invariant:
once grouping is active, every user-facing operation must address the same
derived rows and columns that the user can see and reach.

## Scope

In:

- derived-model selection bounds and non-selectable group rows;
- focus reconciliation after grouping, row replacement, transactions, and
  filtering/grouping-semantic column changes;
- grouping-semantic column invalidation and removed-column sanitization;
- rectangular TSV/HTML serialization of group labels and aggregates;
- treegrid row counts, leaf levels, header-keyboard scoping, focus restoration,
  expansion announcements, and live-region structure;
- disabling impossible synthetic-column resize/reorder affordances;
- focused unit/browser regressions and a patch changeset.

Out:

- SP4 documentation, hero/product adoption, and grouping benchmarks;
- plumbing every engine grouping option through `PretableSurface`;
- performance work based only on suspected rerenders;
- sticky rows, totals/footers, pivot/tree data, and RTL;
- changing the panel's overflow layout in this follow-up.

The overflow exclusion is deliberate. The SP3 spec says chips wrap, but it also
locks the component to a fixed panel height subtracted from `viewportHeight`.
Correct wrapping needs a separate choice between measured multi-line height and
accessible horizontal scrolling, plus two-dimensional drop hit-testing if wrap
wins. Quietly adding `flex-wrap` here would clip rows or corrupt insertion.

## Alternatives considered

### Selected: one correctness follow-up, with overflow and SP4 split out

Repair every confirmed derived-model, clipboard, focus, and accessibility
contract together. They share fixtures and invariants, and fixing only one can
leave another path producing invalid state. Keep the panel overflow redesign
and SP4 deliverables separate because each requires a different design and
acceptance criteria.

### Rejected: fix only the original handoff's three items

This would repair copy, `aria-rowcount`, and announcements while leaving
grouped select-all bounded by hidden columns, stale aggregates, dangling focus,
and an inaccessible keyboard grouping path. The audit showed those failures are
already reproducible on shipped code.

### Rejected: fold overflow and all SP4 work into the same branch

That would mix correctness repair with a panel-layout redesign, documentation,
product examples, option plumbing, and benchmark semantics. It would be harder
to review, and the unresolved fixed-height/wrapping contradiction would force a
new product decision in the middle of implementation.

## Design

### 1. The derived visible model is canonical

When grouped, `grid.getColumns()` and `snapshot.visibleRows` are the address
space for focus, visible full-row selection, copy, and ARIA. `options.columns`
and source rows remain the consumer's configuration and data, but must not be
used to construct user-visible bounds.

`selectAll`, `toggleRowSelection`, and `setSelectAllVisible` will derive their
first and last column ids from `getColumns()`. The existing synthetic
row-selection column keeps its special copy meaning; when it is present and
pinned it can still be the full-row start bound. Grouping therefore produces
ranges whose endpoints both exist in the drawn column order.

Group rows remain focusable but not selectable or editable, as the SP2 design
states. Moving focus onto a group row without Shift preserves the current
selection instead of replacing it with a group-only range. Shift movement only
changes the active range when the destination is a data row; a later data-row
destination may still span intervening group rows positionally. Clicking a
group cell moves focus only. The twisty continues to stop propagation and
toggle expansion.

`clearSelection` while a group row has focus produces an empty selection rather
than collapsing to that non-selectable cell. `toggleRowSelection` ignores an id
that currently resolves to a visible group row. Unknown ids and direct public
`setSelection` input keep their existing permissive behavior; built-in
interaction is the boundary that guarantees it never creates a group-only
range.

The derived group column will set `resizable: false` and `reorderable: false`.
The React surface will consequently render neither an inert resize handle nor
an inert reorder drag for it.

### 2. Focus is reconciled after row-model changes

The engine will centralize focus reconciliation instead of giving collapse,
`setRows`, transactions, and `setRowGroups` unrelated partial rules.

For a previously non-null focus address after a mutation:

1. Preserve the row id when it still exists in the new `visibleRows`.
2. Otherwise preserve the nearest surviving ancestor for collapse, where the
   pre-mutation flat list contains that relationship.
3. For regrouping, changed grouping keys, or other model replacement, keep the
   previous flat-list position clamped into the new list. If no rows remain,
   clear focus.
4. Preserve the column id when it remains in `getColumns()`.
5. Otherwise use the derived group column while grouped, or the first effective
   column while ungrouped. If no columns remain, clear focus.

This keeps an existing keyboard focus valid without inventing focus for a grid
that had none. Selection is not rewritten merely because focus was repaired.
Editing keeps its existing data-row validity rules.

`setRows` must validate group ids against the newly derived visible model, not
only against source data ids. An identical row replacement therefore preserves
a focused group. Transactions, grouping-level changes, and every filter mutator
(`setColumnFilter`, `replaceFilters`, and `clearFilters`) run the same
reconciliation, so a removed, filtered-out, or path-invalid row id cannot
remain in the snapshot. Sort changes need no row repair because they reorder
the same visible ids; column repair still runs wherever a mutation can change
the effective column list.

### 3. Grouping-semantic column changes invalidate grouping

`mergeColumnsFromProps` stores fresh column definitions today but can retain a
cached grouped row model. It will distinguish layout equality from
grouping-semantic equality.

Changes to a column's id/set, `value` accessor, or `aggregate` definition
invalidate derived grouped rows. Removed columns re-sanitize `rowGroups`; if
that list changes, path-derived expansion overrides are cleared exactly as in
`setRowGroups`. A changed aggregate or accessor is visible in the next emitted
snapshot without waiting for an unrelated row mutation.

Function and custom-aggregator identity is the only available change signal.
An inline closure recreated by a parent may therefore cause one additional
grid emission for that parent update. It must not loop: once the merged
definitions are stored, the child rerender receives the same prop references
until the parent changes them again.

`rowGroup: true` remains an initialization default, not an implicit controlled
grouping prop. Runtime grouping continues to be changed through `setRowGroups`
or controlled `state.rowGroups`.

### 4. Clipboard output mirrors the rendered rectangular tree

`serializeRanges` will emit every visible row in a selected band:

- a data row uses the existing per-column value/format path;
- a group row puts `groupLabel(group.value)` in `GROUP_COLUMN_ID`;
- a group row puts each owned aggregate under its aggregate column;
- every other group cell is empty.

The child count, twisty, and indentation are presentation affordances and are
not copied. Blank group keys use the same `(Blanks)` label shown on screen.
Depth is not encoded into cell text.

Aggregate display moves to one shared string helper used by `GroupRow` and the
serializer. It invokes `formatAggregate({ value, column, group })` when
present, otherwise `formatCellValue`. Ordinary `column.format` is never called
for a group row because its non-optional `row` argument cannot be satisfied.

TSV quoting, HTML escaping, HTML type hints, headers, and multi-range block
separation remain unchanged. A valid range emits a rectangular body; a range
that resolves to no body rows is omitted, and the serializer returns `null`
when no block remains.

Copy announcements count the visible rows the built-in serializer addresses,
including group headers, rather than reusing the selectable-data-row count.
Select-all announcements remain about selectable data rows. Both calculations
exclude the synthetic row-selection control column and use visible drawn column
bounds. This keeps “rows copied” aligned with the rectangular tree emitted to
the clipboard without redefining what “rows selected” means.

### 5. Treegrid metadata describes the visible tree

`aria-rowcount` becomes `snapshot.visibleRows.length + 1`, including the header.
This is correct for filtering, expanded grouping, and collapsed grouping, and
keeps every rendered `aria-rowindex` within the declared total.

While grouped, data rows receive `aria-level={row.depth + 1}`. Group rows keep
their existing `depth + 1`, so a two-level tree announces branch levels 1 and 2
and leaves at level 3. Ungrouped data rows omit `aria-level`.

The live status region will leave the `grid`/`treegrid` subtree without adding
a wrapper to the no-panel surface path. A hydration-gated portal to
`document.body` preserves the root DOM contract and keeps non-row content out
of the ARIA grid. Each mounted surface retains its own status node.

### 6. Keyboard ownership and deterministic DOM focus

The surface key handler will ignore events originating in the header row after
its existing active-drag Escape handling. Native buttons and header overlay
controls then own Enter, Space, and Tab; grid navigation remains scoped to
gridcells and the viewport itself. This makes the column menu reachable by
keyboard without changing cell `tabBehavior`.

Focus after a grouping UI mutation follows the user's action:

- choosing **Group by this column** focuses the newly created grouping chip;
- reordering a chip keeps focus on that chip;
- removing a chip focuses the chip that moves into its slot, or the preceding
  chip;
- removing the final chip focuses the reappearing column-menu button for that
  column;
- Escape from an open menu still returns to its connected anchor.

Focus requests are internal React coordination, not new public props. They are
resolved in layout effects after the projected chips/headers exist. A missing
target falls back to the valid reconciled grid cell. If engine focus was null
because grouping began entirely from header controls, or the grid has no valid
cell, focus goes to the surviving scroll viewport (`tabIndex={-1}`). This is the
only fallback that neither strands focus on `<body>` nor invents an engine
focus/selection address the user never entered.

### 7. Expansion announcements use the existing localized message API

`PretableSurfaceMessages` gains two optional factories:

```ts
groupExpandedAnnouncement?: (args: {
  label: string;
  childCount: number;
}) => string;
groupCollapsedAnnouncement?: (args: {
  label: string;
  childCount: number;
}) => string;
```

The defaults are `"<label> expanded, <n> rows"` and
`"<label> collapsed, <n> rows"`. Separate factories avoid forcing localizers
to branch on a boolean when the two sentences may differ structurally.

Every successful pointer, double-click, Enter/Space, and Left/Right expansion
mutation uses one shared post-mutation announcer. It re-reads the snapshot to
determine the resulting expanded state and uses the rendered group label and
post-filter `childCount`. No-op operations do not announce. The existing polite
debounce and last-message-wins behavior remain unchanged.

## Public API and release

The only new public surface is the two optional message factories. Existing
defaults preserve consumers that do not provide `messages`.

The implementation will update API Extractor baselines as required and add a
patch changeset covering the packages whose public or runtime behavior changes.
The already-known `PretableGroupColumnOptions` forgotten-export seam stays with
SP4 unless API extraction proves this follow-up newly exposes it.

## Error handling and compatibility

- No new asynchronous mutation or recovery protocol is introduced.
- A custom copy formatter or announcement factory keeps the existing behavior:
  exceptions are consumer exceptions and are not silently replaced.
- Group expansion is announced only after the engine confirms a state change.
- Ungrouped grids retain their derived-column identity and omit tree-only ARIA.
- The no-panel surface keeps its current root element; the live region moves by
  portal rather than by adding a wrapper.
- Raw public `setSelection` can still accept arbitrary ids. Built-in user
  interaction is what enforces the non-selectable-group contract.

## Testing

### Engine unit tests

- grouped `selectAll`, row toggle, and visible select-all use effective bounds;
- arrow and Shift movement focus group rows without selecting them;
- group-focused `clearSelection` is empty and row-toggle rejects visible group
  ids;
- `setRowGroups` repairs invalid row and column focus;
- identical `setRows` preserves group focus, while removed/renamed groups are
  reconciled;
- transactions cannot leave a deleted group id focused;
- filter mutation cannot leave a filtered-out row id focused;
- accessor/aggregate changes invalidate groups, and grouped-column removal
  sanitizes state;
- the group column disables resize and reorder.

### React/jsdom tests

- mixed and group-only ranges produce rectangular TSV and HTML with labels,
  formatted aggregates, blanks, escaping, and headers;
- group clicks focus without selection callbacks;
- filtered, expanded, and collapsed row counts match visible rows;
- nested data leaves expose the correct level;
- header controls retain native keyboard ownership;
- menu grouping, chip reorder/removal, and final-chip removal restore focus;
- pointer and every keyboard expansion path announce defaults and overrides;
- copy announcements include serialized group rows while select-all remains
  data-row based;
- the live region is outside the treegrid.

### Real-browser tests

- a keyboard user tabs through the header, opens a column menu with Enter, and
  groups a column;
- focus lands on the new chip and returns to the menu affordance after the last
  chip is removed;
- grouped Cmd/Ctrl+A and row-selection copy include every visible column and
  rectangular group rows;
- Chromium and WebKit both exercise the focus and clipboard paths where their
  DOM/layout behavior matters.

Each regression starts with a failing test, and behavior-sensitive tests get a
negative control before implementation is accepted. Final verification runs
the focused suites, full workspace tests, typecheck, lint, API extraction,
format checks, browser tests, and Changesets status.

## Follow-ups kept separate

1. **Panel overflow design:** choose measured wrapping versus accessible
   horizontal scrolling; define viewport-height accounting and 2D hit-testing;
   test many long chips at narrow widths.
2. **SP4:** option plumbing, API export cleanup, docs/hero adoption, grouping
   benchmarks, and any measured memoization work.
