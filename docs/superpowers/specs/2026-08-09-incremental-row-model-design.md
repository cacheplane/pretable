# Incremental local row model design

**Date:** 2026-08-09  
**Status:** Approved in conversation; pending independent spec review  
**Scope:** Replace Pretable's full local derived-row recomputation with a
persistent indexed row model, migrate the grid and React renderer to windowed
access, and prove grouped streaming at 100,000 local rows. A remote transport
or server-side row-model protocol is explicitly out of scope.

## Context

SP4 added a permanent `updates-grouped` benchmark before adopting grouping in
the website hero. The prescribed S5 comparison used the same Pretable adapter,
20,000 rows, 30 columns, 1,000 patches per second, 50 patches every 50 ms, and a
three-second duration. Grouped mode used `col_1` as the group key and summed
`col_3`.

The flat run passed at `scroll_frame_p95_ms = 10.099999999999909`. The grouped
run failed the hard frame gate at `26 ms`, despite zero long tasks, zero scroll
drift, and zero visible-row-count drift. Frame-budget overruns rose from 6 to 60. The evidence is recorded in
`docs/research/2026-08-08-row-grouping-streaming-benchmark.md`.

The failure is not excessive DOM rendering. Only a viewport-sized row window is
drawn. The cost occurs earlier:

1. the stream adapter RAF-batches patches into one transaction;
2. `applyTransaction` invalidates the complete derived-row cache;
3. the next snapshot scans all rows for filtering;
4. grouping rebuilds the complete tree;
5. aggregation folds every descendant leaf again;
6. flattening allocates a new complete visible-row array; and
7. React/layout rescans that array for heights, indexes, selection, and
   viewport planning.

A local diagnostic over the compiled engine corroborated the browser result:

| Operation over 20,000 S5 rows                   |   Median |      p95 |
| ----------------------------------------------- | -------: | -------: |
| Flat derivation                                 |  0.60 ms |  2.18 ms |
| Grouping without aggregation                    |  7.67 ms |  8.34 ms |
| Grouping with aggregation                       | 14.87 ms | 15.97 ms |
| Random grouped 50-patch transaction + snapshot  | 16.26 ms | 19.85 ms |
| Group-key-heavy 50-patch transaction + snapshot | 20.11 ms | 25.43 ms |

The benchmark intentionally updates random columns. Updates to `col_1` assign
unique strings, so group cardinality grows throughout the run. This must remain
part of the workload: it exercises rows moving between group paths rather than
only stable aggregate changes.

## Goals

- Support 100,000 grouped local rows streaming at 1,000 patches per second
  within a 16 ms browser frame-p95 budget.
- Make routine transaction work proportional to changed rows and affected tree
  paths, never total local row count.
- Keep `rows` plus `columns` as the effortless React happy path.
- Offer a framework-independent functional API for explicitly creating and
  controlling a local row model.
- Make TypeScript infer row, row-ID, column-ID, cell-value, filter, formatter,
  editor, and aggregate types with little or no annotation.
- Preserve immutable revision roots so a future bounded undo/redo controller can
  retain selected states cheaply.
- Give the renderer windowed indexed access rather than a materialized complete
  row array.
- Maintain all current grouping semantics: multi-level paths, escaped IDs,
  filtering, aggregate modes, sorting, expansion, focus, selection, and custom
  monoid aggregators.
- Leave a clean model boundary for a future remote implementation without
  designing a speculative transport or caching protocol now.

## Non-goals

- Backward compatibility for `snapshot.visibleRows`, grid-owned data mutation,
  or existing React option shapes.
- A public remote datasource, pagination, cursor, cache, loading-row, or server
  query protocol.
- Loading genuinely server-sized datasets into the browser.
- General persistent per-column database indexes for arbitrary future filters
  and sorts.
- Web Worker execution. Custom JavaScript accessors and aggregators must remain
  first-class without serialization restrictions.
