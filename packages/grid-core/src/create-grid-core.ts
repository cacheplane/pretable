import {
  createSourceRows,
  deriveVisibleRows,
} from "./derived-rows";
import type {
  GridCoreFocusState,
  GridCoreOptions,
  GridCoreRow,
  GridCoreSelectionState,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreSortState,
  GridCoreStore,
  GridCoreViewportState,
} from "./types";

export function createGridCore<TRow extends GridCoreRow>(
  options: GridCoreOptions<TRow>,
): GridCoreStore<TRow> {
  const listeners = new Set<() => void>();
  const sourceRows = createSourceRows(options);
  let sort: GridCoreSortState = { columnId: null, direction: null };
  let filters: Record<string, string> = {};
  let selection: GridCoreSelectionState = { rowIds: [], anchorRowId: null };
  let focus: GridCoreFocusState = { rowId: null, columnId: null };
  let viewport: GridCoreViewportState = { scrollTop: 0, height: 0 };

  return {
    options,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
    setSort(columnId: string | null, direction: GridCoreSortDirection) {
      sort = { columnId, direction };
      emit();
    },
    setFilter(columnId: string, value: string) {
      const nextFilters = { ...filters };
      const trimmed = value.trim();

      if (trimmed) {
        nextFilters[columnId] = trimmed;
      } else {
        delete nextFilters[columnId];
      }

      filters = nextFilters;
      emit();
    },
    clearFilters() {
      filters = {};
      emit();
    },
    selectRow(rowId: string | null) {
      selection = rowId
        ? { rowIds: [rowId], anchorRowId: rowId }
        : { rowIds: [], anchorRowId: null };
      emit();
    },
    setFocus(rowId: string | null, columnId: string | null) {
      focus = { rowId, columnId };
      emit();
    },
    moveFocus(delta: number) {
      const snapshot = getSnapshot();
      const currentIndex = snapshot.visibleRows.findIndex(
        (row) => row.id === focus.rowId,
      );

      if (snapshot.visibleRows.length === 0) {
        focus = { rowId: null, columnId: focus.columnId };
        emit();
        return;
      }

      const nextIndex =
        currentIndex === -1
          ? delta >= 0
            ? 0
            : snapshot.visibleRows.length - 1
          : clamp(
              currentIndex + delta,
              0,
              snapshot.visibleRows.length - 1,
            );
      const nextRow = snapshot.visibleRows[nextIndex];

      if (!nextRow) {
        return;
      }

      focus = { rowId: nextRow.id, columnId: focus.columnId };
      emit();
    },
    setViewport(nextViewport: GridCoreViewportState) {
      viewport = nextViewport;
      emit();
    },
  };

  function getSnapshot(): GridCoreSnapshot<TRow> {
    const visibleRows = deriveVisibleRows({
      columns: options.columns,
      filters,
      rows: sourceRows,
      sort,
    });

    return {
      viewport,
      sort,
      filters: { ...filters },
      selection: {
        rowIds: [...selection.rowIds],
        anchorRowId: selection.anchorRowId,
      },
      focus,
      totalRowCount: sourceRows.length,
      visibleRows,
      visibleRange: {
        start: 0,
        end: visibleRows.length,
      },
    };
  }

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
