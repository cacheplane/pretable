import { autosizeColumns } from "@pretable-internal/layout-core";
import type { AutosizeOptions } from "@pretable-internal/layout-core";
import {
  createSourceRows,
  deriveVisibleRows,
  type SourceRow,
} from "./derived-rows";
import { isFilterActive } from "./evaluate-filter";
import type {
  ColumnFilter,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableEditState,
  PretableFocusDirection,
  PretableFocusState,
  PretableMoveFocusOptions,
  PretableGridOptions,
  PretableRow,
  PretableVisibleRow,
  PretableSelectionState,
  PretableGridSnapshot,
  PretableSortDirection,
  PretableSortEntry,
  PretableEngine,
  PretableTransaction,
  PretableViewportState,
} from "./types";

const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";

function clampColumnWidth<TRow extends PretableRow>(
  width: number,
  column: PretableColumn<TRow>,
): number {
  const min = column.minWidthPx ?? 40;
  const max = column.maxWidthPx ?? Infinity;
  return Math.max(min, Math.min(max, width));
}

function applyAutosize<TRow extends PretableRow>(
  options: PretableGridOptions<TRow>,
  autosizeOptions?: AutosizeOptions,
): PretableGridOptions<TRow> {
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

/**
 * Enforce the array-order-is-visual-order invariant:
 * `[synthetic?] [pinned "left"…] [unpinned…] [pinned "right"…]`.
 *
 * `planColumns` renders the three regions in exactly that order, so a
 * `PlannedColumn`'s `index` — which feeds `aria-colindex` and the reorder
 * gesture's drop hit-test — is a true visual index only while the source array
 * is already grouped. Every path that assigns `options.columns` from an
 * external source (construction, prop merge, layout reset, `setColumnOrder`)
 * runs through here; the mutating paths (`moveColumn`, `setColumnPinned`)
 * preserve the grouping by construction instead.
 *
 * Grouping is stable: relative order within each region is preserved, so a
 * consumer that declares columns interleaved gets them regrouped without
 * otherwise being reshuffled.
 *
 * The synthetic row-select column leads its OWN region rather than the whole
 * array. It is pinned left by default, in which case those are the same thing;
 * but `rowSelectionColumn.pinned: false` makes it scrollable, and forcing it to
 * index 0 ahead of the left-pinned run would be the very desync this helper
 * exists to prevent.
 */
function groupColumnsByPin<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
): PretableColumn<TRow>[] {
  const left: PretableColumn<TRow>[] = [];
  const unpinned: PretableColumn<TRow>[] = [];
  const right: PretableColumn<TRow>[] = [];

  for (const column of columns) {
    const region =
      column.pinned === "left"
        ? left
        : column.pinned === "right"
          ? right
          : unpinned;
    if (column.id === ROW_SELECT_COLUMN_ID) {
      region.unshift(column);
    } else {
      region.push(column);
    }
  }

  return [...left, ...unpinned, ...right];
}