- Making an arbitrary new filter, sort, grouping definition, or derivation
  column change sublinear. Those operations may stage a bulk rebuild.

## Selected architecture

Use a persistent indexed local row model on the main thread.

The alternatives were rejected as follows:

- A mutable graph plus patched flat array still pays large array shifts and
  index repair when group-key churn moves rows. It is too risky at 100,000 rows.
- A worker-owned engine isolates the main thread but forces an asynchronous API
  and prevents arbitrary functions from crossing the boundary. That harms the
  JavaScript-first developer experience.

The selected model uses persistent copy-on-write maps and order-statistic trees,
transient per-transaction drafts, mergeable aggregate rollups, immutable
revision roots, and windowed reads. A future worker or remote model can exist
behind the same grid/model ownership boundary without constraining this local
API today.

## Public API and ownership

### React happy path

```tsx
<PretableSurface rows={holdings} columns={columns} getRowId={(row) => row.id} />
```

The surface creates one local row model for its lifetime. Subsequent row props
call its ID-diffing `setRows` path instead of recreating the model.

### Explicit functional path

```ts
const rowModel = createLocalRowModel({
  rows: holdings,
  columns,
  getRowId: (row) => row.id,
});

rowModel.applyTransaction({
  update: [{ id: "h1", changes: { price: 42 } }],
});
```

```tsx
<PretableSurface rowModel={rowModel} />
```

Rows mode and explicit-model mode are mutually exclusive at the type level. In
explicit-model mode, the model is the only source of data and derivation
configuration.

### Functional model contract

The explicit model has one observable state object and one subscription
mechanism. This gives React a correct `useSyncExternalStore` source and gives
headless consumers the same contract:

```ts
interface PretableRowModel<TRow, TRowId, TColumns> {
  getState(): PretableRowModelState<TRow, TRowId, TColumns>;
  subscribe(listener: () => void): () => void;

  setRows(rows: readonly TRow[]): PretableMutationResult<TRowId>;
  applyTransaction(
    transaction: PretableTransaction<TRow, TRowId>,
  ): PretableMutationResult<TRowId>;

  setQuery(query: PretableQueryFor<TColumns>): PretableQueryTransition;
  setGroupExpanded(
    groupId: PretableGroupId,
    expanded: boolean,
  ): PretableMutationResult<TRowId>;

  changesSince(revision: number): PretableChangeSequence<TRowId>;
  distinctValues<TColumnId extends ColumnIdOf<TColumns>>(
    columnId: TColumnId,
    options?: PretableDistinctValueOptions,
  ): PretableDistinctValueQuery<ColumnValueOf<TColumns, TColumnId>>;

  dispose(): void;
}
```

`getState()` returns a referentially stable object until either the committed
snapshot or observable status changes. `subscribe` wakes once after each such
change; listeners call `getState()` and receive no mutable event payload.
Unsubscribing is idempotent.

`PretableRowModelState` contains the current immutable snapshot and status. The
status is a discriminated union:

```ts
type PretableRowModelStatus =
  | { readonly kind: "ready" }
  | {
      readonly kind: "rebuilding";
      readonly transitionId: number;
      readonly completedRows: number;
      readonly totalRows: number;
    }
  | {
      readonly kind: "error";
      readonly transitionId: number;
      readonly error: PretableRowModelError;
    }
  | { readonly kind: "disposed" };
```

`applyTransaction`, `setRows`, and expansion commands are synchronous and
return the committed revision, previous revision, typed issues, and
added/updated/removed/unchanged/ignored counts. Unknown update or removal IDs
are non-fatal issues. Duplicate source IDs, adding an existing ID, cross-list
transaction conflicts, or accessor/aggregator failures throw a structured
`PretableRowModelError` before publication. A no-op returns the unchanged
revision and does not notify.

Expansion results use the same envelope with zero row-mutation counts. They
advance the revision only when the requested expansion state differs.

