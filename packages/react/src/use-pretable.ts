import {
  type AutosizeOptions,
  type ColumnFilter,
  createGrid,
  type PretableFocusState,
  type PretableGrid,
  type PretableGridOptions,
  type PretableGridSnapshot,
  type PretableGroupRow,
  type PretableRow,
  type PretableSelectionState,
  type PretableSortEntry,
} from "@pretable/core";
import type { PretableColumn } from "./types";
import {
  createDomRenderSnapshot,
  type PlannedColumn,
  type RowMetricsReader,
} from "@pretable-internal/renderer-dom";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * Placement shared by every row of layout-derived render state.
 *
 * @public
 */
export interface PretableRenderRowGeometry {
  id: string;
  /** Index into `snapshot.visibleRows`, which includes group header rows. */
  rowIndex: number;
  top: number;
  height: number;
}

/**
 * One data row of layout-derived render state for use during custom rendering.
 *
 * @public
 */
export interface PretableRenderDataRow<
  TRow extends PretableRow = PretableRow,
> extends PretableRenderRowGeometry {
  kind: "data";
  row: TRow;
}

/**
 * One group header row of layout-derived render state.
 *
 * @public
 */
export interface PretableRenderGroupRow extends PretableRenderRowGeometry {
  kind: "group";
  group: PretableGroupRow;
}

/**
 * One row of layout-derived render state for use during custom rendering.
 * Narrow on `kind` before reading `row`: when the grid is grouped, the windowed
 * rows include group headers alongside data rows.
 *
 * @public
 */
export type PretableRenderRow<TRow extends PretableRow = PretableRow> =
  PretableRenderDataRow<TRow> | PretableRenderGroupRow;

/**
 * Layout-derived render snapshot returned by {@link usePretable}. Drives
 * positioned-cell rendering — every column has a left + width, every visible
 * row has a top + height.
 *
 * @public
 */
export interface PretableRenderSnapshot<
  TRow extends PretableRow = PretableRow,
> {
  columns: PlannedColumn[];
  /**
   * Only the rows inside the current virtualization window. For the geometry
   * of a row outside it, use {@link PretableRenderSnapshot.rowMetrics}.
   */
  rows: PretableRenderRow<TRow>[];
  /**
   * Row offsets and heights for **every** visible row, not just the windowed
   * ones in `rows`. Read it to position or scroll to a row that is not
   * currently rendered. Read-only: the underlying index is owned by the
   * renderer and rebuilt on every layout pass.
   */
  rowMetrics: RowMetricsReader;
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
  /**
   * Total width of the left-pinned column group. The group overlays content at
   * `scrollLeft`, so the horizontally unoccluded band starts at
   * `scrollLeft + pinnedLeftWidth`.
   */
  pinnedLeftWidth: number;
  /**
   * Total width of the right-pinned column group. The band ends at
   * `scrollLeft + viewportWidth - pinnedRightWidth`.
   */
  pinnedRightWidth: number;
}

/**
 * Telemetry numbers about the current render — counts and ranges suitable
 * for status bars, dev panels, or virtualization debugging.
 *
 * @public
 */
export interface PretableTelemetry {
  focusedRowId: string | null;
  rowModelRowCount: number;
  renderedRowCount: number;
  selectedRowId: string | null;
  totalRowCount: number;
  totalHeight: number;
  visibleRowCount: number;
  visibleRowRange: {
    end: number;
    start: number;
  };
}

/**
 * **Input** shape for controlling a {@link PretableSurface} from the outside.
 * Pass the slices you want to control; omit slices you want the grid to own.
 *
 * @public
 */
export interface PretableSurfaceState {
  filters?: Record<string, ColumnFilter>;
  focus?: PretableFocusState;
  selection?: PretableSelectionState;
  sort?: PretableSortEntry[];
  /** Grouping columns, outermost first; `[]` ungroups. */
  rowGroups?: string[];
  columnWidths?: Record<string, number>;
  columnOrder?: readonly string[];
  columnPinned?: Record<string, "left" | "right" | null>;
}

