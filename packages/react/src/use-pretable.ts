import {
  type AutosizeOptions,
  createGrid,
  type PretableColumn,
  type PretableGrid,
  type PretableGridOptions,
  type PretableGridSnapshot,
  type PretableRow,
  type PretableSortDirection,
} from "@pretable/core";
import {
  createDomRenderSnapshot,
  type PlannedColumn,
} from "@pretable-internal/renderer-dom";
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

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

export interface PretableInteractionOverrides {
  filters?: Record<string, string>;
  focusedRowId?: string | null;
  selectedRowId?: string | null;
  sort?: { columnId: string; direction: PretableSortDirection } | null;
}

export interface UsePretableModelOptions<
  TRow extends PretableRow = PretableRow,
> extends UsePretableOptions<TRow> {
  viewportHeight: number;
  viewportWidth?: number;
  overscan?: number;
  interactionOverrides?: PretableInteractionOverrides | null;
  measuredHeights?: Record<string, number>;
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
  interactionOverrides,
  measuredHeights,
}: UsePretableModelOptions<TRow>): PretableModel<TRow> {
  const grid = usePretable({ autosize, columns, rows, getRowId });

  if (interactionOverrides) {
    grid.setSort(
      interactionOverrides.sort?.columnId ?? null,
      interactionOverrides.sort?.direction ?? null,
    );
    grid.replaceFilters(interactionOverrides.filters ?? {});

    if (interactionOverrides.focusedRowId !== undefined) {
      const firstColumnId = columns[0]?.id ?? null;
      grid.setFocus(
        interactionOverrides.focusedRowId
          ? { rowId: interactionOverrides.focusedRowId, columnId: firstColumnId }
          : null,
      );
    }

    if (interactionOverrides.selectedRowId !== undefined) {
      const selectedRowId = interactionOverrides.selectedRowId;
      const firstColumn = columns[0];
      const lastColumn = columns[columns.length - 1];

      if (selectedRowId === null || !firstColumn || !lastColumn) {
        grid.setSelection({ ranges: [], anchor: null });
      } else {
        grid.setSelection({
          ranges: [
            {
              startRowId: selectedRowId,
              endRowId: selectedRowId,
              startColumnId: firstColumn.id,
              endColumnId: lastColumn.id,
            },
          ],
          anchor: { rowId: selectedRowId, columnId: firstColumn.id },
        });
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
