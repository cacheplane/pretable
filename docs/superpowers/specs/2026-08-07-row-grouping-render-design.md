# Row grouping, sub-project 2: rendering group rows

Date: 2026-08-07
Status: approved
Predecessor: `2026-08-07-row-grouping-engine-design.md` (SP1, shipped as #237)

## Problem

SP1 shipped the grouping engine. `snapshot.visibleRows` already interleaves
`{kind:"data"}` and `{kind:"group"}` entries, `renderer-dom` already plans and
windows both kinds with full geometry, and every group row already carries its
`depth`, `columnId`, `value`, `childCount` and `aggregates`.

Nothing draws them. `pretable-surface.tsx` early-returns on
`renderRow.kind !== "data"`, so a grouped grid today renders blank bands where
the group headers belong. SP2 draws them and makes them interactive.

## Scope

In: the group column, group-row rendering, expand/collapse by mouse and
keyboard, aggregate cells, `treegrid` semantics, and the `@pretable/ui` styling.

Out: the drag-to-group drop panel (SP3), docs and hero adoption (SP4), sticky
group headers, group footers/totals, and per-kind row heights. Each is called
out under "Deliberately not doing" with the reason.

## Decisions

### 1. A dedicated group column

When `rowGroups` is non-empty a synthetic column with id `__pretable_group__`
leads the column list. It carries the label and twisty for *every* level,
indented by depth — not one column per level.

**It is derived, not injected.** The existing `__pretable_row_select__` column
is built React-side (`pretable-surface.tsx:777-795`) and prepended to the
`columns` prop before it ever reaches the engine. The group column cannot work
that way, because its presence is a function of `rowGroups` — *engine* state
that `setRowGroups` mutates, and that SP3's drag panel will mutate constantly.
React would have to read `snapshot.rowGroups` to build the column list that
produces the snapshot. That is a cycle.

Nor can the engine simply push it into `options.columns`:
`mergeColumnsFromProps` (`create-grid-core.ts:1004-1016`) rebuilds the list by
mapping over the *consumer's* array, so any column not in props is dropped on
the next prop identity change — which `HeroGrid` triggers on every render.

So the engine gains a derived accessor, `grid.getColumns()`, cached and
invalidated alongside the existing derived-rows cache:

```
getColumns() = [groupColumn?, ...options.columns.filter(not grouped)]
```

`options.columns` stays the consumer's truth, so every existing guard
(`setColumnWidth`, `moveColumn`, `setColumnOrder`, `setColumnPinned`,
`autosizeColumn`) keeps operating on real columns and needs no new special
case. The React layer switches its column reads to `getColumns()`:
`use-pretable.ts:381` (what the renderer plans from) and `391`, plus
`pretable-surface.tsx:819-825` (`columnsInVisualOrder`) and `3763`/`3776`
(width and pin maps).

`groupColumnsByPin` (`create-grid-core.ts:143-187`) already seats a synthetic
column at the head of its own pin region; `__pretable_group__` joins
`ROW_SELECT_COLUMN_ID` in that check, ordered after row-select.

Configurable via a new `groupColumn?: { header?: string; widthPx?: number;
pinned?: "left" }` option. Defaults: `widthPx: 200`, header taken from the
first grouped column's `header`, **not pinned**. (ag-grid does not pin its auto
column either; pinning it by default would silently consume the pinned-left
region a consumer may already be using.)

**Grouped columns are hidden from the data area**, uniformly — whether the
grouping came from initial options or a later `setRowGroups` call. Opt out with
`hideGroupedColumns: false`.

> ag-grid hides them only on dynamic grouping changes, never from the initial
> column definition (`rowGroupColsSvc.ts:94-108` vs `:29-36`), which is why
> every ag-grid example writes `hide: true` by hand. That asymmetry is a wart,
> not a feature. We hide uniformly.

### 2. Focusable group rows, APG treegrid keyboard model

SP1 made `moveFocus` step *over* group rows, and left an explicit hook for this
sub-project (`create-grid-core.ts:47`). SP2 cashes it in: group rows become
focusable and arrow navigation lands on them.

**Vertical movement preserves the column.** Arrowing up from the `price` cell
of a data row onto a group row lands on that group's `price` aggregate, not on
the group column — column stability is what every grid and spreadsheet does,
and snapping to column 0 would silently lose the user's place. So a group-row
focus address is `{ rowId: groupId, columnId: <whatever column focus was in> }`,
and the `Left`/`Right` behaviour below keys on *whether the focused column is
the group column*, not on the row's kind alone.