/**
 * Options for the {@link usePretable} hook.
 *
 * @public
 */
export interface UsePretableOptions<TRow extends PretableRow = PretableRow> {
  autosize?: boolean | AutosizeOptions;
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: PretableGridOptions<TRow>["getRowId"];
  viewportHeight: number;
  viewportWidth?: number;
  overscan?: number;
  state?: PretableSurfaceState | null;
  measuredHeights?: Record<string, number>;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
}

/**
 * Output of the {@link usePretable} hook — a stable handle plus the latest
 * snapshot, render layout, and telemetry.
 *
 * @public
 */
export interface PretableModel<TRow extends PretableRow = PretableRow> {
  grid: PretableGrid<TRow>;
  snapshot: PretableGridSnapshot<TRow>;
  renderSnapshot: PretableRenderSnapshot<TRow>;
  telemetry: PretableTelemetry;
}

function controlledFocusExistsInGrid<TRow extends PretableRow>(
  grid: PretableGrid<TRow>,
  focus: PretableFocusState,
): boolean {
  if (focus.rowId === null || focus.columnId === null) {
    return focus.rowId === null && focus.columnId === null;
  }

  const current = grid.getSnapshot();
  return (
    current.visibleRows.some((row) => row.id === focus.rowId) &&
    grid.getColumns().some((column) => column.id === focus.columnId)
  );
}

/**
 * The primary React hook. Creates a grid, applies optional controlled state,
 * and returns the latest snapshot, layout-derived render snapshot, and
 * telemetry. Suitable for custom rendering — `<PretableSurface>` itself is
 * built on top of this hook.
 *
 * @example
 * ```tsx
 * const { grid, snapshot, renderSnapshot, telemetry } = usePretable({
 *   columns,
 *   rows,
 *   viewportHeight: 480,
 * });
 * ```
 *
 * @public
 */