```ts
interface PretableTransaction<TRow, TRowId> {
  readonly add?: readonly TRow[];
  readonly update?: readonly {
    readonly id: TRowId;
    readonly changes: Partial<TRow>;
  }[];
  readonly remove?: readonly TRowId[];
}

type PretableMutationIssue<TRowId> =
  | { readonly code: "unknown-update-id"; readonly rowId: TRowId }
  | { readonly code: "unknown-remove-id"; readonly rowId: TRowId };

interface PretableMutationResult<TRowId> {
  readonly previousRevision: number;
  readonly revision: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly ignored: number;
  readonly issues: readonly PretableMutationIssue<TRowId>[];
}
```

`setQuery` is the sole global filter/sort/grouping command. It returns a handle
with `id`, `requestedQuery`, `finished`, and `cancel()`. `finished` resolves to
the atomically committed query revision, rejects on failure or cancellation,
and never exposes a partial candidate. Convenience UI actions form a complete
next query and call this command rather than maintaining independent filter,
sort, or grouping state.

`PretableQueryFor<TColumns>` is a deeply readonly value containing typed
`filters`, ordered `sort`, and ordered `rowGroups`. Each entry is a
column-correlated discriminated union: its column ID selects the legal
operator, comparison value, direction, null policy, and grouping options.
Expansion is intentionally absent because it changes the view of the current
group tree rather than compiling a new query plan.

`changesSince(revision)` returns the ordered structural change sets needed to
advance from that revision to the current one. The model retains a small,
bounded change journal independently of historical roots. If the caller is too
far behind, the revision is unknown, or a bulk replacement occurred, it returns
a discriminated `reset` result. Consumers must then rebuild from the current
snapshot. This is the only change-set delivery contract; subscription timing
is never used as data.

```ts
type PretableChangeSequence<TRowId> =
  | {
      readonly kind: "changes";
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly changes: readonly PretableChangeSet<TRowId>[];
    }
  | {
      readonly kind: "reset";
      readonly toRevision: number;
      readonly reason: "unknown-revision" | "journal-evicted" | "bulk-replace";
    };
```

Each `PretableChangeSet` records its parent/current revision and ordered
insert/remove/move/update operations using `PretableVisibleRowRef`; it also
identifies group aggregate/count changes that do not move rows. The journal's
default capacity is implementation-tuned and configurable for diagnostics, but
its eviction must not affect snapshot validity or revision retention.

### Ownership boundary

The row model owns:

- canonical rows and ID lookup;
- derivation-relevant column definitions;
- filters and ordered sorting;
- grouping levels and expansion;
- filtered and all-row group membership;
- aggregates and logical row ordering; and
- immutable revisioned row-model snapshots.

The grid/surface owns:

- viewport and scrolling;
- focus, selection, and editing sessions;
- visual column order, width, and pinning;
- menus, drag state, and rendering; and
- the presentation-specific row-height index.

The grid calls row-model commands for user sort, filter, grouping, and expansion
interactions. It does not duplicate those states.

### Indexed snapshot

The complete `visibleRows` array is removed. A model snapshot captures one
immutable revision root:

```ts
type PretableVisibleRowRef<TRowId> =
  | { readonly kind: "data"; readonly rowId: TRowId }
  | { readonly kind: "group"; readonly groupId: PretableGroupId };

interface PretableRowModelSnapshot<TRow, TRowId, TColumns> {
  readonly revision: number;
  readonly sourceRowCount: number;
  readonly visibleRowCount: number;

  rowAt(index: number): PretableVisibleRow<TRow, TRowId> | undefined;
  range(
    start: number,
    end: number,
  ): readonly PretableVisibleRow<TRow, TRowId>[];
  indexOf(ref: PretableVisibleRowRef<TRowId>): number;

  readonly query: Readonly<PretableQueryFor<TColumns>>;
}
```

All reads from a captured snapshot remain consistent after the live model
advances. Headless consumers can iterate intentionally through indexed reads,
but ordinary observation never materializes every row.

