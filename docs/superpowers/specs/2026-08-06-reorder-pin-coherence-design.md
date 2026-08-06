# Reorder / pin coherence

Date: 2026-08-06

## Problem

Since right-pinning shipped, column reordering and pinning disagree about where a
column is.

1. A right-pinned column dragged to array index 0 keeps `pinned: "right"` — the
   guard in `moveColumn` deliberately prevents a silent unpin — but it now sits
   at array index 0 while rendering last. `plannedCol.index` feeds
   `aria-colindex` in `packages/react/src/pretable-surface.tsx`, so assistive
   technology reports "column 1" for a column rendered at the far right.
2. An unpinned column dropped past the right-pinned group lands after it in the
   array with no auto-pin, while the left region has an auto-pin/unpin rule.

Both are symptoms of one broken invariant.

## The invariant

`grid.options.columns` is always grouped:

```
[synthetic row-select?] [pinned "left"…] [unpinned…] [pinned "right"…]
```

**Array order is visual order.** `planColumns` partitions its input by pin state
and emits `[pinnedLeft…, scrollable…, pinnedRight…]`, so a `PlannedColumn`'s
`index` is a true visual index only while the source array is already grouped.
Three consumers assume this silently:

- `aria-colindex={plannedCol.index + 1}` in the surface,
- the `columnLefts` / `columnWidths` arrays the reorder gesture builds,
- `computeDropIndex`, which linear-scans those arrays and needs monotonically
  increasing offsets.

`setColumnPinned` already maintains the invariant. `moveColumn` breaks it.

## Two further problems this fix has to reckon with

**Drop-index geometry is not reachable for the right region.**
`computeDropIndex` compares a viewport-relative cursor `x` against content-space
column offsets, with no `scrollLeft` term and no awareness that pinned groups
are sticky. In the `/#column-layout` demo (1390px of columns in a ~900px
viewport, `note` pinned right) the right-pinned column's content offset is
~1150 — a cursor inside the viewport can never produce that `x`. Any rule that
auto-pins on drop into the trailing region is dead code without a geometry fix.
The same omission mis-targets sticky left-pinned columns whenever the grid is
scrolled horizontally.

**The controlled `columnOrder` reapply can livelock.** `use-pretable` replays
the controlled order as a loop of `moveColumn` calls, then applies
`columnPinned`. Once `moveColumn` derives pin state from landing position, an
inconsistent controlled pair (`columnOrder: ["actions","a","b"]` with
`columnPinned: {actions: "right"}`) oscillates: the order pass unpins, the pin
pass re-pins and repositions, the snapshot changes, the effect re-runs.

## Design

### 1. `moveColumn` — one region-derived pin rule

Replace the left-only auto-pin rule and the right-pin guard with a single
symmetric rule. After splicing `moved` into `clampedTo` in `nextColumns`:

- `leftBoundary` — end of the leading `pinned === "left"` run, skipping
  `clampedTo`. This is today's `boundary` computation, unchanged.
- `rightBoundary` — start of the trailing `pinned === "right"` run, skipping
  `clampedTo`; defaults to `nextColumns.length` when there is no trailing run.
- ```
  nextPinned =
    clampedTo < leftBoundary  ? "left"
    : clampedTo >= rightBoundary ? "right"
    : undefined
  ```

Left behavior is bit-identical to today: same boundary computation, same
`clampedTo < boundary` predicate, same resulting pin. The right is now its exact
mirror.

The two predicates can never both hold — a column that lands between the two
runs satisfies neither — so the rule is total and unambiguous.

Behavioral consequences (all deliberate):

- A right-pinned column dragged out of the trailing group **unpins**, mirroring
  the existing left-region drag-out.
- An unpinned column dropped at or past the first right-pinned slot
  **right-pins** and joins the trailing group.
- A right-pinned column dragged into the leading group **left-pins**.

The invariant is preserved by construction: the columns other than `moved`
already satisfy it, and `moved` is assigned the pin of whichever region its
landing index falls in.

`aria-colindex` needs no code change — `plannedCol.index + 1` is correct once
the invariant holds. One source of truth, locked with a test.

### 2. `setColumnOrder(ids)` on grid-core

New method on the core grid:

```ts
setColumnOrder(ids: readonly string[]): void
```

Reconciles the whole order in a single commit:

