# Row grouping + aggregation: engine — design (P2 sub-project 1 of 4)

**Date:** 2026-08-07
**Branch:** `claude/grouping-engine` (off `main`)
**Status:** approved (design confirmed in-session)

## Context

The engine's row model is deliberately flat: `PretableVisibleRow { id, row, sourceIndex }`,
with no hierarchy concept anywhere in `packages/grid-core/src/types.ts`. Grouping is the
last v1 gap (P0 filtering ✅, P1 multi-sort ✅ / right-pin ✅ / paste ✅) and the biggest
delta vs ag-grid — where **all** of `rowGrouping`, `aggregation`, `groupHierarchy`,
`treeData` and `pivot` live in `packages/ag-grid-enterprise/` with no community
equivalent. An MIT grid with real grouping is a GTM position, not just parity.

This is **sub-project 1 of 4**:

1. **Engine** (this spec) — grouped row model, multi-level grouping, expand/collapse,
   aggregation. Headless.
2. Surface rendering — group rows, indentation, twisty, expand/collapse interaction, a11y.
3. Group-by drop panel — drag headers in, chips, reorder/remove levels.
4. Docs + hero/showcase adoption + bench measurement.

## Decisions (locked in brainstorm)

1. **Row grouping + aggregation only.** No tree data, no pivot.
2. **Multi-level from the start** — an ordered list of group columns, arbitrary depth.
3. **Full recompute** on data change; measure on the streaming bench before optimizing.
4. **Filtered-out rows in aggregates: configurable** (see "Filtered aggregates").
5. Copy semantics (sub-project 2): group label in the group column, aggregates elsewhere,
   block stays rectangular.

## Research: ag-grid, and where we deliberately differ

Verified against `~/repos/ag-grid` @ `11fb3b0dcdb`. Cited because several decisions below
are _reactions_ to what they do.

- **Display list:** they keep a `RowNode` tree + a flat `rowsToDisplay` built by
  `flattenStage` (only descends into expanded groups). Same shape as ours. They use
  boolean flags on one `RowNode` class rather than a discriminated union, and their flat
  list carries **more than two kinds** — group, data, footer/total, master-detail.
- **Group ids:** `parent.id + colId + '-' + key` — path-derived, kept in a long-lived
  `nonLeafsById` map, nodes reused to preserve expand state. Their `-` separator is
  ambiguous when a key contains `-`; **we escape ours**.
- **Aggregate rollup:** they compute each parent from its **child aggregates**, and their
  `avg`/`count` return `{value, count}` wrapper objects so weighted rollup is correct.
  Their docs state the taxonomy plainly: sum/min/max combine trivially; count/avg carry
  auxiliary state; **median/percentile are not combinable and are not offered**.
- **Incremental recompute:** `ChangedPath` (ancestor-closed dirty set, deepest-first)
  skips untouched branches; a second tier (`ChangedCellsPath`) skips unchanged _columns_;
  `applyTransactionAsync` coalesces transactions on a 50 ms timer into one refresh.
- **Pipeline:** group → filter → pivot → aggregate → filter_aggregates → sort → map.
  Note **two** filter passes — the second lets you filter groups by aggregate value.
- **Aggregation input** is `childrenAfterFilter` or `childrenAfterGroup` depending on
  `getGroupAggFiltering`/`suppressAggFilteredOnly` — i.e. our "configurable" decision
  matches theirs.

## The aggregate function interface (the most consequential API here)

Aggregates are defined as a **monoid**, not as `(values) => result`:

```ts
/** @public */
export interface PretableAggregator<TAcc = unknown, TOut = unknown> {
  /** Empty accumulator. */
  init(): TAcc;
  /** Fold one leaf cell value into the accumulator. */
  accumulate(acc: TAcc, value: unknown, row: PretableRow): TAcc;
  /** Combine two accumulators (must be associative; init() is the identity). */
  merge(a: TAcc, b: TAcc): TAcc;
  /** Produce the display value. */
  finalize(acc: TAcc): TOut;
}

// Column config:
aggregate?: "sum" | "avg" | "min" | "max" | "count" | PretableAggregator;
```

