import { autosizeColumns } from "@pretable-internal/layout-core";
import type { AutosizeOptions } from "@pretable-internal/layout-core";
import { createSourceRows, deriveVisibleRows } from "./derived-rows";
import type {
  GridCoreFocusState,
  GridCoreOptions,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSelectionState,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreSortState,
  GridCoreStore,
  GridCoreViewportState,
} from "./types";

function applyAutosize<TRow extends GridCoreRow>(
  options: GridCoreOptions<TRow>,
  autosizeOptions?: AutosizeOptions,
): GridCoreOptions<TRow> {
  const result = autosizeColumns({
    columns: options.columns,
    rows: options.rows,
    options: autosizeOptions,
  });

  if (result.widths.size === 0) {
    return options;
  }

  const nextColumns = options.columns.map((column) => {
    const computedWidth = result.widths.get(column.id);

    if (computedWidth === undefined) {
      return column;
    }

    return { ...column, widthPx: computedWidth };
  });

  return { ...options, columns: nextColumns };
}

export function createGridCore<TRow extends GridCoreRow>(
  inputOptions: GridCoreOptions<TRow>,
): GridCoreStore<TRow> {
  const listeners = new Set<() => void>();
  let options = inputOptions.autosize
    ? applyAutosize(
        inputOptions,
        typeof inputOptions.autosize === "object"
          ? inputOptions.autosize
          : undefined,
      )
    : inputOptions;
  const sourceRows = createSourceRows(options);
  let cachedSnapshot: GridCoreSnapshot<TRow> | null = null;
  let cachedVisibleRows: GridCoreRowModel<TRow>[] | null = null;
  let cachedDerivedSort: GridCoreSortState | null = null;
  let cachedDerivedFilters: Record<string, string> | null = null;
  let sort: GridCoreSortState = { columnId: null, direction: null };
  let filters: Record<string, string> = {};
  let selection: GridCoreSelectionState = { rowIds: [], anchorRowId: null };
  let focus: GridCoreFocusState = { rowId: null, columnId: null };
  let viewport: GridCoreViewportState = {
    scrollTop: 0,
    scrollLeft: 0,
    height: 0,
    width: 0,
  };

  const store = {
    get options() {
      return options;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
    setSort(columnId: string | null, direction: GridCoreSortDirection) {
      if (sort.columnId === columnId && sort.direction === direction) {
        return;
      }

      sort = { columnId, direction };
      emit();
    },
    setFilter(columnId: string, value: string) {
      const trimmed = value.trim();
      const currentValue = filters[columnId];

      if (trimmed) {
        if (currentValue === trimmed) {
          return;
        }

        filters = { ...filters, [columnId]: trimmed };
      } else {
        if (currentValue === undefined) {
          return;
        }

        const next = { ...filters };
        delete next[columnId];

        filters = next;
      }

      emit();
    },
    clearFilters() {
      if (Object.keys(filters).length === 0) {
        return;
      }

      filters = {};
      emit();
    },
    replaceFilters(nextFilters: Record<string, string>) {
      const normalized: Record<string, string> = {};

      for (const [columnId, value] of Object.entries(nextFilters)) {
        const trimmed = value.trim();

        if (trimmed) {
          normalized[columnId] = trimmed;
        }
      }

      if (filtersEqual(filters, normalized)) {
        return;
      }

      filters = normalized;
      emit();
    },
    selectRow(rowId: string | null) {
      const currentRowId = selection.rowIds[0] ?? null;

      if (currentRowId === rowId && selection.anchorRowId === rowId) {
        return;
      }

      selection = rowId
        ? { rowIds: [rowId], anchorRowId: rowId }
        : { rowIds: [], anchorRowId: null };
      emit();
    },
    setFocus(rowId: string | null, columnId: string | null) {
      if (focus.rowId === rowId && focus.columnId === columnId) {
        return;
      }

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
          : clamp(currentIndex + delta, 0, snapshot.visibleRows.length - 1);
      const nextRow = snapshot.visibleRows[nextIndex];

      if (!nextRow) {
        return;
      }

      focus = { rowId: nextRow.id, columnId: focus.columnId };
      emit();
    },
    setViewport(nextViewport: GridCoreViewportState) {
      if (
        viewport.scrollTop === nextViewport.scrollTop &&
        viewport.scrollLeft === nextViewport.scrollLeft &&
        viewport.height === nextViewport.height &&
        viewport.width === nextViewport.width
      ) {
        return;
      }

      viewport = nextViewport;
      emit();
    },
    autosizeColumns(autosizeOptions?: AutosizeOptions) {
      const nextOptions = applyAutosize(options, autosizeOptions);

      if (nextOptions === options) {
        return;
      }

      options = nextOptions;
      emit();
    },
  };

  return store;

  function getSnapshot(): GridCoreSnapshot<TRow> {
    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    const visibleRows =
      cachedVisibleRows !== null &&
      cachedDerivedSort === sort &&
      cachedDerivedFilters === filters
        ? cachedVisibleRows
        : deriveVisibleRows({
            columns: options.columns,
            filters,
            rows: sourceRows,
            sort,
          });

    cachedVisibleRows = visibleRows;
    cachedDerivedSort = sort;
    cachedDerivedFilters = filters;

    cachedSnapshot = {
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

    return cachedSnapshot;
  }

  function emit() {
    cachedSnapshot = null;

    for (const listener of listeners) {
      listener();
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function filtersEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}