`PretableGroupId` is an opaque generated type, but opacity alone is not relied
on for runtime identity. Every rank lookup, focus target, render key, layout
entry, and structural change uses the discriminated visible-row reference.
Selection and editing accept only data-row IDs; group rows can be focused but
never selected or edited. A string data ID may therefore equal a group's
serialized ID without collision.

## TypeScript design

The typing strategy follows patterns proven in Hashbrown:

- `const` generics preserve literal names;
- opaque generic carriers allow downstream inference;
- overloads preserve correlations between distinct input branches;
- conditional and mapped results are prettified for readable IntelliSense;
- schema-like inference helpers derive public types from a concrete carrier;
- React helpers accept dependencies when stabilizing anonymous functions; and
- positive and negative compile-time fixtures make inference contractual.

Avoid recursive union-to-tuple transformations in frequently instantiated
public grid types. Pretable has 100- and 500-column workloads, so language-server
and declaration-build performance are product requirements.

### Rows and IDs

Rows use `TRow extends object`, not `Record<string, unknown>`, so ordinary domain
interfaces work without index signatures. IDs preserve their public type:

```ts
type PretableRowId = string | number;
```

Factory overloads infer IDs from either a conventional `row.id` or a required
`getRowId`. DOM attributes normalize an ID to a string only at the rendering
boundary.

Transactions separate identity from partial row data:

```ts
interface PretableRowUpdate<TRow, TRowId> {
  id: TRowId;
  changes: Partial<TRow>;
}
```

### Typed columns

```ts
const column = createColumnHelper<Holding>();

const columns = [
  column.accessor("sector", {
    header: "Sector",
    type: "text",
  }),
  column.accessor("quantity", {
    header: "Quantity",
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toLocaleString(),
    formatAggregate: ({ value }) => value?.toLocaleString() ?? "",
  }),
] as const;
```

The concrete column tuple retains its ID union and each column's value type.
Query commands accept only declared IDs. Filter operators and values are
correlated with the accessed value. Built-in aggregators are constrained to
appropriate values. Custom aggregators carry row, input, accumulator, and
output types through aggregate formatters and group-row aggregate records.

Function accessors infer their returned value. A React helper provides explicit
dependency stabilization:

```ts
const columns = usePretableColumns(
  () => [
    column.accessor("marketValue", (row) => row.quantity * fxRate, {
      type: "number",
    }),
  ],
  [fxRate],
);
```

Visual-only column changes do not rebuild the row model. Derivation function
identity changes start a query transition; a development warning explains when
an unstable inline accessor caused it.

### Opaque model inference and overloads

The public model carries row, ID, and column information behind a type-only
unique symbol. `RowOf<TModel>`, `RowIdOf<TModel>`, and `ColumnsOf<TModel>` infer
from that descriptor. The symbol is not a mutable runtime escape hatch.

`usePretable` and `PretableSurface` expose separate rows-mode and model-mode
overloads. Passing both modes is a compile-time error. Model-mode render
callbacks, transactions, focus/selection IDs, and snapshots infer without
repeating generics.

Complex public intersection and mapped types use a local `Prettify` helper so
editor hovers show useful object shapes rather than implementation machinery.

## Compiled query plan

The model compiles active columns and query state into the minimal dependencies
needed per row:

- filter predicates and the current pass result;
- grouping accessors and the current group-key path;
- sort accessors/comparators and the current tuple;
- aggregate accessors and one leaf accumulator per aggregate column; and
- a stable source-order token.

An updated row reevaluates every active dependency for that row. A custom
accessor may read arbitrary row fields, so the engine must not guess which
accessor a partial patch affects. The work remains proportional to changed rows
and active dependencies.

Replacing filters, sort, grouping levels, or derivation-relevant columns creates
a new query plan and stages a bulk rebuild. The model does not maintain general
indexes for every possible future query.

## Persistent internal structures

### Canonical row store

A persistent hash/tree map stores:

```ts
rowId -> {
  row,
  sourceOrder,
  filterPasses,
  groupPath,
  sortKey,
  aggregateLeaves,
}
```

