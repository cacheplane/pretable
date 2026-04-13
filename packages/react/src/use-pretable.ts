import {
  createGrid,
  type PretableColumn,
  type PretableGrid,
  type PretableGridOptions,
  type PretableGridSnapshot,
  type PretableRow,
} from "@pretable/core";
import { createDomRenderSnapshot } from "@pretable-internal/renderer-dom";
import { useEffect, useMemo, useSyncExternalStore } from "react";

export interface UsePretableOptions<TRow extends PretableRow = PretableRow> {
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
  rows: PretableRenderRow<TRow>[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}

export interface UsePretableModelOptions<
  TRow extends PretableRow = PretableRow,
> extends UsePretableOptions<TRow> {
  viewportHeight: number;
  overscan?: number;
  measuredHeights?: Record<string, number>;
}

export interface PretableModel<TRow extends PretableRow = PretableRow> {
  grid: PretableGrid<TRow>;
  snapshot: PretableGridSnapshot<TRow>;
  renderSnapshot: PretableRenderSnapshot<TRow>;
}

export function usePretable<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
  getRowId,
}: UsePretableOptions<TRow>) {
  return useMemo(
    () => createGrid({ columns, rows, getRowId }),
    [columns, getRowId, rows],
  );
}

export function usePretableModel<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
  getRowId,
  viewportHeight,
  overscan = 6,
  measuredHeights,
}: UsePretableModelOptions<TRow>): PretableModel<TRow> {
  const grid = usePretable({ columns, rows, getRowId });
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  useEffect(() => {
    if (snapshot.viewport.height === viewportHeight) {
      return;
    }

    grid.setViewport({
      scrollTop: snapshot.viewport.scrollTop,
      height: viewportHeight,
    });
  }, [grid, snapshot.viewport.height, snapshot.viewport.scrollTop, viewportHeight]);

  const renderSnapshot = useMemo<PretableRenderSnapshot<TRow>>(
    () =>
      createDomRenderSnapshot({
        columns: grid.options.columns,
        snapshot,
        scrollTop: snapshot.viewport.scrollTop,
        viewportHeight,
        overscan,
        measuredHeights,
      }),
    [
      grid.options.columns,
      measuredHeights,
      overscan,
      snapshot,
      viewportHeight,
    ],
  );

  return {
    grid,
    snapshot,
    renderSnapshot,
  };
}
