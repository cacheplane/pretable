# Row grouping correctness, round 2

Date: 2026-08-09
Status: approved
Predecessors: SP1 #237, SP2 #254, SP3 #258, and the first correctness
follow-up #259 (`2026-08-08-row-grouping-correctness-followup-design.md`).

## Problem

#259 established the invariant: _once grouping is active, every user-facing
operation must address the same derived rows and columns the user can see._ It
enforced that for focus, copy, ARIA and column invalidation.

**It did not enforce it for selection**, and in the same change it made
selection _more_ dependent on the derived model — `toggleRowSelection`,
`selectAll` and `setSelectAllVisible` now encode their column bounds from
`getColumns()` (`create-grid-core.ts:388-390`, `:482-484`, `:516-518`).
`getColumns()` changes membership the instant grouping toggles, and nothing
re-encodes the existing ranges. `setRowGroups` (`:1203-1217`) calls
`reconcileFocusAfterVisibleModelChange` and stops there.

Reproduced against `main` @ `58796c6`, columns `dept,name,amount`, grouping by
the last drawn column:

| Step                                                | Expected             | Actual                                     |
| --------------------------------------------------- | -------------------- | ------------------------------------------ |
| select row 1, then group                            | row 1 stays selected | **deselected**; stale range retained       |
| toggle that row again                               | deselects            | **a second range appears**; never unchecks |
| `selectAll()`, then ungroup                         | all selected         | **empty**                                  |
| `selectAll()` grouped, `setSelectAllVisible(false)` | clears               | **no-op**, stuck on                        |

It is masked in the common case: with a row-select column present, only
grouping the _last_ drawn column triggers it. That is why it survived review.

The blast radius is not cosmetic. `pretable-surface.tsx:1606-1611` and
`:1650-1655` skip endpoints that no longer resolve, so `onRowSelectionChange`
reports a set with rows silently dropped. And `copy.ts:189-198` degrades a range
whose `startColumnId` vanished to `colLo = colHi = endCol` — **Cmd+C after
grouping copies one column instead of the whole row**, with no error.

Three further defects are in scope, each verified:

1. **#259 regressed invalidation for every grid, grouped or not.**
   `sameColumnGroupingSemantics` (`create-grid-core.ts:1606-1622`) compares
   `value`/`aggregate` by _identity_; `:1054-1057` then nulls
   `cachedVisibleRows` and `:1063-1069` emits, ungated on whether grouping is
   active. Measured: two `mergeColumnsFromProps` calls with semantically
   identical, freshly-allocated `value` closures produce `emits=2` and destroy
   `visibleRows` identity **on an ungrouped grid**. That is the inline-columns
   idiom our own docs show (`cell-renderers.mdx:142`). No in-repo consumer is
   exposed because `HeroGrid` and the fixture both `useMemo`. The comment at
   `use-pretable.ts:271-274` still asserts the old, now-false behaviour.

2. **With any left-pinned column, the tree column is not the first column.**
   `groupColumnsByPin` seats the synthetic column at the head of _its own pin
   region_ (`create-grid-core.ts:131-153`). Unpinned, that is the head of the
   array; with left-pinned data columns present it is the head of the
   **unpinned** run.

   Corrected during implementation — my original wording here said the tree
   column lands "last" / "right-most", which is wrong. Measured with columns
   `name(left), dept, qty` grouped by `dept`, the drawn order is:

   ```
   name(left), __pretable_group__, qty
   ```

   So it is the left-most **scrolling** column. The defect is that the tree
   label, twisty and indentation are not the row's first column and scroll out
   from under the pinned region — not that they land on the far right.

   The documented escape hatch, `groupColumn.pinned: "left"`, is unreachable
   from React — `UsePretableOptions` (`use-pretable.ts:149-161`) does not accept
   it and `usePretable` forwards only `{columns, rows, getRowId, autosize}` to
   `createGrid` (`:254`).

3. **Seven tests pass under a broken implementation.** Listed below.

## Scope

In: selection reconciliation across grouping and column-model changes; the
`mergeColumnsFromProps` over-invalidation; the four grouping options plumbed
through React; the seven vacuous tests.

Out: panel chip overflow (needs its own design — see below), SP4 docs/hero/bench,
`beginEdit` on a group row, the group-column paste anchor, and the untested
interaction matrix. Each is real; none is a data-integrity bug, and mixing a
layout redesign into a correctness branch is what #259 correctly refused to do.

## Design

### 1. Selection is reconciled whenever the column model changes

Add `reconcileSelectionAfterColumnModelChange`, a sibling to the existing focus
reconciler, called from the same places: `setRowGroups`,
`mergeColumnsFromProps`, and any path that replaces `options.columns`.

For each range: re-encode endpoints that were _full-row_ bounds onto the new
`getColumns()` first/last, preserving the row span. Drop ranges whose endpoints
no longer resolve and were not full-row. A range is "full-row" if its endpoints
matched the drawn first/last at the time it was created — determine this by
comparing against the pre-change `getColumns()`, which the reconciler receives.

`toggleRowSelection` must additionally be idempotent across a grouping change:
toggling a row whose range was re-encoded deselects it rather than appending a
second range. That falls out of correct re-encoding, and is pinned by its own
test.

**Why not "drop everything on a grouping change":** it is defensible and much
simpler, but it means grouping silently discards the user's selection, which is
the behaviour we are fixing. Re-encoding preserves intent.

### 1b. Reordering and pinning corrupt ranges too — and this is not a grouping bug

Found while implementing §1, and verified independently: the same corruption
occurs with **no grouping involved at all**. A range does not need to _lose_ a
column to break; it only needs the columns between its endpoints to change.