export function createGridCore<TRow extends PretableRow>(
  inputOptions: PretableGridOptions<TRow>,
): PretableEngine<TRow> {
  const listeners = new Set<() => void>();
  const groupedInput: PretableGridOptions<TRow> = {
    ...inputOptions,
    columns: groupColumnsByPin(inputOptions.columns),
  };
  let options = groupedInput.autosize
    ? applyAutosize(
        groupedInput,
        typeof groupedInput.autosize === "object"
          ? groupedInput.autosize
          : undefined,
      )
    : groupedInput;
  let originalColumns: PretableColumn<TRow>[] = groupColumnsByPin(
    inputOptions.columns,
  ).map((c) => ({ ...c }));
  let sourceRows = createSourceRows(options);
  const sourceRowIndex = new Map<string, SourceRow<TRow>>(
    sourceRows.map((entry) => [entry.id, entry]),
  );
  /**
   * Columns whose width was chosen explicitly — a consumer resize, or a
   * controlled `columnWidths` slice. Autosize re-runs when rows are replaced,
   * so it needs to know which widths are a deliberate choice to leave alone.
   */
  const pinnedWidthColumnIds = new Set<string>();
  let cachedSnapshot: PretableGridSnapshot<TRow> | null = null;
  let cachedVisibleRows: PretableVisibleRow<TRow>[] | null = null;
  let cachedDerivedSort: PretableSortEntry[] | null = null;
  let cachedDerivedFilters: Record<string, ColumnFilter> | null = null;
  let sort: PretableSortEntry[] = [];
  let filters: Record<string, ColumnFilter> = {};
  let selection: PretableSelectionState = { ranges: [], anchor: null };
  let focus: PretableFocusState = { rowId: null, columnId: null };
  let editing: PretableEditState | null = null;
  let viewport: PretableViewportState = {
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
    setSort(columnId: string | null, direction: PretableSortDirection) {
      const candidate: PretableSortEntry[] =
        columnId && direction ? [{ columnId, direction }] : [];
      // Same validation as replaceSort: unknown or sortable:false columns are
      // dropped, so an invalid target resolves to [] (clear), never a phantom
      // entry that sortRows would ignore.
      const next = sanitizeSortEntries(candidate, options.columns);

      if (sortsEqual(sort, next)) {
        return;
      }

      sort = next;
      emit();
    },
    replaceSort(entries: PretableSortEntry[]) {
      const next = sanitizeSortEntries(entries, options.columns);

      if (sortsEqual(sort, next)) {
        return;
      }

      sort = next;
      emit();
    },
    setColumnFilter(columnId: string, filter: ColumnFilter | null) {
      const current = filters[columnId];

      if (filter && isFilterActive(filter)) {
        if (current && columnFilterEqual(current, filter)) {
          return;
        }

        filters = { ...filters, [columnId]: filter };
      } else {
        if (current === undefined) {
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
    replaceFilters(nextFilters: Record<string, ColumnFilter>) {
      const normalized: Record<string, ColumnFilter> = {};

      for (const [columnId, filter] of Object.entries(nextFilters)) {
        if (filter && isFilterActive(filter)) {
          normalized[columnId] = filter;
        }
      }

      if (filtersEqual(filters, normalized)) {
        return;
      }

      filters = normalized;
      emit();
    },
    distinctColumnValues(columnId: string): string[] {
      const column = options.columns.find((c) => c.id === columnId);

      if (!column) {
        return [];
      }

      const seen = new Set<string>();

      for (const entry of sourceRows) {
        const raw = column.value
          ? column.value(entry.row)
          : entry.row[columnId];

        if (raw === null || raw === undefined) {
          continue;
        }

        const s = String(raw);

        if (s.trim() === "") {
          continue;
        }

        seen.add(s);
      }

      return [...seen].sort((a, b) => a.localeCompare(b));
    },
    setSelection(next: PretableSelectionState) {
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

      const range: PretableCellRange = {
        startRowId: firstRow.id,
        endRowId: lastRow.id,
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      };
      const anchor: PretableCellAddress = {
        rowId: firstRow.id,
        columnId: firstColumn.id,
      };

      const next: PretableSelectionState = { ranges: [range], anchor };

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
      const next: PretableSelectionState = focusAddr
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
    addRange(range: PretableCellRange) {
      selection = {
        ranges: [...selection.ranges, { ...range }],
        anchor: { rowId: range.startRowId, columnId: range.startColumnId },
      };
      emit();
    },
    extendRangeFromAnchor(addr: PretableCellAddress) {
      if (!selection.anchor) {
        return;
      }

      const newActive: PretableCellRange = {
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

      const fullRowRange: PretableCellRange = {
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

      let next: PretableSelectionState;

      if (checked) {
        const newRanges = snapshot.visibleRows.map<PretableCellRange>(
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
    setFocus(addr: PretableCellAddress | null) {
      const nextRowId = addr?.rowId ?? null;
      const nextColumnId = addr?.columnId ?? null;

      if (focus.rowId === nextRowId && focus.columnId === nextColumnId) {
        return;
      }

      focus = { rowId: nextRowId, columnId: nextColumnId };
      emit();
    },
    moveFocus(
      direction: PretableFocusDirection,
      moveOptions: PretableMoveFocusOptions = {},
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

      const nextAddr: PretableCellAddress = {
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
          const newActive: PretableCellRange = {
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
    setViewport(nextViewport: PretableViewportState) {
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
      pinnedWidthColumnIds.add(columnId);
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

      // Array order IS visual order: options.columns is always grouped as
      // [synthetic?] [pinned "left"…] [unpinned…] [pinned "right"…], and
      // planColumns / aria-colindex rely on that. A move therefore cannot
      // carry a pin across a region boundary; instead the moved column
      // adopts the pin state of the region it lands in.
      //
      // Both boundaries are computed on the post-move array while SKIPPING
      // `clampedTo`, so the moved column's own (stale) pin never influences
      // where the regions are.
      //
      // leftBoundary: index just past the leading `pinned === "left"` run.
      let leftBoundary = minIndex;
      for (let i = minIndex; i < nextColumns.length; i += 1) {
        if (i === clampedTo) {
          continue;
        }
        if (nextColumns[i]?.pinned === "left") {
          leftBoundary = i + 1;
        } else {
          break;
        }
      }

      // rightBoundary: index where the trailing `pinned === "right"` run
      // starts; nextColumns.length when there is no trailing run. Exact
      // mirror of the leftBoundary scan.
      let rightBoundary = nextColumns.length;
      for (let i = nextColumns.length - 1; i >= minIndex; i -= 1) {
        if (i === clampedTo) {
          continue;
        }
        if (nextColumns[i]?.pinned === "right") {
          rightBoundary = i;
        } else {
          break;
        }
      }

      // The two predicates can never both hold — a column landing between the
      // runs satisfies neither — so the rule is total and unambiguous.
      const nextPinned: "left" | "right" | undefined =
        clampedTo < leftBoundary
          ? "left"
          : clampedTo >= rightBoundary
            ? "right"
            : undefined;

      if (nextPinned !== moved.pinned) {
        nextColumns[clampedTo] = { ...moved, pinned: nextPinned };
      }

      options = { ...options, columns: nextColumns };
      emit();
    },
    setColumnOrder(ids: readonly string[]) {
      // `ids` is a *relative* order request, never a pin request: pin state is
      // read from the current columns and never from the argument. The result
      // is regrouped into the array-order-is-visual-order invariant
      // ([synthetic?] [left…] [unpinned…] [right…]), so an argument that
      // interleaves pinned and unpinned ids is normalised, not honoured
      // literally.
      const byId = new Map(options.columns.map((c) => [c.id, c]));
      const taken = new Set<string>();
      const ordered: PretableColumn<TRow>[] = [];

      for (const id of ids) {
        if (id === ROW_SELECT_COLUMN_ID || taken.has(id)) {
          continue;
        }
        const column = byId.get(id);
        if (!column) {
          continue;
        }
        taken.add(id);
        ordered.push(column);
      }

      // Columns the caller omitted keep their current relative order at the
      // end. The synthetic column always falls into this pass — it is skipped
      // above, so the caller can never position it — and `groupColumnsByPin`
      // seats it back at index 0.
      for (const column of options.columns) {
        if (taken.has(column.id)) {
          continue;
        }
        taken.add(column.id);
        ordered.push(column);
      }

      const nextColumns = groupColumnsByPin(ordered);

      let changed = nextColumns.length !== options.columns.length;
      if (!changed) {
        for (let i = 0; i < nextColumns.length; i += 1) {
          if (nextColumns[i]!.id !== options.columns[i]!.id) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        return;
      }

      options = { ...options, columns: nextColumns };
      emit();
    },
    setColumnPinned(columnId: string, pinned: "left" | "right" | null) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      const nextPinnedValue =
        pinned === "left" || pinned === "right" ? pinned : undefined;
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

      // Right-pinned columns live in a trailing region; a newly right-pinned
      // column joins it at its leading edge (mirror of a left-pinned column
      // joining the leading region at its trailing edge).
      let rightBoundary = nextColumns.length;
      while (
        rightBoundary > boundary &&
        nextColumns[rightBoundary - 1]?.pinned === "right"
      ) {
        rightBoundary -= 1;
      }

      // A column lands at the right region's leading edge when it is joining
      // that region, and also when it is *leaving* it by being unpinned —
      // unpinning leaves a column where it already sits, and a right-pinned
      // column sits at the trailing end of the scrollable run, not its front.
      // Re-pinning right -> left is not "leaving to stay put": it joins the
      // left region, so it takes `boundary` like any other left pin.
      const staysAtRightBoundary =
        nextPinnedValue === "right" ||
        (nextPinnedValue === undefined && column.pinned === "right");
      const insertAt = staysAtRightBoundary ? rightBoundary : boundary;
      const nextColumn: PretableColumn<TRow> = {
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
    mergeColumnsFromProps(nextColumns: PretableColumn<TRow>[]) {
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
      // Props arrive in the consumer's declared order but carry the *runtime*
      // pin state merged back in, so the result has to be regrouped — prop
      // order alone does not respect the pinned regions. Group before the
      // comparison, or a prop update that only reorders within a pinned region
      // would read as a change every time.
      const grouped = groupColumnsByPin(merged);
      const changed = !sameColumnLayout(options.columns, grouped);
      originalColumns = groupColumnsByPin(nextColumns).map((c) => ({ ...c }));
      options = { ...options, columns: grouped };
      // Callers hand us a fresh array whenever `columns` is written inline, so
      // only wake subscribers when something they can observe actually moved.
      // The merged definitions are stored either way, which is what keeps a
      // re-created `value`/`format` closure from going stale.
      if (changed) {
        emit();
      }
    },
    applyTransaction(transaction: PretableTransaction<TRow>) {
      if (!options.getRowId) {
        throw new Error(
          "applyTransaction requires getRowId on PretableGridOptions",
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
    setRows(nextRows: TRow[]) {
      options = { ...options, rows: nextRows };
      sourceRows = createSourceRows(options);
      sourceRowIndex.clear();
      for (const entry of sourceRows) {
        sourceRowIndex.set(entry.id, entry);
      }

      // Selection and focus are keyed by row id and intentionally survive a row
      // replacement — this is what lets them persist across streaming updates.
      // Only drop references whose rows are no longer present.
      const hasRow = (id: string | null | undefined): boolean =>
        id != null && sourceRowIndex.has(id);

      const keptRanges = selection.ranges.filter(
        (range) => hasRow(range.startRowId) && hasRow(range.endRowId),
      );
      const anchorValid = !selection.anchor || hasRow(selection.anchor.rowId);
      if (keptRanges.length !== selection.ranges.length || !anchorValid) {
        selection = {
          ranges: keptRanges,
          anchor: anchorValid ? selection.anchor : null,
        };
      }

      if (focus.rowId !== null && !hasRow(focus.rowId)) {
        focus = { rowId: null, columnId: null };
      }

      if (editing && !hasRow(editing.rowId)) {
        editing = null;
      }

      // Autosize derives widths from content, so replacing the rows has to
      // re-measure — otherwise a grid whose first render was empty (the usual
      // fetch-then-render order) keeps the widths it took from no data.
      // Measure from `originalColumns`: autosize skips any column that already
      // carries a width, so measuring the live set would only re-confirm the
      // previous pass. Widths the consumer chose outrank anything measured.
      if (options.autosize) {
        const measured = applyAutosize(
          { ...options, columns: originalColumns },
          typeof options.autosize === "object" ? options.autosize : undefined,
        );
        const measuredById = new Map(
          measured.columns.map((column) => [column.id, column.widthPx]),
        );
        options = {
          ...options,
          // Keyed by id, not index — `moveColumn` can leave the live order out
          // of step with `originalColumns`, and the live set may carry the
          // synthetic row-select column that never appears in props.
          columns: options.columns.map((column) => {
            if (pinnedWidthColumnIds.has(column.id)) {
              return column;
            }
            const width = measuredById.get(column.id);
            if (width === undefined || width === column.widthPx) {
              return column;
            }
            return { ...column, widthPx: width };
          }),
        };
      }

      cachedVisibleRows = null;
      emit();
    },
    beginEdit(
      addr: PretableCellAddress,
      opts?: { draft?: unknown; status?: "checking" | "editing" },
    ) {
      editing = {
        rowId: addr.rowId,
        columnId: addr.columnId,
        draft: opts?.draft,
        status: opts?.status ?? "editing",
      };
      emit();
    },
    setEditDraft(value: unknown) {
      if (!editing) return;
      editing = { ...editing, draft: value };
      emit();
    },
    markEditing() {
      if (!editing || editing.status !== "checking") return;
      editing = { ...editing, status: "editing", error: undefined };
      emit();
    },
    markEditValidating() {
      if (!editing) return;
      editing = { ...editing, status: "validating", error: undefined };
      emit();
    },
    markEditSaving() {
      if (!editing) return;
      editing = { ...editing, status: "saving", error: undefined };
      emit();
    },
    markEditInvalid(message: string) {
      if (!editing) return;
      editing = { ...editing, status: "editing", error: message };
      emit();
    },
    markEditError(message: string) {
      if (!editing) return;
      editing = { ...editing, status: "error", error: message };
      emit();
    },
    commitEditSucceeded() {
      if (!editing) return;
      editing = null;
      emit();
    },
    cancelEdit() {
      if (!editing) return;
      editing = null;
      emit();
    },
  };

  return store;

  function getSnapshot(): PretableGridSnapshot<TRow> {
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
      sort: sort.map((entry) => ({ ...entry })),
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
      editing: editing ? { ...editing } : null,
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

/**
 * Compare the column fields a subscriber can observe. Deliberately ignores
 * `value`/`format`/`render` — those are routinely re-created inline, and
 * comparing them by identity would report a change on every render.
 */
function sameColumnLayout<TRow extends PretableRow>(
  a: readonly PretableColumn<TRow>[],
  b: readonly PretableColumn<TRow>[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((left, index) => {
    const right = b[index]!;
    return (
      left.id === right.id &&
      left.header === right.header &&
      left.widthPx === right.widthPx &&
      left.minWidthPx === right.minWidthPx &&
      left.maxWidthPx === right.maxWidthPx &&
      left.pinned === right.pinned &&
      left.sortable === right.sortable &&
      left.filterable === right.filterable &&
      left.resizable === right.resizable &&
      left.reorderable === right.reorderable &&
      left.wrap === right.wrap
    );
  });
}

function computePageStep<TRow extends PretableRow>(
  viewport: { height: number },
  visibleRows: PretableVisibleRow<TRow>[],
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
  range: PretableCellRange,
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
  a: PretableSelectionState,
  b: PretableSelectionState,
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

/** Drop entries targeting unknown or sortable:false columns (shared by setSort + replaceSort). */
function sanitizeSortEntries<TRow extends PretableRow>(
  entries: PretableSortEntry[],
  columns: PretableColumn<TRow>[],
): PretableSortEntry[] {
  return entries.filter((entry) => {
    const column = columns.find((c) => c.id === entry.columnId);
    return column !== undefined && column.sortable !== false;
  });
}

function sortsEqual(a: PretableSortEntry[], b: PretableSortEntry[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    const ae = a[i]!;
    const be = b[i]!;

    if (ae.columnId !== be.columnId || ae.direction !== be.direction) {
      return false;
    }
  }

  return true;
}

function columnFilterEqual(a: ColumnFilter, b: ColumnFilter): boolean {
  if (a.operator !== b.operator) {
    return false;
  }

  const av = a.value;
  const bv = b.value;

  if (Array.isArray(av) && Array.isArray(bv)) {
    return av.length === bv.length && av.every((v, i) => v === bv[i]);
  }

  return av === bv;
}

function filtersEqual(
  a: Record<string, ColumnFilter>,
  b: Record<string, ColumnFilter>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];

    if (!av || !bv || !columnFilterEqual(av, bv)) {
      return false;
    }
  }

  return true;
}