Only changed hash/tree paths are copied. A transaction draft provides temporary
ownership so multiple patches copy each affected branch at most once.

### Group and order tree

Each group node contains:

- stable escaped path ID, depth, column ID, and key value;
- an ordered persistent child-group index or leaf-row index;
- post-filter and total descendant counts;
- visible subtree count, accounting for expansion;
- filtered aggregate rollups;
- all-row aggregate rollups; and
- a stable public group-row object while its observable values are unchanged.

Ordered indexes contain subtree counts, enabling rank and range lookup without
flattening. Leaf rows follow active sort order, with source order as the stable
tie-break. Sibling groups follow the grouping-column comparator and direction.

All rows may remain represented internally even when filtered out. A group is
visible only when it has post-filter descendants. Maintaining both filtered and
all-row summaries preserves `aggregateFilteredRows` without a second full fold.

### Mergeable aggregate trees

Each row produces a leaf accumulator with `init` plus `accumulate`. Internal
aggregate nodes cache `merge(left, right)`.

At the innermost group, row accumulators roll up through the ordered leaf tree.
At higher levels, child-group accumulators roll up through parent trees. One
changed aggregate leaf therefore propagates through logarithmic merge paths.

This is valid for built-in and custom aggregators because `merge` is already
required to be associative, `init` is its identity, and `merge` may not mutate
its inputs. No subtraction or custom inverse API is introduced.

### Indexed visible sequence

Visibility is a counted view over the ordered group tree, not a second flat
array. Expansion state changes visible subtree counts along one path.

- `rowAt(index)` descends counts.
- `range(start, end)` walks only intersecting subtrees.
- `indexOf(ref)` uses cached membership plus rank calculations.
- a flat ungrouped model uses the same ordered-row abstraction without group
  nodes.

## Incremental mutation algorithm

For an existing row update:

1. read its old cached query metadata;
2. merge the typed patch into a new row value;
3. compute new query metadata for that row;
4. update only the affected structures:
   - display-only change: replace the public data-row value;
   - aggregate change: replace aggregate leaves and propagate merges;
   - sort change: remove and reinsert within the current leaf group;
   - filter change: update visible membership and filtered summaries;
   - group-key change: remove the old path, prune empty visible/internal nodes
     when safe, and insert the new path; and
5. stage one new model root.

Adds and removals use the same path operations. Multi-aspect changes share the
same transient draft. A 50-patch transaction publishes one revision and one
subscriber notification.

Repeated updates for the same ID within an update list are coalesced in input
order. The same ID appearing across add/update/remove categories is rejected as
ambiguous before mutation. Adding an existing ID or supplying duplicate source
rows is an atomic error. Unknown update/remove IDs are reported as ignored
issues rather than silently disappearing.

`setRows` performs an unavoidable ID scan. Same-reference rows are reused;
new-reference rows reevaluate active dependencies. Adds, removals, source-order
changes, and updates flow through one bulk transaction draft. High-frequency
producers should use `applyTransaction`; `rows` remains the declarative path.

Expected routine complexity is approximately
`O(changed rows * grouping depth * log(row count))`, with a bounded factor for
active aggregate columns. Viewport range reads are
`O(log(row count) + window size)`.

## Immutable revisions and future undo/redo

Every committed model state has an immutable root containing the row store,
compiled query plan, group/order root, and visible root. A revision contains:

- monotonically increasing ID;
- parent revision ID;
- mutation/query cause metadata; and
- optional restoration metadata.

Transactions build privately and commit atomically. Captured snapshots keep
their root and remain valid after later commits.

The core does not retain unlimited history. By default it holds the current
root; snapshots keep roots alive only while referenced. A future history
controller chooses which user-intent revisions to retain and may ignore,
coalesce, or checkpoint external streaming revisions.

Undo does not make revision numbers decrease. Restoring retained revision 42
from revision 43 creates revision 44 whose roots structurally reuse revision
42 and whose metadata records `restoredFrom: 42`. Redo and branch policy belong
to the history controller.

