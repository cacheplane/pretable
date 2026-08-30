import { useEffect, useMemo, useRef, useState } from "react";
import {
  aggregationFns,
  columnFilteringFeature,
  columnGroupingFeature,
  columnPinningFeature,
  columnSizingFeature,
  createExpandedRowModel,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  filterFns,
  flexRender,
  rowExpandingFeature,
  rowAggregationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";
import { assertComparatorWrappedScaleIsSmoke } from "./comparator-wrapped-scale-rule";
import type { BenchInteractionPlan } from "./interaction-plan";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;
const OVERSCAN = 4;

// `columnPinningFeature` owns the pinning state; `columnSizingFeature` owns
// `column.getStart()`, which is where the sticky offset comes from. Both are
// needed for S2/S3/S7's `pinned_left` (#413), and both are registered
// unconditionally because `tableFeatures` is module scope — a scenario that
// pins nothing simply leaves `columnPinning.start` empty, and `getIsPinned()`
// returns false for every column, which is the pre-#413 render exactly.
// Grouping is registered the same way pinning is (#413): unconditionally at
// module scope, gated entirely by STATE. A scenario whose plan asks for no
// `rowGroups` leaves `grouping` empty, the grouped and expanded row models
// pass rows through untouched, and the render is byte-identical to before —
// the negative arm of the grouping test pins that. TanStack Table v9 ships
// all of this in the free package (`features/column-grouping`,
// `features/row-expanding`, `features/row-aggregation` in the installed
// 9.1.2); row grouping is only PAID in AG Grid (Enterprise) and MUI
// (Premium).
const tanstackFeatures = tableFeatures({
  columnFilteringFeature,
  columnGroupingFeature,
  columnPinningFeature,
  columnSizingFeature,
  rowExpandingFeature,
  rowAggregationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  groupedRowModel: createGroupedRowModel(),
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  filterFns,
  sortFns,
  aggregationFns,
});

/** TanStack's `ExpandedState` shape, named locally: `true` = all expanded. */
type TanstackExpandedState = true | Record<string, boolean>;

export interface TanstackAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  /**
   * Publishes the group-expand trigger (#478): `collapse(groupKey)` collapses
   * the top-level group whose grouping value equals `groupKey`. The measured
   * window calls this once; which key to collapse is the PLAN's contract
   * (`collapsedGroupKey`), the adapter only resolves key -> row.
   */
  onGroupToggleReady?: (collapse: (groupKey: string) => void) => void;
  /**
   * Accepted for harness uniformity but never invoked: TanStack Table is
   * headless and exposes no autosize API. The bench-runner returns
   * `unsupported` for autosize on tanstack before the adapter ever mounts.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  runKey: number;
  scriptName?: string;
  interactionPlan?: BenchInteractionPlan | null;
}

function toColumnDef(
  column: ScenarioColumn,
  scriptName: string | undefined,
  interactionMode: BenchInteractionPlan["mode"] | null,
  sampleRow: ScenarioRow | undefined,
): ColumnDef<typeof tanstackFeatures, ScenarioRow> {
  const def: ColumnDef<typeof tanstackFeatures, ScenarioRow> = {
    id: column.id,
    accessorKey: column.id,
    header: column.header ?? column.id,
    enableSorting: true,
    enableColumnFilter: true,
    // Every numeric column aggregates, mirroring pretable's
    // `applyGroupAggregates` ("avg" there, `mean` here — the same fold): the
    // grouping scripts deliberately cost the aggregation stage, and a
    // comparator that groups without aggregating measures less work than the
    // grid it is compared against. Inert until `grouping` state is non-empty,
    // so no other scenario moves.
    ...(sampleRow !== undefined && typeof sampleRow[column.id] === "number"
      ? { aggregationFn: "mean" as const }
      : {}),
    // TanStack's default filterFn is "auto" which maps to includesString
    // for strings. filter-metadata uses equals semantics in the bench
    // plan (see interaction-plan.ts METADATA_FILTER), so set
    // equalsString explicitly when the plan is in that mode.
    filterFn: interactionMode === "filter-metadata" ? "equalsString" : "auto",
    // TanStack's own width, kept in step with the `gridTemplateColumns` track
    // below. Without it `columnSizingFeature` falls back to its 150px default
    // and `column.getStart()` — the sticky offset for every pinned column
    // after the first — would be computed from widths the grid never draws.
    size: column.widthPx ?? 140,
  };

  if (scriptName === "scroll-with-format") {
    def.cell = (info) => {
      const value = info.getValue();
      return Array.isArray(value) ? value.join(", ") : String(value ?? "");
    };
  } else if (scriptName === "scroll-with-render") {
    def.cell = (info) => (
      <span data-bench-render="cheap">{String(info.getValue() ?? "")}</span>
    );
  } else if (scriptName === "scroll-with-heavy-render") {
    def.cell = (info) => (
      <span data-bench-render="heavy" className="bench-status-badge">
        <span className="bench-badge-dot" aria-hidden />
        <span>{String(info.getValue() ?? "")}</span>
      </span>
    );
  }

  return def;
}

/**
 * The sticky half of column pinning, which TanStack does not do for you.
 *
 * The library is headless: `columnPinningFeature` decides WHICH columns are
 * pinned and `columnSizingFeature` supplies the offset, but nothing in either
 * emits CSS. Every TanStack app pinning a column writes this itself, so the
 * benchmark writing it is faithful rather than a harness shortcut.
 *
 * An opaque background is not decoration — without it the scrolling cells
 * pass visibly UNDER the pinned ones, since a sticky element is still in flow
 * and paints nothing behind itself. `zIndex` puts the pinned cell above the
 * cells it overlaps in paint order for the same reason. Both are what ag-grid
 * and pretable get from their own pinned containers.
 *
 * Returns an empty object for an unpinned column, so a scenario with no
 * `pinned_left` produces exactly the style object it produced before #413 —
 * that, not the positive case, is the property the negative test pins.
 */
function stickyCellStyle(
  pinned: false | "start" | "end",
  startPx: number,
): React.CSSProperties {
  if (pinned !== "start") return {};
  return {
    position: "sticky",
    left: startPx,
    zIndex: 1,
    background: "rgb(255 255 255)",
  };
}

export function TanstackAdapter({
  dataset,
  onUpdateApiReady,
  onGroupToggleReady,
  runKey,
  scriptName,
  interactionPlan,
}: TanstackAdapterProps) {
  // Before any hook, so a jsdom test that breaks the wrapped-scale rule is
  // refused rather than paying `measureElement`'s measurement cost.
  assertComparatorWrappedScaleIsSmoke("tanstack", dataset);

  const viewportRef = useRef<HTMLDivElement>(null);
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);

  useEffect(() => {
    onUpdateApiReadyRef.current = onUpdateApiReady;
  }, [onUpdateApiReady]);

  const onGroupToggleReadyRef = useRef(onGroupToggleReady);

  useEffect(() => {
    onGroupToggleReadyRef.current = onGroupToggleReady;
  }, [onGroupToggleReady]);

  const [data, setData] = useState<ScenarioRow[]>(() => dataset.rows.slice());
  const [sorting, setSorting] = useState<SortingState>([]);
  // `true` = everything open, which is the grouped SETUP state the plan's
  // `resultRowCount` arithmetic describes. React state rather than a literal
  // in `state:` because the group-expand trigger flows through
  // `row.toggleExpanded(false)`, and a controlled value with no change
  // handler would swallow that toggle silently (#478).
  const [expanded, setExpanded] = useState<TanstackExpandedState>(true);

  useEffect(() => {
    setData(dataset.rows.slice());
    setSorting([]);
    setExpanded(true);
  }, [dataset.rows, runKey]);

  const interactionMode = interactionPlan?.mode ?? null;
  const columns = useMemo(
    () =>
      dataset.columns.map((c) =>
        toColumnDef(c, scriptName, interactionMode, dataset.rows[0]),
      ),
    [dataset.columns, scriptName, interactionMode, dataset.rows],
  );

  // The scenario's `pinned_left` columns, in dataset order. Empty for every
  // scenario that pins nothing, which leaves `getIsPinned()` false everywhere
  // and the render byte-identical to before #413.
  const pinnedColumnIds = useMemo(
    () => dataset.columns.filter((c) => c.pinned === "left").map((c) => c.id),
    [dataset.columns],
  );

  // The `group` script's trigger IS the plan arriving (bench-app sets the
  // interaction-plan override inside the measured window), so grouping is
  // derived state: plan present with rowGroups -> grouped, otherwise not.
  // `expanded: true` keeps every group open, which is the state the plan's
  // `resultRowCount` arithmetic (leaves + one group row per key) describes.
  const grouping = useMemo(
    () =>
      interactionPlan?.mode === "group" ||
      interactionPlan?.mode === "group-expand"
        ? [...interactionPlan.rowGroups]
        : [],
    [interactionPlan],
  );

  const table = useTable({
    features: tanstackFeatures,
    data,
    columns,
    // `columnPinning` is held in `state`, not `initialState`, for the same
    // reason `sorting` is: `runKey` remounts the adapter per run and the pinned
    // set is derived from the dataset, so it must follow a dataset swap rather
    // than latch whatever the first render saw.
    state: {
      sorting,
      columnPinning: { start: pinnedColumnIds, end: [] },
      grouping,
      expanded,
    },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    // Without this the row-expanding feature schedules a resetExpanded (to
    // `{}` = all collapsed) whenever data or grouping changes — which is
    // exactly what the mount does. That reset used to be swallowed by the
    // controlled `expanded: true` literal; now that the state is live it
    // would land, and every grouped run would start collapsed.
    autoResetExpanded: false,
    getRowId: (row) => String(row.id),
  });

  // useTable returns a fresh Table object each render. Mirror the
  // apiRef pattern from ag-grid/mui by syncing the latest table instance
  // into a ref so the interaction useEffect can call setSorting /
  // setColumnFilters from outside the render path.
  const tableRef = useRef<Table<typeof tanstackFeatures, ScenarioRow> | null>(
    table,
  );
  tableRef.current = table;

  useEffect(() => {
    const t = tableRef.current;
    if (!t || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort.length > 0) {
      // Entry-list order maps 1:1 onto TanStack's SortingState array —
      // index = priority in both models.
      t.setSorting(
        interactionPlan.sort.map((entry) => ({
          id: entry.columnId,
          desc: entry.direction === "desc",
        })),
      );
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text" ||
      interactionPlan.mode === "filter-keystrokes"
    ) {
      const filters = Object.entries(interactionPlan.filters).map(
        ([id, filter]) => ({ id, value: filter.value }),
      );
      t.setColumnFilters(filters);
    }
  }, [interactionPlan, runKey]);

  useEffect(() => {
    const apply: ApplyBenchUpdates = (patches) => {
      setData((prev) => {
        const map = new Map(prev.map((r) => [String(r.id), r] as const));
        for (const patch of patches) {
          const id = String((patch as { id: unknown }).id);
          const existing = map.get(id);
          if (existing) map.set(id, { ...existing, ...(patch as ScenarioRow) });
        }
        return Array.from(map.values());
      });
    };
    onUpdateApiReadyRef.current?.(apply);
  }, [runKey]);

  useEffect(() => {
    onGroupToggleReadyRef.current?.((groupKey) => {
      const t = tableRef.current;
      if (!t) return;
      // Sorted-first is the CALLER's contract (the plan names the key); here
      // we only resolve key -> row. Top-level grouped rows all report
      // getIsGrouped(), and their groupingValue is the grouping column's
      // value for that group.
      const target = t
        .getRowModel()
        .rows.find(
          (row) => row.getIsGrouped() && String(row.groupingValue) === groupKey,
        );
      target?.toggleExpanded(false);
    });
  }, [runKey]);

  // Scenario S2 ("wrap-auto-height") ships `wrapped_columns: 3` and
  // `row_height_mode: "variable"`; every column carries a `wrap` flag
  // (packages/scenario-data). Honouring it is what makes the S2 comparison
  // mean anything: with a fixed row height and `white-space: nowrap` this
  // adapter was not doing wrapped variable-height layout at all, so the
  // pretable-vs-tanstack S2 numbers compared two different workloads.
  //
  // Scenarios with `wrapped_columns: 0` (S1 and friends) take the exact
  // fixed-height path they took before: no measurement, no ref, same styles.
  const wrappedColumnIds = useMemo(
    () =>
      new Set(dataset.columns.filter((c) => c.wrap === true).map((c) => c.id)),
    [dataset.columns],
  );
  const hasWrappedColumns = wrappedColumnIds.size > 0;

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    // Pre-measurement estimate only. Once a row is measured, the virtualizer
    // replaces this with the real height (wrapped scenarios only — nothing
    // is measured when no column wraps, so the estimate IS the height).
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // `measureElement` resolves a row's index by reading an attribute off the
    // measured node (`indexFromElement` -> `options.indexAttribute`), and the
    // default is `data-index` — which this adapter does not emit. Rather than
    // emitting a second, redundant index attribute alongside `data-row-index`
    // (two sources of truth that can silently diverge, and a warning-only
    // failure mode if the wrong one is dropped), point the virtualizer at the
    // attribute the adapter already publishes. bench-runtime.ts reads
    // `rowIndexAttribute: "data-row-index"` for tanstack and is untouched.
    indexAttribute: "data-row-index",
  });

  const totalSize = virtualizer.getTotalSize();
  const virtualRows = virtualizer.getVirtualItems();
  const totalWidth = dataset.columns.reduce(
    (sum, c) => sum + (c.widthPx ?? 140),
    0,
  );
  const gridTemplateColumns = dataset.columns
    .map((c) => `${c.widthPx ?? 140}px`)
    .join(" ");

  return (
    <section
      aria-label="TanStack Table adapter"
      data-benchmark-adapter="tanstack"
      // `rows` is the post-filter, post-sort row model (table.getRowModel()),
      // so this reflects the count the grid actually displays after an
      // interaction. `data` is the full unfiltered dataset (always 3000).
      data-bench-result-row-count={String(rows.length)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>TanStack Table v9</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {data.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div
        key={runKey}
        ref={viewportRef}
        data-pretable-bench-tanstack-viewport=""
        className="adapter-surface"
        style={{
          height: VIEWPORT_HEIGHT,
          minWidth: 720,
          overflow: "auto",
          position: "relative",
        }}
      >
        <div
          role="table"
          style={{
            display: "grid",
            gridTemplateColumns,
            minWidth: totalWidth,
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <div
              key={headerGroup.id}
              role="row"
              style={{
                display: "contents",
              }}
            >
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                // A pinned header must travel with its pinned body cells. Left
                // unsticky it scrolls away from the column it names, which is
                // both wrong and — because the header row and the body are
                // separate grids here — invisible to any test that only checks
                // the cells.
                const pinned = header.column.getIsPinned();
                const sticky = stickyCellStyle(
                  pinned,
                  pinned === "start" ? header.column.getStart("start") : 0,
                );
                return (
                  <button
                    key={header.id}
                    type="button"
                    role="columnheader"
                    data-column-id={header.column.id}
                    onClick={
                      canSort
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid rgb(229 233 237)",
                      background: "transparent",
                      font: "inherit",
                      cursor: canSort ? "pointer" : "default",
                      ...sticky,
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div
          style={{
            height: totalSize,
            minWidth: totalWidth,
            position: "relative",
          }}
        >
          {virtualRows.map((vr) => {
            const row = rows[vr.index];
            const isGroupRow = row.getIsGrouped();
            return (
              <div
                key={row.id}
                // Measurement is opt-in per scenario. Attaching this
                // unconditionally would switch every fixed-height scenario
                // onto the dynamic-measurement path and move S1's numbers.
                ref={hasWrappedColumns ? virtualizer.measureElement : undefined}
                data-tanstack-row=""
                // Group rows are rows to the harness — same id/index
                // attributes, so the settle signature and the row walk treat
                // them exactly as pretable's `data-pretable-group-row` rows
                // are treated by its profile.
                {...(isGroupRow ? { "data-tanstack-group-row": "" } : {})}
                data-row-id={row.id}
                data-row-index={String(vr.index)}
                style={{
                  position: "absolute",
                  top: vr.start,
                  left: 0,
                  width: totalWidth,
                  // No fixed height when a column wraps: the row's height has
                  // to fall out of its content for the measurement above to
                  // report anything but ROW_HEIGHT.
                  ...(hasWrappedColumns ? null : { height: ROW_HEIGHT }),
                  display: "grid",
                  gridTemplateColumns,
                }}
              >
                {row.getAllCells().map((cell) => {
                  // Per column, not per row: an unwrapped column inside a
                  // wrapped scenario still clips, which is what pretable does
                  // (packages/react/src/pretable-surface.tsx — `column.wrap`
                  // picks between `pre-wrap`/`anywhere` and `nowrap`). The
                  // wrapped branch mirrors that text model so the two grids
                  // lay the same string out under the same rules.
                  const wraps = wrappedColumnIds.has(cell.column.id);
                  // A group row's cells: the grouped column shows the key and
                  // member count; aggregated columns READ their value, which
                  // is what forces TanStack's lazy aggregation to actually
                  // compute inside the measured window — pretable's
                  // `formatAggregate` renders the same way. Everything else
                  // is blank, as in any grouped grid.
                  if (isGroupRow) {
                    const grouped = cell.getIsGrouped();
                    const aggregated =
                      !grouped && cell.column.columnDef.aggregationFn != null;
                    return (
                      <div
                        key={cell.id}
                        data-tanstack-cell=""
                        data-column-id={cell.column.id}
                        style={{
                          padding: "8px 10px",
                          fontWeight: grouped ? 700 : 400,
                          borderRight: "1px solid rgb(229 233 237)",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {grouped
                          ? `${String(cell.getValue() ?? "")} (${row.subRows.length})`
                          : aggregated
                            ? String(cell.getValue() ?? "")
                            : ""}
                      </div>
                    );
                  }
                  // Read off TanStack rather than off the dataset: the feature
                  // owns the state, and `getStart("start")` is the running sum
                  // of the pinned widths before this column. See
                  // `stickyCellStyle`.
                  const pinned = cell.column.getIsPinned();
                  return (
                    <div
                      key={cell.id}
                      data-tanstack-cell=""
                      data-column-id={cell.column.id}
                      style={{
                        padding: "8px 10px",
                        borderRight: "1px solid rgb(229 233 237)",
                        ...(wraps
                          ? {
                              overflowWrap: "anywhere",
                              whiteSpace: "pre-wrap",
                            }
                          : { overflow: "hidden", whiteSpace: "nowrap" }),
                        ...stickyCellStyle(
                          pinned,
                          pinned === "start"
                            ? cell.column.getStart("start")
                            : 0,
                        ),
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