Measured on columns `a,b,c` with no grouping:

```
toggleRowSelection("r1")  → range a…c, row "selected"
moveColumn("c", 0)        → drawn order c,a,b
                          → range still a…c, which now spans (c,a) and excludes b
                          → row tri-state: "indeterminate"
```

So a user who selects a row and then drags a column sees the checkbox go
half-filled, and Cmd+C copies two of three columns. This affects every grid with
row selection and drag-to-reorder — both shipped long before grouping.

`moveColumn`, `setColumnOrder` and `setColumnPinned` must therefore call the
same reconciler. It is already generic over "the drawn column model changed";
these paths simply were not wired to it because §1 was scoped to paths that
_replace_ `options.columns`. That scoping was mine and it was too narrow.

### 2. Invalidation is gated on grouping actually being active

`sameColumnGroupingSemantics` compares by identity, which is correct and cheap
for detecting a _possible_ change but wrong as the sole trigger. Two changes:

- Only consult it for columns that participate in grouping — those in
  `rowGroups` or carrying an `aggregate`. A `value` closure on an ungrouped,
  non-aggregated column cannot affect the grouped row model.
- Gate the `cachedVisibleRows = null` + emit on `rowGroups.length > 0`.

Update the stale comment at `use-pretable.ts:271-274` to describe what the code
now does.

### 3. The four grouping options reach React

`groupColumn`, `hideGroupedColumns`, `aggregateFilteredRows` and
`groupsDefaultExpanded` are added to `UsePretableOptions` and
`PretableSurfaceProps` and forwarded into `createGrid`.

**The hazard:** `use-pretable.ts:223-227` memoizes the grid on
`[autosize, stableGetRowId]`, and the comment there is explicit that adding an
identity-unstable dep recreates the grid — discarding sort, filters, selection,
focus and expansion on every render. `groupColumn` will be written inline
(`groupColumn={{ pinned: "left" }}`) by every consumer who uses it. So these are
create-time options that must **not** enter the deps array; follow the
`autosize` precedent, and depend on primitive fields rather than the object, the
way `rowSelectionColumn` already does at `pretable-surface.tsx:777-795`.

This also makes defect 2 recoverable: `groupColumn={{ pinned: "left" }}` puts
the tree column at the head of the left-pinned region where it belongs.

### 4. The seven tests that pass under a broken implementation

| Test                              | Why it is vacuous                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group-column.test.ts:88`         | asserts the group column's header is `"Sector"`, but the consumer's own first column is already `{id:"sector", header:"Sector"}` — passes if the group column is never prepended |
| `group-column.test.ts:104`        | same address-space flaw, `toBeUndefined()`                                                                                                                                       |
| `group-panel-drag.test.tsx:501`   | only indicator-position test uses the append case; deleting the in-loop indicator render still passes                                                                            |
| `group-panel-hit-test.test.ts:53` | promises edge semantics; no probe is on an edge — flipping all four comparisons to exclusive passes                                                                              |
| `group-row-render.test.tsx:148`   | one-sided bound; passes if every row gets `aria-rowindex="1"`                                                                                                                    |
| `group-row-render.test.tsx:337`   | hands the serializer a hand-built group row whose id isn't even `makeGroupId`'s format; never proves both paths get the same object                                              |
| `group-panel.test.tsx:83`         | `toBeLessThan(400)` where `364` was exact; any reservation > 0 passes                                                                                                            |

Each is rewritten to a form that fails when the behaviour it names is removed,
and each gets a negative control run.

**One of the seven needed an implementation change, not just a test.** Pinning
`hitTestGroupPanel`'s edge semantics forces a decision the code had never made
deliberately: all four comparisons were inclusive, so the panel owned
`rect.bottom`. The panel and the scroll viewport are adjacent children of a
fixed-height flex column (`pretable-surface.tsx:3823-3841`), so the panel's
`rect.bottom` **is** the header row's `rect.top`, to the pixel — and an
inclusive bottom edge means one row of pixels aimed at the header groups the
column instead of reordering it. That is the exact failure the module's own
docstring says it exists to prevent when it rejects a collapsed panel. The rect
is now half-open, `[left, right) × [top, bottom)`, matching
`elementFromPoint`: left and top inside, right and bottom out. Each of the four
comparisons has its own probe and its own negative control.

## Deliberately deferred

**Panel chip overflow.** The SP3 spec claims "Ours wraps instead"
(`2026-08-07-row-grouping-panel-design.md:203`). That is false: `styles.ts:57-66`
is `display: flex` with a fixed `height` and `overflow: hidden`, and the CSS sets
no `flex-wrap`. Chips clip into dead space that cannot be scrolled, so a clipped
chip is unreachable by mouse, is focusable-but-invisible by keyboard, and gives
`hitTestGroupPanel` an off-screen rect so drag insertion is wrong for exactly the
levels the user cannot see. #259 deferred this as needing a real choice between
measured multi-line height and accessible horizontal scrolling. That still
stands — it is a layout design, not a correctness patch, and it does not belong
on this branch. **Correct the SP3 spec's false claim as part of this work** so
the next reader is not misled.

## Testing

Every fix starts from a failing test reproducing the table above. Each gets a
negative control: revert the one line, confirm the test fails, restore.

The selection fixes are engine-level and belong in
`grid-core/src/__tests__/grouping-engine.test.ts` — the existing suite tests
selection _within_ a fixed grouping state and never across a transition, which
is precisely the hole. Add the copy consequence as a React test, since the
degradation happens in `copy.ts`.
