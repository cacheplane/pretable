import {
  type AutosizeOptions,
  createGrid,
  type PretableColumn,
  type PretableFocusState,
  type PretableGrid,
  type PretableGridOptions,
  type PretableGridSnapshot,
  type PretableRow,
  type PretableSelectionState,
  type PretableSortState,
} from "@pretable/core";
import {
  createDomRenderSnapshot,
  type PlannedColumn,
} from "@pretable-internal/renderer-dom";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

export interface UsePretableOptions<TRow extends PretableRow = PretableRow> {
  autosize?: boolean | AutosizeOptions;
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: PretableGridOptions<TRow>["getRowId"];
}

export interface PretableRenderRow<TRow extends PretableRow = PretableRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

export interface PretableRenderSnapshot<
  TRow extends PretableRow = PretableRow,
> {
  columns: PlannedColumn[];
  rows: PretableRenderRow<TRow>[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}

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

export interface PretableSurfaceState {
  filters?: Record<string, string>;
  focus?: PretableFocusState;
  selection?: PretableSelectionState;
  sort?: PretableSortState | null;
  columnWidths?: Record<string, number>;
  columnOrder?: readonly string[];
  columnPinned?: Record<string, "left" | null>;
}

export interface UsePretableModelOptions<
  TRow extends PretableRow = PretableRow,
> extends UsePretableOptions<TRow> {
  viewportHeight: number;
  viewportWidth?: number;
  overscan?: number;
  state?: PretableSurfaceState | null;
  measuredHeights?: Record<string, number>;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
}

export interface PretableModel<TRow extends PretableRow = PretableRow> {
  grid: PretableGrid<TRow>;
  snapshot: PretableGridSnapshot<TRow>;
  renderSnapshot: PretableRenderSnapshot<TRow>;
  telemetry: PretableTelemetry;
}

export function usePretable<TRow extends PretableRow = PretableRow>({
  autosize,
  columns,
  rows,
  getRowId,
}: UsePretableOptions<TRow>) {
  return useMemo(
    () => createGrid({ columns, rows, getRowId, autosize }),
    [autosize, columns, getRowId, rows],
  );
}

export function usePretableModel<TRow extends PretableRow = PretableRow>({
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
}: UsePretableModelOptions<TRow>): PretableModel<TRow> {
  const grid = usePretable({ autosize, columns, rows, getRowId });

  const lastColumnIdsRef = useRef<readonly string[] | null>(null);
  useLayoutEffect(() => {
    const currentIds = columns.map((c) => c.id);
    const prevIds = lastColumnIdsRef.current;
    if (
      prevIds === null ||
      prevIds.length !== currentIds.length ||
      prevIds.some((id, i) => id !== currentIds[i])
    ) {
      if (prevIds !== null) {
        grid.mergeColumnsFromProps(columns);
      }
      lastColumnIdsRef.current = currentIds;
    }
  }, [columns, grid]);

  // onSelectionChange / onFocusChange callbacks are wired in the surface's
  // event handlers (keyboard, click) directly. This keeps callbacks firing
  // for user-induced changes even when the corresponding slice is controlled
  // — diff-detection here would race the controlled-prop reapply below.
  void onSelectionChange;
  void onFocusChange;

  if (state) {
    if (state.sort !== undefined) {
      grid.setSort(state.sort?.columnId ?? null, state.sort?.direction ?? null);
    }

    if (state.filters !== undefined) {
      grid.replaceFilters(state.filters);
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
      // Apply order by repositioning each column to its position in the
      // requested order. Missing ids are appended at the end (engine
      // contract).
      const targetOrder = state.columnOrder;
      const currentIds = grid.options.columns.map((c) => c.id);
      const targetIds = [
        ...targetOrder.filter((id) => currentIds.includes(id)),
        ...currentIds.filter((id) => !targetOrder.includes(id)),
      ];
      for (let i = 0; i < targetIds.length; i += 1) {
        const id = targetIds[i]!;
        const currentIdx = grid.options.columns.findIndex((c) => c.id === id);
        if (currentIdx !== i && id !== "__pretable_row_select__") {
          grid.moveColumn(id, i);
        }
      }
    }

    if (state.columnPinned !== undefined) {
      const pinned = state.columnPinned;
      for (const [id, value] of Object.entries(pinned)) {
        const column = grid.options.columns.find((c) => c.id === id);
        if (!column) continue;
        const targetPinned = value === "left" ? "left" : null;
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

      if (focus.rowId !== null && focus.columnId !== null) {
        grid.setFocus({ rowId: focus.rowId, columnId: focus.columnId });
      } else {
        grid.setFocus(null);
      }
    }
  }

  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

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

  const renderSnapshot = useMemo<PretableRenderSnapshot<TRow>>(
    () =>
      createDomRenderSnapshot({
        columns: grid.options.columns,
        snapshot,
        scrollTop: snapshot.viewport.scrollTop,
        scrollLeft: snapshot.viewport.scrollLeft,
        viewportHeight,
        viewportWidth,
        overscan,
        measuredHeights,
      }),
    [
      grid.options.columns,
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