## Cooperative query transitions

Routine data mutations, expansion changes, and `setRows` diffs commit
synchronously. A global query-plan change over 100,000 rows is staged in bounded
main-thread slices:

```ts
const transition = model.setQuery({ filters, sort, rowGroups });
await transition.finished;
```

The current committed snapshot remains interactive. Status reports `ready`,
`rebuilding`, `error`, or terminal `disposed`. Progress/cancellation does not
create model revisions.

The rebuild captures an immutable row-store root. Concurrent transactions
continue committing to the live model and append to a transition delta journal.
After bulk construction, the journal is replayed incrementally under the new
query plan. The candidate catches up and swaps atomically as one query revision.
A newer query cancels and supersedes the older candidate.

If a staged accessor, comparator, or aggregator throws, the candidate is
discarded, the old query remains active, `transition.finished` rejects with
structured context, and an error-status notification is published without a
false data revision.

## Rendering and incremental layout

Each committed revision describes its change relative to its parent: inserted,
removed, moved, updated, and aggregate/count-changed visible-row references. A
bulk query transition may publish a root replacement instead of an enormous
move list. Consumers that miss retained changes receive a safe reset.

The renderer owns a persistent order-statistic height tree. Its nodes store row
ID, estimated/measured height, subtree count, and subtree total height. It
supports offset-to-index, index-to-offset, measurement changes, structural
changes, and viewport range planning logarithmically. Fixed-height datasets may
use compact uniform-height runs.

On a row-model revision, React:

1. applies the model change set to the layout index;
2. maps the scroll viewport to start/end indexes;
3. requests only that range plus overscan;
4. renders the returned rows; and
5. updates measurements only for changed rendered rows.

Rows moved between groups retain measured height by stable ID. Group rows begin
with the group default. Collapse removes a subtree view without discarding row
measurements.

Full-row scans in rendering, ID indexing, telemetry, selection extent, focus
navigation, parent lookup, and scroll-to-row are replaced with model rank/range
primitives. Grid snapshots contain UI state plus the observed row-model
revision; data-model snapshots are read separately.

For bulk root replacement, the layout reuses cached heights by ID, builds the
new layout cooperatively, preserves an anchor by ID, and swaps data and layout
roots together before paint. If the anchor disappears, it falls back to the
nearest surviving group ancestor or logical neighbor.

## React reconciliation and controlled queries

In rows mode, the surface reconciles rows and derivation columns into its
long-lived model without mutating during render. Visual-only column definitions
may update independently.

Rows mode accepts either no query prop or the paired controlled contract
`query` plus `onQueryChange`. Without the pair, UI query actions call the
internal model's `setQuery`. With the pair, a UI action emits the complete next
query through `onQueryChange` and does not mutate query state; the internal
model transitions only when the new `query` prop arrives. Supplying only one
member of the pair is a type error.

In explicit-model mode, query props and `onQueryChange` are disallowed. UI
query actions call that model's `setQuery` directly. A caller that needs to
approve or persist query changes subscribes to the model or wraps the UI action
at the application boundary; the grid never mirrors model-owned query state.

`usePretable` returns both layers:

```ts
{
  grid,
  rowModel,
  gridSnapshot,
  rowModelSnapshot,
  renderSnapshot,
  status,
}
```

A `useLocalRowModel` convenience hook creates/disposes the same public model as
the framework-independent factory. It does not introduce a React-only engine.

### Editing ownership

The grid owns edit-session UI and validation; committed row data always follows
the ownership mode:

- In rows mode, a successful edit emits a typed `onRowChange` proposal with
  row ID, column ID, previous row, proposed row, and minimal changes. It does
  not mutate the internal row model. The owner accepts by publishing the next
  `rows` prop. Async acceptance keeps the edit in `saving`; rejection returns
  it to an error/editing state.