This means `moveFocus` (`create-grid-core.ts:566-710`) stops working in
data-row *ordinals* and walks flat-list positions instead. `scanDataRows` and
`dataRowAt` each have exactly one call site, both inside `moveFocus`, so the
blast radius is contained — but the governing doc comment at
`create-grid-core.ts:37-59` must be rewritten, not just amended.

Arrow keys follow the ARIA APG treegrid rules, which compose exactly:

| Key | Focus in the group column | Focus on a group's aggregate cell |
|---|---|---|
| `Right` | collapsed → expand; expanded → move to the next cell | move right |
| `Left` | expanded → collapse; collapsed → move to the parent group row | move left |
| `Enter` / `Space` | toggle | toggle |
| `Up` / `Down` | move between rows of either kind | same |

This keeps aggregate cells reachable by keyboard — a rule that consumed
`Left`/`Right` outright would strand them — while putting collapse and expand
where the twisty is.

ag-grid is not a precedent here: it binds `Enter` only and has no `Left`/`Right`
expand bindings anywhere (`groupCellRendererCtrl.ts:594-606`; confirmed absent
from `cellNavigationService.ts`). The APG model is strictly better and we should
ship it.

Aggregate cells are focusable but **not selectable or editable** — SP1 already
excludes group rows from `deriveSelectedRows` and from the paste row-space, and
that stands.

### 3. `role="treegrid"`, reactively

The surface renders `role="grid"` today (`pretable-surface.tsx:1790`). It
becomes `role="treegrid"` exactly when `rowGroups` is non-empty, and reverts
when grouping clears. An ungrouped grid is unaffected, so no existing consumer
changes.

This is what makes `Left`/`Right` discoverable to a screen-reader user rather
than an undocumented convention. ag-grid does the same
(`gridBodyCtrl.ts:180-194`).

Per group row:

- `aria-expanded` — **omitted entirely**, not `"false"`, when a group has become
  non-expandable (all children filtered away). ag-grid's row-level code writes
  `aria-expanded="false"` unconditionally at `baseExpansionService.ts:90`, which
  makes a childless row announce as a collapsed group. Don't copy that.
- `aria-level={depth + 1}`.
- `aria-rowindex`, consistent with the data-row path.

`aria-level` is a cheap win over the incumbent: ag-grid's root is a `treegrid`
and its rows carry `aria-expanded`, but nothing anywhere emits `aria-level`,
`aria-setsize`, or `aria-posinset` — depth is CSS-only. A treegrid without
`aria-level` gives a screen-reader user no sense of nesting.

### 4. `formatAggregate` for aggregate cells

`PretableFormatInput.row` is typed `TRow`, **non-optional**
(`types.ts:148-152`), so every consumer `format` is entitled to dereference
`input.row`. A group row has no `row`. Calling an existing formatter for an
aggregate would therefore crash inside consumer code that TypeScript declared
safe — ag-grid ships exactly this bug (`valueService.ts:396-402` passes
`data: node.data`, `undefined` on group rows).

So aggregates get their own hook rather than reusing `format`:

```ts
formatAggregate?: (input: {
  value: unknown;
  column: PretableColumn<TRow>;
  group: PretableGroupRow;
}) => string;
```

Columns without it render the aggregate through the same
default-stringify path a plain cell uses. `format` is untouched and can never be
invoked without a row. This also matches reality: an aggregate is frequently a
different kind of value than the cell beneath it (a count under a currency
column), so one formatter often *shouldn't* serve both.

## Rendering

### The group cell

```
[indent: depth × --pretable-group-indent] [twisty] [label] [count]
```

- **Indentation is padding inside the cell box**, driven by a
  `--pretable-group-depth` custom property on the cell. Never on the row and
  never a spacer sibling: indenting the row breaks pinning (the indent scrolls
  away from a pinned group column), breaks ellipsis truncation (computed
  against the wrong width), and breaks the focus outline.
- **The twisty is a `<button>`**, and its click handler calls
  `stopPropagation()` — otherwise expanding a group also selects the row.
- **Double-clicking the cell** toggles too, but the handler must ignore events
  originating on the twisty. A fast double-click on the chevron otherwise fires
  `click, click, dblclick` = open → close → **open**, and the group appears not
  to respond.
- **Blank values render `(Blanks)`**, not an empty cell. Grouping by a nullable
  column is the common case, and an empty group row is indistinguishable from a
  broken one.
