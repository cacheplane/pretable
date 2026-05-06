import { autosizeColumns } from "@pretable-internal/layout-core";
import type { AutosizeOptions } from "@pretable-internal/layout-core";
import {
  createSourceRows,
  deriveVisibleRows,
  type SourceRow,
} from "./derived-rows";
import type {
  GridCoreCellAddress,
  GridCoreCellRange,
  GridCoreColumn,
  GridCoreFocusDirection,
  GridCoreFocusState,
  GridCoreMoveFocusOptions,
  GridCoreOptions,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSelectionState,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreSortState,
  GridCoreStore,
  GridCoreTransaction,
  GridCoreViewportState,
} from "./types";

const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";

function clampColumnWidth<TRow extends GridCoreRow>(
  width: number,
  column: GridCoreColumn<TRow>,
): number {
  const min = column.minWidthPx ?? 40;
  const max = column.maxWidthPx ?? Infinity;
  return Math.max(min, Math.min(max, width));
}

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
  let originalColumns: GridCoreColumn<TRow>[] = inputOptions.columns.map(
    (c) => ({ ...c }),
  );
  let sourceRows = createSourceRows(options);
  const sourceRowIndex = new Map<string, SourceRow<TRow>>(
    sourceRows.map((entry) => [entry.id, entry]),
  );
  let cachedSnapshot: GridCoreSnapshot<TRow> | null = null;
  let cachedVisibleRows: GridCoreRowModel<TRow>[] | null = null;
  let cachedDerivedSort: GridCoreSortState | null = null;
  let cachedDerivedFilters: Record<string, string> | null = null;
  let sort: GridCoreSortState = { columnId: null, direction: null };
  let filters: Record<string, string> = {};
  let selection: GridCoreSelectionState = { ranges: [], anchor: null };
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
    setSelection(next: GridCoreSelectionState) {
      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = {
        ranges: next.ranges.map((r) => ({ ...r })),
        anchor: next.anchor ? { ...next.anchor } : null,
      };
      emit();
    },
    selectAll() {
      const snapshot = getSnapshot();
      const firstRow = snapshot.visibleRows[0];
      const lastRow = snapshot.visibleRows[snapshot.visibleRows.length - 1];
      const firstColumn = options.columns[0];
      const lastColumn = options.columns[options.columns.length - 1];

      if (!firstRow || !lastRow || !firstColumn || !lastColumn) {
        return;
      }

      const range: GridCoreCellRange = {
        startRowId: firstRow.id,
        endRowId: lastRow.id,
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      };
      const anchor: GridCoreCellAddress = {
        rowId: firstRow.id,
        columnId: firstColumn.id,
      };

      const next: GridCoreSelectionState = { ranges: [range], anchor };

      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = next;
      emit();
    },
    clearSelection() {
      const focusAddr =
        focus.rowId && focus.columnId
          ? { rowId: focus.rowId, columnId: focus.columnId }
          : null;
      const next: GridCoreSelectionState = focusAddr
        ? {
            ranges: [
              {
                startRowId: focusAddr.rowId,
                endRowId: focusAddr.rowId,
                startColumnId: focusAddr.columnId,
                endColumnId: focusAddr.columnId,
              },
            ],
            anchor: focusAddr,
          }
        : { ranges: [], anchor: null };

      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = next;
      emit();
    },
    addRange(range: GridCoreCellRange) {
      selection = {
        ranges: [...selection.ranges, { ...range }],
        anchor: { rowId: range.startRowId, columnId: range.startColumnId },
      };
      emit();
    },
    extendRangeFromAnchor(addr: GridCoreCellAddress) {
      if (!selection.anchor) {
        return;
      }

      const newActive: GridCoreCellRange = {
        startRowId: selection.anchor.rowId,
        endRowId: addr.rowId,
        startColumnId: selection.anchor.columnId,
        endColumnId: addr.columnId,
      };

      const ranges =
        selection.ranges.length === 0
          ? [newActive]
          : [...selection.ranges.slice(0, -1), newActive];

      selection = { ranges, anchor: selection.anchor };
      emit();
    },
    toggleRowSelection(rowId: string) {
      const firstColumn = options.columns[0];
      const lastColumn = options.columns[options.columns.length - 1];

      if (!firstColumn || !lastColumn) {
        return;
      }

      const fullRowRange: GridCoreCellRange = {
        startRowId: rowId,
        endRowId: rowId,
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      };

      const matchIndex = selection.ranges.findIndex((r) =>
        isFullRowRange(r, rowId, firstColumn.id, lastColumn.id),
      );

      if (matchIndex >= 0) {
        const ranges = selection.ranges.filter((_, i) => i !== matchIndex);
        selection = { ranges, anchor: selection.anchor };
      } else {
        selection = {
          ranges: [...selection.ranges, fullRowRange],
          anchor: { rowId, columnId: firstColumn.id },
        };
      }

      emit();
    },
    setSelectAllVisible(checked: boolean) {
      const snapshot = getSnapshot();
      const firstColumn = options.columns[0];
      const lastColumn = options.columns[options.columns.length - 1];

      if (!firstColumn || !lastColumn) {
        return;
      }

      const visibleIds = new Set(snapshot.visibleRows.map((r) => r.id));
      const nonRowRanges = selection.ranges.filter(
        (r) =>
          !isFullRowRange(r, r.startRowId, firstColumn.id, lastColumn.id) ||
          !visibleIds.has(r.startRowId),
      );

      let next: GridCoreSelectionState;

      if (checked) {
        const newRanges = snapshot.visibleRows.map<GridCoreCellRange>(
          (row) => ({
            startRowId: row.id,
            endRowId: row.id,
            startColumnId: firstColumn.id,
            endColumnId: lastColumn.id,
          }),
        );

        next = {
          ranges: [...nonRowRanges, ...newRanges],
          anchor: snapshot.visibleRows[0]
            ? { rowId: snapshot.visibleRows[0].id, columnId: firstColumn.id }
            : selection.anchor,
        };
      } else {
        next = { ranges: nonRowRanges, anchor: selection.anchor };
      }

      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = next;
      emit();
    },
    setFocus(addr: GridCoreCellAddress | null) {
      const nextRowId = addr?.rowId ?? null;
      const nextColumnId = addr?.columnId ?? null;

      if (focus.rowId === nextRowId && focus.columnId === nextColumnId) {
        return;
      }

      focus = { rowId: nextRowId, columnId: nextColumnId };
      emit();
    },
    moveFocus(
      direction: GridCoreFocusDirection,
      moveOptions: GridCoreMoveFocusOptions = {},
    ) {
      const snapshot = getSnapshot();
      const visibleRows = snapshot.visibleRows;
      const columnList = options.columns;

      if (visibleRows.length === 0 || columnList.length === 0) {
        focus = { rowId: null, columnId: null };
        emit();
        return;
      }

      const currentRowIndex = focus.rowId
        ? visibleRows.findIndex((r) => r.id === focus.rowId)
        : -1;
      const currentColumnIndex = focus.columnId
        ? columnList.findIndex((c) => c.id === focus.columnId)
        : -1;

      const hasRowFocus = currentRowIndex !== -1;
      const hasColumnFocus = currentColumnIndex !== -1;
      const baseRowIndex = hasRowFocus ? currentRowIndex : 0;
      const baseColumnIndex = hasColumnFocus ? currentColumnIndex : 0;

      let nextRowIndex = baseRowIndex;
      let nextColumnIndex = baseColumnIndex;

      const pageStep = computePageStep(viewport, visibleRows);

      // When focus is null on the relevant axis, the move lands on the edge
      // implied by the direction (down/right → 0; up/left → length-1) without
      // applying a step, so the user "arrives" at the grid before navigating.
      switch (direction) {
        case "up":
          if (moveOptions.jumpToEdge) {
            nextRowIndex = 0;
          } else if (!hasRowFocus) {
            nextRowIndex = visibleRows.length - 1;
          } else if (moveOptions.byPage) {
            nextRowIndex = clamp(
              baseRowIndex - pageStep,
              0,
              visibleRows.length - 1,
            );
          } else {
            nextRowIndex = clamp(baseRowIndex - 1, 0, visibleRows.length - 1);
          }
          break;
        case "down":
          if (moveOptions.jumpToEdge) {
            nextRowIndex = visibleRows.length - 1;
          } else if (!hasRowFocus) {
            nextRowIndex = 0;
          } else if (moveOptions.byPage) {
            nextRowIndex = clamp(
              baseRowIndex + pageStep,
              0,
              visibleRows.length - 1,
            );
          } else {
            nextRowIndex = clamp(baseRowIndex + 1, 0, visibleRows.length - 1);
          }
          break;
        case "left":
          if (moveOptions.jumpToEdge) {
            nextColumnIndex = 0;
          } else if (!hasColumnFocus) {
            nextColumnIndex = columnList.length - 1;
          } else {
            nextColumnIndex = clamp(
              baseColumnIndex - 1,
              0,
              columnList.length - 1,
            );
          }
          break;
        case "right":
          if (moveOptions.jumpToEdge) {
            nextColumnIndex = columnList.length - 1;
          } else if (!hasColumnFocus) {
            nextColumnIndex = 0;
          } else {
            nextColumnIndex = clamp(
              baseColumnIndex + 1,
              0,
              columnList.length - 1,
            );
          }
          break;
      }

      const nextRow = visibleRows[nextRowIndex];
      const nextColumn = columnList[nextColumnIndex];

      if (!nextRow || !nextColumn) {
        return;
      }

      const nextAddr: GridCoreCellAddress = {
        rowId: nextRow.id,
        columnId: nextColumn.id,
      };

      focus = nextAddr;

      if (moveOptions.extend) {
        if (!selection.anchor) {
          selection = {
            ranges: [
              {
                startRowId: nextAddr.rowId,
                endRowId: nextAddr.rowId,
                startColumnId: nextAddr.columnId,
                endColumnId: nextAddr.columnId,
              },
            ],
            anchor: nextAddr,
          };
        } else {
          const newActive: GridCoreCellRange = {
            startRowId: selection.anchor.rowId,
            endRowId: nextAddr.rowId,
            startColumnId: selection.anchor.columnId,
            endColumnId: nextAddr.columnId,
          };
          const ranges =
            selection.ranges.length === 0
              ? [newActive]
              : [...selection.ranges.slice(0, -1), newActive];
          selection = { ranges, anchor: selection.anchor };
        }
      } else {
        selection = {
          ranges: [
            {
              startRowId: nextAddr.rowId,
              endRowId: nextAddr.rowId,
              startColumnId: nextAddr.columnId,
              endColumnId: nextAddr.columnId,
            },
          ],
          anchor: nextAddr,
        };
      }

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
    setColumnWidth(columnId: string, width: number) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      const clamped = clampColumnWidth(width, column);
      if (column.widthPx === clamped) {
        return;
      }
      const nextColumns = options.columns.slice();
      nextColumns[idx] = { ...column, widthPx: clamped };
      options = { ...options, columns: nextColumns };
      emit();
    },
    moveColumn(columnId: string, toIndex: number) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const fromIndex = options.columns.findIndex((c) => c.id === columnId);
      if (fromIndex === -1) {
        return;
      }
      const synthAtZero = options.columns[0]?.id === ROW_SELECT_COLUMN_ID;
      const minIndex = synthAtZero ? 1 : 0;
      const maxIndex = options.columns.length - 1;
      const clampedTo = Math.max(minIndex, Math.min(maxIndex, toIndex));
      if (fromIndex === clampedTo) {
        return;
      }

      const nextColumns = options.columns.slice();
      const [moved] = nextColumns.splice(fromIndex, 1);
      if (!moved) {
        return;
      }
      nextColumns.splice(clampedTo, 0, moved);

      // Compute pin boundary on the post-move array, EXCLUDING the moved
      // column's own pin state. The boundary is the index (in the full
      // nextColumns array) of the first non-pinned, non-synthetic column
      // when the moved column is skipped.
      let boundary = synthAtZero ? 1 : 0;
      for (let i = synthAtZero ? 1 : 0; i < nextColumns.length; i += 1) {
        if (i === clampedTo) {
          continue;
        }
        if (nextColumns[i]?.pinned === "left") {
          boundary = i + 1;
        } else {
          break;
        }
      }
      // boundary is now the index in nextColumns where the pinned region
      // ends (excluding the moved column). The moved column lands in the
      // pinned region iff clampedTo < boundary.
      const landsInPinned = clampedTo < boundary;

      const wasPinned = moved.pinned === "left";
      const nextPinned: "left" | undefined = landsInPinned ? "left" : undefined;

      if (nextPinned !== moved.pinned || wasPinned !== landsInPinned) {
        nextColumns[clampedTo] = { ...moved, pinned: nextPinned };
      }

      options = { ...options, columns: nextColumns };
      emit();
    },
    setColumnPinned(columnId: string, pinned: "left" | null) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      const nextPinnedValue =
        pinned === "left" ? ("left" as const) : undefined;
      if (column.pinned === nextPinnedValue) {
        return;
      }

      const nextColumns = options.columns.slice();
      nextColumns.splice(idx, 1);

      const synthAtZero = nextColumns[0]?.id === ROW_SELECT_COLUMN_ID;
      const baseStart = synthAtZero ? 1 : 0;
      let boundary = baseStart;
      while (
        boundary < nextColumns.length &&
        nextColumns[boundary]?.pinned === "left"
      ) {
        boundary += 1;
      }

      const insertAt = boundary;
      const nextColumn: GridCoreColumn<TRow> = {
        ...column,
        pinned: nextPinnedValue,
      };
      nextColumns.splice(insertAt, 0, nextColumn);

      options = { ...options, columns: nextColumns };
      emit();
    },
    autosizeColumn(columnId: string, autosizeOptions?: AutosizeOptions) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      const probeColumns = options.columns.slice();
      probeColumns[idx] = { ...column, widthPx: undefined };
      const probedOptions = { ...options, columns: probeColumns };
      const probed = applyAutosize(probedOptions, autosizeOptions);
      const nextWidth = probed.columns[idx]?.widthPx;
      if (nextWidth === undefined || nextWidth === column.widthPx) {
        return;
      }
      const clamped = clampColumnWidth(nextWidth, column);
      const nextColumns = options.columns.slice();
      nextColumns[idx] = { ...column, widthPx: clamped };
      options = { ...options, columns: nextColumns };
      emit();
    },
    resetColumnLayout() {
      const restored = inputOptions.autosize
        ? applyAutosize(
            {
              ...inputOptions,
              columns: originalColumns.map((c) => ({ ...c })),
            },
            typeof inputOptions.autosize === "object"
              ? inputOptions.autosize
              : undefined,
          )
        : {
            ...inputOptions,
            columns: originalColumns.map((c) => ({ ...c })),
          };

      const current = options.columns;
      const next = restored.columns;
      if (current.length === next.length) {
        let same = true;
        for (let i = 0; i < current.length; i += 1) {
          const c = current[i]!;
          const n = next[i]!;
          if (
            c.id !== n.id ||
            c.widthPx !== n.widthPx ||
            c.pinned !== n.pinned
          ) {
            same = false;
            break;
          }
        }
        if (same) {
          return;
        }
      }

      options = { ...options, columns: next };
      emit();
    },
    mergeColumnsFromProps(nextColumns: GridCoreColumn<TRow>[]) {
      const currentById = new Map(options.columns.map((c) => [c.id, c]));
      const merged = nextColumns.map((newCol) => {
        const existing = currentById.get(newCol.id);
        if (existing) {
          return {
            ...newCol,
            widthPx: existing.widthPx ?? newCol.widthPx,
            pinned: existing.pinned ?? newCol.pinned,
          };
        }
        return { ...newCol };
      });
      originalColumns = nextColumns.map((c) => ({ ...c }));
      options = { ...options, columns: merged };
      emit();
    },
    applyTransaction(transaction: GridCoreTransaction<TRow>) {
      if (!options.getRowId) {
        throw new Error(
          "applyTransaction requires getRowId on GridCoreOptions",
        );
      }

      const getRowId = options.getRowId;

      if (transaction.remove) {
        const removeSet = new Set(transaction.remove);

        sourceRows = sourceRows.filter((entry) => {
          if (removeSet.has(entry.id)) {
            sourceRowIndex.delete(entry.id);
            return false;
          }

          return true;
        });
      }

      if (transaction.update) {
        for (const patch of transaction.update) {
          const id = getRowId(patch as TRow, -1);
          const existing = sourceRowIndex.get(id);

          if (!existing) {
            continue;
          }

          const merged = { ...existing.row, ...patch } as TRow;
          const updated: SourceRow<TRow> = {
            id: existing.id,
            row: merged,
            sourceIndex: existing.sourceIndex,
          };
          const arrayIndex = sourceRows.indexOf(existing);

          if (arrayIndex !== -1) {
            sourceRows[arrayIndex] = updated;
          }

          sourceRowIndex.set(id, updated);
        }
      }

      if (transaction.add) {
        for (const row of transaction.add) {
          const id = getRowId(row, sourceRows.length);
          const entry: SourceRow<TRow> = {
            id,
            row,
            sourceIndex: sourceRows.length,
          };

          sourceRows.push(entry);
          sourceRowIndex.set(id, entry);
        }
      }

      cachedVisibleRows = null;
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
        ranges: selection.ranges.map((r) => ({ ...r })),
        anchor: selection.anchor ? { ...selection.anchor } : null,
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

function computePageStep<TRow extends GridCoreRow>(
  viewport: { height: number },
  visibleRows: GridCoreRowModel<TRow>[],
): number {
  if (viewport.height <= 0 || visibleRows.length === 0) {
    return 1;
  }

  // 32px = default row-height heuristic; the React adapter overrides this
  // with measured row heights in Phase 2.
  const estimatedRowsPerPage = Math.max(
    1,
    Math.floor((viewport.height * 0.8) / 32),
  );

  return Math.min(estimatedRowsPerPage, visibleRows.length);
}

function isFullRowRange(
  range: GridCoreCellRange,
  rowId: string,
  firstColumnId: string,
  lastColumnId: string,
): boolean {
  return (
    range.startRowId === rowId &&
    range.endRowId === rowId &&
    range.startColumnId === firstColumnId &&
    range.endColumnId === lastColumnId
  );
}

function selectionsEqual(
  a: GridCoreSelectionState,
  b: GridCoreSelectionState,
): boolean {
  if (a.ranges.length !== b.ranges.length) {
    return false;
  }

  for (let i = 0; i < a.ranges.length; i += 1) {
    const ar = a.ranges[i]!;
    const br = b.ranges[i]!;

    if (
      ar.startRowId !== br.startRowId ||
      ar.endRowId !== br.endRowId ||
      ar.startColumnId !== br.startColumnId ||
      ar.endColumnId !== br.endColumnId
    ) {
      return false;
    }
  }

  if (a.anchor === null && b.anchor === null) {
    return true;
  }

  if (a.anchor === null || b.anchor === null) {
    return false;
  }

  return (
    a.anchor.rowId === b.anchor.rowId && a.anchor.columnId === b.anchor.columnId
  );
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