**Why this shape.** v1 computes every group's aggregate from its full set of descendant
leaf rows (`init` + `accumulate` per leaf + `finalize`) — correct by construction, and it
gives us `median`/`distinctCount` as viable built-ins, which ag-grid cannot offer. But
because `merge` is part of the contract from day one, switching to child-aggregate rollup
later is a **pure internal optimization** rather than a breaking change to every
consumer's aggregate function. ag-grid's users are stuck with the rollup contract
(`params.values` holds child results above the leaves) and must hand-roll `{value,count}`
wrappers; we keep that entirely internal.

`finalize` also means aggregate **cell values are plain scalars**. ag-grid's wrapper
objects leak into rendering, sorting, formatting and clipboard, each needing a workaround.

Built-ins ship as `PretableAggregator`s: `sum`, `avg` (accumulator `{sum, count}`),
`min`, `max`, `count`. `median`/`distinctCount` are viable later precisely because we
fold over leaves; they are **not** in v1's built-in set (YAGNI), but the interface admits
them without change.

## Row model

`PretableVisibleRow` becomes a discriminated union, deliberately **open** (ag-grid's list
grew to four kinds; ours will too when total/footer rows arrive in a later sub-project):

```ts
/** @public */
export type PretableVisibleRow<TRow extends PretableRow = PretableRow> =
  | PretableDataRow<TRow>
  | PretableGroupRow;

export interface PretableDataRow<TRow> {
  kind: "data";
  id: string;
  row: TRow;
  sourceIndex: number;
  /** Nesting depth; 0 when ungrouped. */
  depth: number;
}

export interface PretableGroupRow {
  kind: "group";
  id: string; // stable, path-derived (see below)
  depth: number;
  columnId: string; // the column this level groups by
  value: unknown; // the group key value
  childCount: number; // data rows beneath, post-filter
  aggregates: Record<string, unknown>; // columnId -> finalized value
}
```

`visibleRows` stays a **flat array** — virtualization, selection ranges, focus, and copy
all depend on that, and it is what ag-grid does too.

**Breaking change, wide blast radius:** `copy.ts`, `renderer-dom`, `pretable-surface`,
`labeled-grid-surface`, bench adapters and the website all read `visibleRows[].row`
today. Consumers must narrow on `kind`. Acceptable under no-backcompat; it is the reason
this is its own sub-project. Every one of those call sites gets migrated here so the repo
stays green, even though _rendering_ group rows is sub-project 2.

**`depth` vs rendered depth.** ag-grid needs two numbers (`level` and `uiLevel`) because
single-child-group collapsing changes rendered indentation without changing tree depth.
We do not ship single-child collapsing in v1, so one `depth` suffices — but it is a
property of the **flat entry**, not of any node, which keeps that door open.

## Grouping API

- Column config: `rowGroup?: boolean` (declarative default) — order follows column order.
- Engine: `setRowGroups(columnIds: string[]): void` — ordered, outermost first;
  `[]` = ungrouped. Change-guarded like `replaceSort`.
- Controlled: `PretableSurfaceState.rowGroups?: string[]`, applied via `setRowGroups`.
- `snapshot.rowGroups: string[]`.

## Group identity

Ids are path-derived and stable across ticks:
`__group__:<colId>=<escapedKey>/<colId>=<escapedKey>…`