1. filter `ids` to columns that exist,
2. append any current column ids absent from `ids`, in their current order,
3. keep the synthetic row-select column at index 0 if present,
4. **stable-partition by each column's existing pin state** into
   left / unpinned / right.

Pin state is never read from the argument and never changed. The result
satisfies the invariant by construction.

`use-pretable`'s controlled reapply calls this instead of looping `moveColumn`,
which removes the transient intermediate arrays entirely. With pin state
untouched by the order pass, the reapply converges: the order pass groups by
current pins, the pin pass corrects pins, the next order pass re-groups by the
corrected pins, and the pass after that is a no-op. A fixpoint in at most two
effect runs, whether or not the controlled slices agree with each other.

`setColumnOrder` is public API; the api-extractor reports need regenerating.

### 3. Region-aware drop index

`computeDropIndex` becomes a hit test in visual space. Inputs gain `scrollLeft`,
`viewportWidth`, `pinnedLeftWidth`, `pinnedRightWidth`:

- `x < pinnedLeftWidth` → walk the left-pinned run; its planned `left` values
  are already viewport-space for that group.
- `x >= viewportWidth - pinnedRightWidth` → walk the right-pinned run inward
  from the trailing edge using the planned `right` offsets.
- otherwise → content x is `x + scrollLeft`; walk the scrollable run by content
  `left`.

The midpoint rule inside each region is unchanged, and the return value is still
an index into the engine array, so the `moveColumn` call site is untouched.

`computeDropIndicatorLeft` gets the matching treatment so the 2px indicator
lands on the boundary the drop will actually use. The indicator stays
`position: absolute` in content coordinates inside the scrollport; for a hit in
either pinned region its content-space left is derived from the same region
math. There is no drag auto-scroll, so the indicator does not need to be sticky.

`planColumns` already computes `pinnedLeftWidth` and `pinnedRightWidth`. Plumb
them through `DomRenderSnapshot` and `PretableRenderSnapshot` rather than
re-deriving them in the surface — layout-core stays the single source of truth
for geometry.

## Tests

**`packages/grid-core`** — a shared `expectGrouped(columns)` helper asserting the
invariant, called after every mutation in these cases:

- right-pinned column dragged to index 0 → unpinned, lands at index 0
- right-pinned column dragged into the leading pinned run → `pinned: "left"`
- unpinned column dropped at the first right-pinned slot → `pinned: "right"`,
  array-trailing
- the same column dropped one slot earlier → stays unpinned
- existing left-region auto-pin/unpin cases pass unmodified
- `setColumnOrder`: reorders, preserves pin state, regroups into the invariant,
  ignores unknown ids, appends omitted ids, keeps the synthetic column at 0

**`packages/react`** — RTL:

- with a left-pinned and a right-pinned column present, the `aria-colindex` of
  every `[role="columnheader"]` ascends in DOM order and covers `1..N` with no
  gaps or repeats
- `computeDropIndex` region hit tests against a horizontally scrolled surface:
  a cursor over the sticky left group targets a left-pinned column, a cursor
  over the trailing group targets a right-pinned column, a cursor in between
  accounts for `scrollLeft`
- a controlled `columnOrder` inconsistent with `columnPinned` settles to a
  stable snapshot rather than re-rendering forever

## Docs

`apps/website/content/docs/grid/column-layout.mdx`:

- **Reorder** — replace the cross-boundary paragraph with the symmetric rule; a
  moved column adopts the pin state of the region it lands in. The sentence
  "Right pinning has no drag affordance — a right-pinned column keeps its pin
  through a reorder" is now false and must go.
- **Pin** — state the array/visual order invariant, and that `aria-colindex`
  follows it.
- **Controlled state** — document `columnOrder` as a relative order that the
  engine regroups by pin state, so an order that interleaves pinned and
  unpinned columns is normalised rather than honoured literally.

## Verification

Manual drag check in a real browser at `/#column-layout` — the demo overflows
horizontally and has `note` pinned right, so it exercises the scrolled case and
both pinned regions: drag a scrollable column into the trailing group, drag
`note` out of it, and drag while scrolled to confirm the indicator tracks the
cursor.

## Out of scope

- Drag auto-scroll at the viewport edges.
- Any keyboard affordance for reorder or pin.
- Changing `setColumnPinned`'s insert-at-boundary behavior.