- **Data rows get a leaf indent** in the group column — one twisty-width — so
  their content aligns with sibling group labels instead of sitting a chevron
  to the left. Invisible until you have mixed depths, ragged forever after.

### Aggregate cells

A group row renders a cell for every non-group planned column, in the same
positions as a data row, so aggregate columns line up under their headers.
Columns with no aggregate for that group render empty.

## Expansion and scroll

**No scroll correction is needed, and we should not build any.** pretable
virtualizes against a real scrolling element with a real spacer
(`getScrollContentStyle` sets `height: totalHeight`; rows are `position:
absolute; top`). Collapsing a group removes height strictly *below* the
anchor, so everything above keeps its exact pixel position — viewport
stability is a property of the layout, not of compensating code. ag-grid's
only scroll write in the entire expansion path is gated on
`rowNode.sticky` (`baseExpansionService.ts:26-45`); the non-sticky case has
nothing, and doesn't need it.

The one case that isn't free: collapsing near the bottom can leave the stored
`scrollTop` past the new `totalHeight`. The browser clamps `el.scrollTop` when
`scrollHeight` shrinks, and the surface reads scroll position from the DOM
(`pretable-surface.tsx:2006`) rather than owning it, so the clamp propagates —
but only on the next scroll event, which leaves a possible one-frame window
where rows are planned against an out-of-range offset. **This is an acceptance
item to verify in a real browser, not machinery to pre-build.**

## Guards

- **A group can stop being expandable** when a filter removes all its children.
  The twisty must disappear and `aria-expanded` must be dropped. ag-grid
  subscribes to five separate node events for this
  (`groupCellRendererCtrl.ts:258-267`); our full-recompute model gets it from
  the snapshot, but it needs a test.
- **`childCount` is post-filter**, as SP1 specified.
- **Row heights stay uniform across kinds.** A taller group row would force the
  height model off estimated heights — ag-grid has no `groupRowHeight` option
  for exactly this reason (`gridOptionsUtils.ts:91,107-109`). If we ever want
  one, it's a height-model change, designed up front.

## Deliberately not doing

- **Sticky group headers.** On by default in ag-grid, but 512 lines of
  `stickyRowFeature.ts` plus a service, two extra row containers, a fixed-point
  convergence loop, and the scroll correction above. It is cleanly separable —
  ag-grid creates it lazily from an optional bean
  (`rowRenderer.ts:171-175`) and community builds simply omit it. Their own
  accessibility docs recommend turning it off, because sticky rows put rows in
  an order that contradicts `aria-rowindex`. Ship rendering without it.
- **Group footers / totals rows.** Their existence forces a real decision about
  whether an expanded group's header *hides* its own aggregates to avoid
  showing "Sum: 500" twice (`valueService.displayIgnoresAggData`). We show
  aggregates on the header unconditionally, which is only correct while there
  is no footer.
- **`groupDisplayType: multipleColumns`.** Single column only.
- **Expand/collapse animation.** Animation, sticky rows, and correct DOM order
  are pick-two in ag-grid (`rowCtrl.ts:1813`). Correct DOM order wins.

## Testing

- **grid-core**: group column injection and its config; grouped-column hiding
  both ways; `setFocus`/`moveFocus` landing on group rows; the `Left`/`Right`
  branch table; parent-navigation on `Left` from a collapsed group.
- **react (RTL)**: twisty renders per depth and disappears when a group empties;
  `aria-expanded` present/absent/true/false; `aria-level`; role flips
  `grid` ↔ `treegrid`; `(Blanks)`; `formatAggregate` applied and its absence
  falling back; twisty click does not select the row.
- **Real browser (Playwright)**: indentation measured per depth; collapse near
  the bottom of a long list leaves scroll consistent and rows correctly placed;
  keyboard expand/collapse round-trip.

jsdom has no layout engine, so every positional claim above is a real-browser
assertion or it is not verified — right-pin shipped measurably broken past 316
green jsdom tests. Each keyboard test needs a negative control: it must fail
when the binding alone is removed.

### The existing suite that must invert

`pretable-surface.test.tsx:5099-5255` (`describe("keyboard navigation over
grouped rows")`) asserts `isGroupRowId(focus().rowId) === false` after Cmd+Home,
End, Cmd+End, PageDown, PageUp, Tab and Shift+Tab. **Every one of those
assertions is now wrong**, and rewriting them to assert the opposite is a
required, deliberate part of this work — not incidental churn, and not
something to delete. It is the clearest single record of the contract SP2
changes.