export function usePretable<TRow extends PretableRow = PretableRow>({
  autosize,
  columns,
  rows,
  getRowId,
  viewportHeight,
  viewportWidth,
  overscan = 6,
  state,
  measuredHeights,
  onSelectionChange,
  onFocusChange,
}: UsePretableOptions<TRow>): PretableModel<TRow> {
  // getRowId may be an inline closure that changes identity every render. Wrap
  // it in a stable function so it never forces the grid — and the selection /
  // focus state it holds — to be recreated. Mirrors createSourceRows' default.
  /* eslint-disable react-hooks/refs -- intentional stable wrapper: the inner fn reads ref.current lazily at call time (not during render), giving a stable identity that always calls the latest getRowId. Mirrors HeroGrid.tsx's columns factory. */
  const getRowIdRef = useRef(getRowId);
  getRowIdRef.current = getRowId;
  const stableGetRowId = useRef(
    (row: TRow, index: number): string =>
      getRowIdRef.current?.(row, index) ?? String(index),
  ).current;
  /* eslint-enable react-hooks/refs */

  // Create the grid once. Both `rows` and `columns` are reconciled in place
  // (grid.setRows / grid.mergeColumnsFromProps, below) rather than by recreating
  // it, so sort, filters, selection, focus, column layout, and an in-flight edit
  // survive high-frequency row updates (streaming) — and survive an inline
  // `columns={[...]}`, which is a new identity on every render.
  const grid = useMemo(
    () => createGrid({ columns, rows, getRowId: stableGetRowId, autosize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows reconciled via grid.setRows, columns via mergeColumnsFromProps, getRowId via the stable wrapper above
    [autosize, stableGetRowId],
  );

  // Reconcile streamed row updates into the existing grid (instead of recreating
  // it). Runs in a layout effect — before paint, so there's no visible stale
  // frame — rather than during render, which would emit to the external store
  // mid-render and trip React's "update during render" guard.
  const lastRowsRef = useRef(rows);
  useLayoutEffect(() => {
    if (lastRowsRef.current !== rows) {
      lastRowsRef.current = rows;
      grid.setRows(rows);
    }
  }, [grid, rows]);

  // Merge on every identity change, not only when the set of ids changes: a
  // column's header, width, or accessor can change while the ids stay put.
  // mergeColumnsFromProps only wakes subscribers when something observable
  // moved, so this stays quiet for an inline array that is merely re-created.
  const lastColumnsRef = useRef(columns);
  useLayoutEffect(() => {
    if (lastColumnsRef.current !== columns) {
      lastColumnsRef.current = columns;
      grid.mergeColumnsFromProps(columns);
    }
  }, [columns, grid]);

  // onSelectionChange / onFocusChange callbacks are wired in the surface's
  // event handlers (keyboard, click) directly. This keeps callbacks firing
  // for user-induced changes even when the corresponding slice is controlled
  // — diff-detection here would race the controlled-prop reapply below.
  void onSelectionChange;
  void onFocusChange;

  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  // Apply controlled state in a layout effect rather than during render: the
  // grid mutators emit to the external store synchronously, and emitting while
  // rendering trips React's "Cannot update a component while rendering a
  // different component" warning (see useSyncExternalStore). Running it post-
  // commit (but before paint) keeps the controlled value authoritative without
  // the during-render emit.
  //
  // The effect depends on `snapshot` so it re-runs after *internal* grid events
  // (keyboard, click) as well as prop changes: when an internal event tries to
  // change a controlled slice and the consumer ignores the callback, the engine
  // has diverged from the prop, and this re-assert forces it back. Every grid
  // mutator self-guards against equal values (no emit when unchanged), so the
  // effect converges — the re-assert after our own emit is a no-op — and never
  // loops.
  useLayoutEffect(() => {
    if (!state) {
      return;
    }

    if (state.sort !== undefined) {
      grid.replaceSort(state.sort);
    }

    if (state.filters !== undefined) {
      grid.replaceFilters(state.filters);
    }

    // Mirrors the `sort` slice above: `setRowGroups` is change-guarded, so
    // re-asserting an unchanged array is a silent no-op and the effect converges.
    if (state.rowGroups !== undefined) {
      grid.setRowGroups(state.rowGroups);
    }

    if (state.columnWidths !== undefined) {
      const widths = state.columnWidths;
      for (const column of grid.options.columns) {
        const next = widths[column.id];
        if (next !== undefined && next !== column.widthPx) {
          grid.setColumnWidth(column.id, next);
        }
      }
    }

    if (state.columnOrder !== undefined) {
      // One commit, not a replay of per-column moves. `moveColumn` derives a
      // column's pin from the region it lands in, so replaying an order as N
      // moves would flap pin state through the transient arrays in between —
      // and against a controlled `columnOrder` that disagrees with the
      // controlled `columnPinned` below, that flapping never settles: the
      // order pass unpins, the pin pass re-pins and repositions, the snapshot
      // changes, and this effect runs again.
      //
      // `setColumnOrder` never touches pin state, so the two passes converge:
      // this one groups by the current pins, the pin pass corrects them, and
      // the next run is a no-op.
      grid.setColumnOrder(state.columnOrder);
    }

    if (state.columnPinned !== undefined) {
      const pinned = state.columnPinned;
      for (const [id, value] of Object.entries(pinned)) {
        const column = grid.options.columns.find((c) => c.id === id);
        if (!column) continue;
        const targetPinned = value ?? null;
        const currentPinned = column.pinned ?? null;
        if (currentPinned !== targetPinned) {
          grid.setColumnPinned(id, targetPinned);
        }
      }
    }

    if (state.selection !== undefined) {
      grid.setSelection(state.selection);
    }

    if (state.focus !== undefined) {
      const focus = state.focus;

      if (focus.rowId === null || focus.columnId === null) {
        grid.setFocus(null);
      } else if (controlledFocusExistsInGrid(grid, focus)) {
        // Row grouping, filtering, and streamed row replacement can repair the
        // engine focus earlier in this same layout pass. Do not overwrite that
        // repair with a controlled address that disappeared from the derived
        // row/column model.
        grid.setFocus({ rowId: focus.rowId, columnId: focus.columnId });
      }
    }
    // `snapshot` is an intentional dependency: it makes the effect re-assert the
    // controlled value after internal grid mutations, not just prop changes.
  }, [grid, state, snapshot]);

  useLayoutEffect(() => {
    if (
      snapshot.viewport.height === viewportHeight &&
      snapshot.viewport.width === (viewportWidth ?? 0)
    ) {
      return;
    }

    grid.setViewport({
      scrollTop: snapshot.viewport.scrollTop,
      scrollLeft: snapshot.viewport.scrollLeft,
      height: viewportHeight,
      width: viewportWidth ?? 0,
    });
  }, [
    grid,
    snapshot.viewport.height,
    snapshot.viewport.width,
    snapshot.viewport.scrollTop,
    snapshot.viewport.scrollLeft,
    viewportHeight,
    viewportWidth,
  ]);

  // The DRAWN column list, not `options.columns`: while grouped it leads with
  // the derived group column and drops the grouped ones, and this is what the
  // renderer plans from — so nothing else in React can see the group column
  // until this read changes. Ungrouped the two are the same array by identity,
  // so no non-grouping grid re-plans.
  const drawnColumns = grid.getColumns();
  const renderSnapshot = useMemo<PretableRenderSnapshot<TRow>>(
    () =>
      createDomRenderSnapshot({
        columns: [...drawnColumns],
        snapshot,
        scrollTop: snapshot.viewport.scrollTop,
        scrollLeft: snapshot.viewport.scrollLeft,
        viewportHeight,
        viewportWidth,
        overscan,
        measuredHeights,
      }),
    [
      drawnColumns,
      measuredHeights,
      overscan,
      snapshot,
      viewportHeight,
      viewportWidth,
    ],
  );
  const telemetry = useMemo<PretableTelemetry>(() => {
    const viewportBottom =
      snapshot.viewport.scrollTop +
      Math.max(snapshot.viewport.height, viewportHeight);
    const viewportRows = renderSnapshot.rows.filter((row) => {
      const rowBottom = row.top + row.height;

      return (
        row.top < viewportBottom && rowBottom > snapshot.viewport.scrollTop
      );
    });
    const firstVisibleRow = viewportRows[0];
    const lastVisibleRow = viewportRows[viewportRows.length - 1];

    return {
      focusedRowId: snapshot.focus.rowId,
      rowModelRowCount: snapshot.visibleRows.length,
      renderedRowCount: renderSnapshot.rows.length,
      selectedRowId: snapshot.selection.ranges[0]?.startRowId ?? null,
      totalRowCount: snapshot.totalRowCount,
      totalHeight: renderSnapshot.totalHeight,
      visibleRowCount: viewportRows.length,
      visibleRowRange:
        firstVisibleRow && lastVisibleRow
          ? {
              start: firstVisibleRow.rowIndex,
              end: lastVisibleRow.rowIndex + 1,
            }
          : {
              start: 0,
              end: 0,
            },
    };
  }, [
    renderSnapshot.rows,
    renderSnapshot.totalHeight,
    snapshot.focus.rowId,
    snapshot.visibleRows.length,
    snapshot.selection.ranges,
    snapshot.totalRowCount,
    snapshot.viewport.height,
    snapshot.viewport.scrollTop,
    viewportHeight,
  ]);

  return {
    grid,
    snapshot,
    renderSnapshot,
    telemetry,
  };
}