`escapedKey` percent-escapes `/`, `=` and `%` so a key containing a separator cannot
collide (ag-grid's raw `-` join is ambiguous; we fix that). Stability is load-bearing:
expand state, focus, and selection are all id-addressed, and the selection-under-streaming
fix (PR #176) established that positional identity breaks under tick load.

**Changing the outermost group column invalidates every id.** ag-grid detects this and
refuses node reuse. We accept the consequence — expansion state resets when group level 0
changes — and document it.

## Expand/collapse

State is a **set of collapsed group ids**, plus `groupsDefaultExpanded?: boolean`
(default `true`).

- Groups appearing mid-stream inherit the default with no bookkeeping — the streaming
  case ag-grid handles with a tri-state `_expanded` field.
- A group that briefly empties and returns **keeps** the user's collapsed state, because
  the id survives independently of any node. ag-grid loses it (`removeEmptyGroups`
  destroys the node).
- **Cost we accept:** the set can accumulate ids for groups that never return. v1 prunes
  it on `setRowGroups` (ids are invalid anyway) and leaves streaming-accumulated ids in
  place — bounded by distinct group keys, which is bounded by the data. Documented.
- API: `toggleGroup(id)`, `setGroupExpanded(id, expanded)`, `expandAll()`,
  `collapseAll()`; `snapshot.collapsedGroupIds: ReadonlySet<string>`.

## Pipeline

`filter → group → aggregate → sort → flatten`

- **Filter first**, on data rows (existing behavior, unchanged).
- **Group** the surviving rows into a tree keyed by the group column values, in order.
- **Aggregate** each group. Input rows depend on the filtered-aggregates setting below.
- **Sort**: data rows sort within their group using the existing `PretableSortEntry[]`
  cascade; groups sort among their siblings by group `value`. (Sorting groups _by an
  aggregate_ is deferred — ag-grid does it via a post-aggregation stage.)
- **Flatten** to the visible list, descending only into expanded groups.

Deferred from ag-grid's pipeline, deliberately: pivot, and the second
`filter_aggregates` pass (filter groups by aggregate value). Both are additive later.

## Filtered aggregates (configurable, per the brainstorm)

`PretableGridOptions.aggregateFilteredRows?: boolean` (default **`false`** — aggregate
only rows that pass the filter, so a group total always equals the sum of the rows you
can see beneath it). When `true`, aggregates fold over all rows in the group regardless
of the active filter. `childCount` always reflects post-filter rows so the label and the
visible children agree.

## Streaming correctness (the part most likely to be got wrong)

1. **Re-pathing on key change.** Under streaming the common mutation is not "a value
   changed" but "a row's _grouping key_ changed" — a position gets reclassified into a
   different sector. A naive in-place update leaves the row under its old group.
   `applyTransaction`/`setRows` must detect a changed group path for updated rows and
   move them. ag-grid has a dedicated `moveNodeInWrongPath` for exactly this; we need the
   equivalent, and it needs a test that mutates a grouping key mid-stream.
2. **Identity preservation for unchanged aggregates.** If a recompute yields the same
   value, the `aggregates` object for that group must keep its previous identity so
   downstream memoization doesn't repaint every group row on every tick. ag-grid returns
   the previous object identity for exactly this reason.
3. **Snapshot caching** extends to grouping: the derived-rows cache keys on
   sort/filters/rows identity today and must also key on `rowGroups`, the collapsed set,
   and the aggregate config.

## Testing

- **Grouping**: single and multi-level; group ordering; key escaping (a key containing
  `/`, `=`, `%`); ungrouped (`[]`) is byte-identical to today's flat output; unknown
  column ids dropped from `setRowGroups`; `childCount` post-filter.
- **Aggregation**: each built-in over a known fixture; multi-level correctness — assert a
  parent's `avg` equals the average of **all descendant leaves**, with child groups of
  _different sizes_ (the case naive rollup gets wrong); a custom `PretableAggregator`;
  `merge` associativity property test (so a later rollup optimization is safe);
  `finalize` yields scalars; `aggregateFilteredRows` both ways.
- **Expand/collapse**: collapsed-set semantics; new group mid-stream defaults expanded;
  a group that empties and returns keeps its collapsed state; `expandAll`/`collapseAll`;
  pruning on `setRowGroups`.
- **Streaming**: a transaction changing a grouping key re-paths the row; unchanged
  aggregates keep object identity; selection/focus survive grouped tick updates.
- **Migration**: every existing consumer of `visibleRows[].row` narrows correctly and the
  repo stays green.
- Full sweep + `pnpm api` (large public surface change).

## Out of scope (this sub-project)

Rendering group rows, indentation, twisty, expand/collapse interaction, a11y (SP2); the
drop panel (SP3); docs/hero/bench (SP4). Also deliberately deferred: tree data, pivot,
total/footer rows, single-child-group collapsing, sticky group headers, filtering groups
by aggregate value, sorting groups by aggregate, `groupSelectsChildren` semantics, and
incremental/changed-path recompute (revisit after the bench).