- In explicit-model mode, a successful edit maps the typed column value to a
  row patch and calls `rowModel.applyTransaction` atomically. An optional async
  `beforeRowChange` hook may validate or persist before that commit. If it
  rejects, the model revision does not advance.

Editable accessor columns must provide a typed reverse mapping when assigning
the accessor value cannot be expressed as `{ [field]: value }`. Read-only
computed columns omit it. Streaming changes and edit proposals are resolved by
the application; the row model does not silently pin edited cells or maintain
a second override map.

### Distinct filter values

The existing filter-menu distinct-value query moves behind the row-model
boundary. It must never make the renderer or menu synchronously scan all rows.
`rowModel.distinctValues(columnId, options)` returns a cancellable query with a
status and `finished` promise. Values retain the column's inferred value type;
presentation formatting remains a column/UI concern.

```ts
interface PretableDistinctValueOptions {
  readonly search?: string;
  readonly start?: number;
  readonly limit?: number;
  readonly population?: "all" | "filtered";
}

interface PretableDistinctValueResult<TValue> {
  readonly values: readonly {
    readonly value: TValue;
    readonly count: number;
  }[];
  readonly totalDistinct: number;
  readonly population: "all" | "filtered";
  readonly rowModelRevision: number;
}

interface PretableDistinctValueQuery<TValue> {
  readonly status: "pending" | "ready" | "error" | "cancelled";
  readonly finished: Promise<PretableDistinctValueResult<TValue>>;
  cancel(): void;
}
```

The first query for a column cooperatively builds a value/count dictionary from
the immutable row-store root, then catches up through the same transaction
journal pattern as a query rebuild. While retained, transactions update the
dictionary incrementally. The cache is bounded and evictable, and its key
includes the derivation accessor/comparator identity. Set-filter columns may
request eager construction; other columns remain lazy. This is a UI dictionary,
not a general filter or sort execution index, and filters continue to use the
compiled per-row predicate path.

The query supports bounded ranges/search rather than returning an unbounded
array. Its result states whether values come from all source rows or the current
post-filter population; the default is all source rows, matching the existing
behavior. Blank-value inclusion and ordering are explicit column options.

## Error and lifecycle behavior

- All synchronous mutations are atomic. On failure, discard the draft, keep the
  revision, and notify nobody.
- Structured errors identify operation, row ID, column ID, and original cause.
- Mutation results report revision and added/updated/removed/unchanged/ignored
  counts.
- `dispose()` is idempotent. Its first call cancels transitions and distinct-
  value work, releases journals/caches, publishes one final `disposed` state to
  current listeners, and then detaches them. `getState()` and previously
  captured immutable snapshots remain readable; later subscriptions return an
  inert unsubscriber. Mutation, query, and distinct-value commands throw a
  structured disposed-model error.
- Query transition cancellation releases candidate roots and delta journals.
- Development builds warn about unstable derivation functions and pathological
  transaction conflicts.
- Internal persistent nodes and transient drafts are not exposed publicly.

## Remote-model seam

The grid depends on indexed snapshot reads, revision subscription, status, and
query/data commands rather than concrete local trees. This is the seam a future
remote model can use.

This project does not decide how a remote model represents unloaded rows,
requests ranges, caches pages, sends server grouping queries, handles latency,
or exposes async mutations. Those choices require their own design. The local
model is optimized aggressively for 100,000 rows; genuinely larger or
continuously server-queried datasets belong to that future execution mode.

## Verification strategy

### Differential oracle

Retain the current pure full-derivation implementation temporarily as a test
oracle. Property-based operation sequences compare it with the incremental
model after every add, update, remove, replacement, query change, group change,
and expansion change.

Cover:

- flat, single-level, and multi-level grouping;
- escaped group keys and group-key churn;
- string data IDs equal to serialized group IDs, proving discriminated lookup;
- stable and changed sort keys;
- filter entry/exit and `aggregateFilteredRows` both ways;
- built-in and custom aggregators;
- group emptying/returning and expansion retention;
- selection/focus reconciliation at the grid boundary; and
- rows-mode edit proposals versus explicit-model edit commits;
- lazy/eager distinct-value dictionaries, eviction, and stream catch-up; and
- concurrent streaming while a query transition catches up.

Assert `rowAt`, `range`, and `indexOf` consistency; one revision/notification
per commit; no revision on failure; immutable old snapshots; and stable identity
for unchanged rows, groups, and aggregate outputs. Contract tests also cover
stable `getState` identity, no-op notification behavior, mutation issue/result
counts, bounded change-journal reset, transition cancellation/disposal, and
controlled-query non-mutation before the next prop arrives.

### Work-sensitive diagnostics

Internal test diagnostics count rows evaluated, group nodes copied, aggregate
nodes merged, order nodes changed, and viewport rows read. Tests assert that a
50-row transaction does not inspect 100,000 rows and that display-only,
aggregate-only, ordering, filter, and group-path updates touch only their
required structures.

### Type gates

Compile-time positive/negative fixtures cover zero-annotation happy-path
inference, string/number IDs, typed accessors, formatters, editors, filters,
aggregates, invalid IDs/operators/values, rows/model mutual exclusion, model-
derived React callbacks, and custom accumulator/output inference.

API Extractor reports are reviewed for readable declarations. Compiler
diagnostics measure 100- and 500-column definitions to guard editor performance.

### Performance gates

Keep the failing 20,000-row artifact as before evidence. Add permanent flat and
grouped controls at:

- the existing 20,000-row S5 scale; and
- a new 100,000-row local-maximum scale.

Both grouped runs use 1,000 patches/second, 50 patches/50 ms, expanded groups,
aggregation, and unchanged random group-key churn. The grouped browser artifact
must satisfy all four:

```text
scroll_frame_p95_ms <= 16
long_tasks_count === 0
scroll_position_drift_px === 0
visible_row_count_drift === 0
```

Also verify engine commit latency, window-sized range cost, bounded cooperative
rebuild slices, responsiveness while rebuilding under a stream, and no live
memory growth proportional to discarded revision count when history retention
is disabled.

## Migration sequence

1. Add tested persistent map, ordered-tree, aggregate-tree, and transient-draft
   primitives.
2. Add the strongly typed `createLocalRowModel` API beside the full-derivation
   oracle.
3. Implement incremental row storage, compiled queries, filtering, sorting,
   grouping, aggregation, and expansion.
4. Add immutable revisions, change sets, cooperative query transitions, and
   delta catch-up.
5. Separate row-model data/query state from grid UI state.
6. Replace full arrays with indexed snapshots and migrate all headless
   consumers.
7. Replace full render/layout scans with viewport range reads and incremental
   height indexes.
8. Migrate React APIs to rows/model overloads, inferred columns, and typed IDs.
9. Migrate editing, selection, focus, clipboard, grouping controls, stream
   adapter, benchmarks, website, and documentation.
10. Pass differential, type, API, repository, 20,000-row, and 100,000-row
    performance gates.
11. Delete the legacy production derivation path and temporary oracle.
12. Resume the paused grouping hero/docs adoption only after the new grouped
    gate passes.

Each migration stage must remain buildable and testable. There is one production
row engine at the end, not a permanent compatibility engine beside the new one.

## Locked decisions

- Persistent indexed main-thread architecture.
- No backward-compatibility constraint.
- `rows` remains the React happy path; explicit functional model creation is
  available.
- The row model owns data and query state; the grid owns UI/presentation state.
- No general persistent filter/sort database indexes.
- Global query changes rebuild cooperatively and swap atomically.
- The local grouped streaming target is 100,000 rows at 1,000 patches/second.
- Revisions are immutable state roots and future undo/redo infrastructure.
- Historical retention is bounded and policy-owned, not automatic for every
  streaming revision.
- No remote public protocol in this project, only a clean model boundary.
- Type inference quality and compiler performance are release gates.
