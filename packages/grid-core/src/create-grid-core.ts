import { autosizeColumns } from "@pretable-internal/layout-core";
import type { AutosizeOptions } from "@pretable-internal/layout-core";
import {
  createSourceRows,
  deriveVisibleRows,
  type SourceRow,
} from "./derived-rows";
import { isFilterActive } from "./evaluate-filter";
import { GROUP_COLUMN_ID, resolveEffectiveColumns } from "./group-column";
import {
  addGroupExpansionOverride,
  resolveGroupExpansionOverrideLimit,
} from "./group-expansion";
import type {
  ColumnFilter,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableDataRow,
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

/**
 * Group rows: focus targets, never selection or edit targets.
 *
 * A group row occupies a slot in the flat `visibleRows` list. It has no `row`
 * and its aggregate cells are derived, so it can never be selected, edited, or
 * pasted into — but it *is* reachable by keyboard, because a treegrid whose
 * expand/collapse controls cannot be focused is not operable. The two
 * populations therefore diverge:
 *
 * - `moveFocus` (and its page/edge variants) walks the FLAT list, so arrowing
 *   down from the last row of one group lands on the next group's header
 *   rather than stepping over it. Vertical movement preserves the focused
 *   column, so focus lands on that group's aggregate cell for the column the
 *   user was already in — see `PretableEngine.moveFocus`.
 * - `selectAll` spans the first through last *data* row, and
 *   `setSelectAllVisible` emits one full-row range per visible *data* row.
 *   Group rows sitting inside a range are covered positionally but are never
 *   reported as selected (`deriveSelectedRows` skips them). That is what
 *   {@link isDataRow} still guards.
 *
 * Because focus can now sit on a row that a visible-model mutation removes,
 * those mutators repair it — see
 * {@link reconcileFocusAfterVisibleModelChange}.
 */
function isDataRow<TRow extends PretableRow>(
  entry: PretableVisibleRow<TRow>,
): entry is PretableDataRow<TRow> {
  return entry.kind === "data";
}

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
 * A synthetic column leads its OWN region rather than the whole array. The
 * row-select column is pinned left by default, in which case those are the same
 * thing; but `rowSelectionColumn.pinned: false` makes it scrollable, and
 * forcing it to index 0 ahead of the left-pinned run would be the very desync
 * this helper exists to prevent. The derived group column
 * ({@link GROUP_COLUMN_ID}) is unpinned by default and follows the same rule.
 *
 * When both synthetics land in the same region, row-select comes first: it is
 * unshifted last, and `resolveEffectiveColumns` hands the group column in
 * ahead of it.
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
    if (column.id === ROW_SELECT_COLUMN_ID || column.id === GROUP_COLUMN_ID) {
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
  // Grouping inputs are cache keys too — without them a collapse or a level
  // change would keep serving the previous flattening.
  let cachedDerivedRowGroups: string[] | null = null;
  let cachedDerivedOverrides: ReadonlySet<string> | null = null;
  let cachedDerivedDefaultExpanded: boolean | null = null;
  let cachedDerivedAggregateFiltered: boolean | null = null;
  /**
   * The derived render column list, plus the two inputs it is a function of.
   *
   * Keyed on identity rather than nulled by hand in every mutator: every path
   * that changes the columns replaces `options.columns` wholesale (there is no
   * in-place column edit anywhere in this file), and `setRowGroups` replaces
   * `rowGroups` wholesale for the same reason the row cache keys on it. Keying
   * therefore covers `resetColumnLayout`, `autosizeColumns` and the autosize
   * re-measure inside `setRows` for free — three column writers that a
   * hand-maintained invalidation list would have had to remember.
   */
  let cachedEffectiveColumns: readonly PretableColumn<TRow>[] | null = null;
  let cachedEffectiveColumnsSource: readonly PretableColumn<TRow>[] | null =
    null;
  let cachedEffectiveColumnsRowGroups: readonly string[] | null = null;
  let sort: PretableSortEntry[] = [];
  let filters: Record<string, ColumnFilter> = {};
  // Grouping levels, outermost first. Seeded from `rowGroup: true` columns in
  // column order; `setRowGroups` replaces the array wholesale so the cache can
  // key on its identity.
  let rowGroups: string[] = sanitizeRowGroups(
    options.columns
      .filter((column) => column.rowGroup === true)
      .map((c) => c.id),
    options.columns,
  );
  /**
   * Group ids whose expanded state differs from `groupsDefaultExpanded` — NOT
   * "the collapsed ids". Under the default (`true`) the two coincide; once
   * `collapseAll` flips the default, the very same set holds the EXPANDED ids.
   * Always replaced, never mutated, so identity works as a cache key.
   *
   * Bounded: it holds the `groupExpansionOverrideLimit` most recently *decided*
   * ids, oldest decision evicted first. Not pruned against the current
   * flattening — see `group-expansion.ts` for why that distinction is the whole
   * point.
   */
  let groupExpansionOverrides: ReadonlySet<string> = new Set<string>();
  const groupExpansionOverrideLimit = resolveGroupExpansionOverrideLimit(
    options.groupExpansionOverrideLimit,
  );
  let groupsDefaultExpanded = options.groupsDefaultExpanded ?? true;
  /**
   * Previous `aggregates` object per group id. When a recompute produces an
   * equal object we hand back the previous reference, so downstream memoization
   * does not repaint every group row on every streaming tick.
   */
  let previousAggregates = new Map<string, Record<string, unknown>>();
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
    getColumns,
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
      let next: Record<string, ColumnFilter>;

      if (filter && isFilterActive(filter)) {
        if (current && columnFilterEqual(current, filter)) {
          return;
        }

        next = { ...filters, [columnId]: filter };
      } else {
        if (current === undefined) {
          return;
        }

        next = { ...filters };
        delete next[columnId];
      }

      const before = captureVisibleRowsForFocusReconciliation();
      filters = next;
      reconcileFocusAfterVisibleModelChange(before);
      emit();
    },
    clearFilters() {
      if (Object.keys(filters).length === 0) {
        return;
      }

      const before = captureVisibleRowsForFocusReconciliation();
      filters = {};
      reconcileFocusAfterVisibleModelChange(before);
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

      const before = captureVisibleRowsForFocusReconciliation();
      filters = normalized;
      reconcileFocusAfterVisibleModelChange(before);
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
      // Data rows only — see `isDataRow`. A grid showing nothing but collapsed
      // group rows has nothing to select.
      const dataRows = getSnapshot().visibleRows.filter(isDataRow);
      const firstRow = dataRows[0];
      const lastRow = dataRows[dataRows.length - 1];
      const effectiveColumns = getColumns();
      const firstColumn = effectiveColumns[0];
      const lastColumn = effectiveColumns[effectiveColumns.length - 1];

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
      const focusedRowId = focus.rowId;
      const focusedColumnId = focus.columnId;
      const focusedRow = focusedRowId
        ? getSnapshot().visibleRows.find((row) => row.id === focusedRowId)
        : undefined;
      const focusAddr =
        focusedRow?.kind === "group" || !focusedRowId || !focusedColumnId
          ? null
          : { rowId: focusedRowId, columnId: focusedColumnId };
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
      const visibleRow = getSnapshot().visibleRows.find(
        (row) => row.id === rowId,
      );
      if (visibleRow?.kind === "group") {
        return;
      }

      const effectiveColumns = getColumns();
      const firstColumn = effectiveColumns[0];
      const lastColumn = effectiveColumns[effectiveColumns.length - 1];

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
      // "All visible" means all visible DATA rows — see `isDataRow`.
      const dataRows = getSnapshot().visibleRows.filter(isDataRow);
      const effectiveColumns = getColumns();
      const firstColumn = effectiveColumns[0];
      const lastColumn = effectiveColumns[effectiveColumns.length - 1];

      if (!firstColumn || !lastColumn) {
        return;
      }

      const visibleIds = new Set(dataRows.map((r) => r.id));
      const nonRowRanges = selection.ranges.filter(
        (r) =>
          !isFullRowRange(r, r.startRowId, firstColumn.id, lastColumn.id) ||
          !visibleIds.has(r.startRowId),
      );

      let next: PretableSelectionState;

      if (checked) {
        const newRanges = dataRows.map<PretableCellRange>((row) => ({
          startRowId: row.id,
          endRowId: row.id,
          startColumnId: firstColumn.id,
          endColumnId: lastColumn.id,
        }));

        next = {
          ranges: [...nonRowRanges, ...newRanges],
          anchor: dataRows[0]
            ? { rowId: dataRows[0].id, columnId: firstColumn.id }
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
      // Keyboard navigation walks the FLAT visible list — group rows are
      // landed on, not stepped over (see `isDataRow`). Every row index below
      // is a position in `visibleRows`, never a data-row ordinal.
      const rowList = snapshot.visibleRows;
      const rowCount = rowList.length;
      // The DERIVED column list, so that focus can reach the group column and
      // cannot reach a column that grouping has hidden. Identical to
      // `options.columns` — by identity — while ungrouped.
      const columnList = getColumns();

      if (rowCount === 0 || columnList.length === 0) {
        focus = { rowId: null, columnId: null };
        emit();
        return;
      }

      const currentRowIndex =
        focus.rowId === null
          ? -1
          : rowList.findIndex((entry) => entry.id === focus.rowId);

      const currentColumnIndex = focus.columnId
        ? columnList.findIndex((c) => c.id === focus.columnId)
        : -1;

      const hasRowFocus = currentRowIndex !== -1;
      const hasColumnFocus = currentColumnIndex !== -1;
      const baseRowIndex = hasRowFocus ? currentRowIndex : 0;
      const baseColumnIndex = hasColumnFocus ? currentColumnIndex : 0;

      let nextRowIndex = baseRowIndex;
      let nextColumnIndex = baseColumnIndex;

      const pageStep = computePageStep(viewport, rowCount);

      // When focus is null on the relevant axis, the move lands on the edge
      // implied by the direction (down/right → 0; up/left → length-1) without
      // applying a step, so the user "arrives" at the grid before navigating.
      switch (direction) {
        case "up":
          if (moveOptions.jumpToEdge) {
            nextRowIndex = 0;
          } else if (!hasRowFocus) {
            nextRowIndex = rowCount - 1;
          } else if (moveOptions.byPage) {
            nextRowIndex = clamp(baseRowIndex - pageStep, 0, rowCount - 1);
          } else {
            nextRowIndex = clamp(baseRowIndex - 1, 0, rowCount - 1);
          }
          break;
        case "down":
          if (moveOptions.jumpToEdge) {
            nextRowIndex = rowCount - 1;
          } else if (!hasRowFocus) {
            nextRowIndex = 0;
          } else if (moveOptions.byPage) {
            nextRowIndex = clamp(baseRowIndex + pageStep, 0, rowCount - 1);
          } else {
            nextRowIndex = clamp(baseRowIndex + 1, 0, rowCount - 1);
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

      const nextRow = rowList[nextRowIndex];
      const nextColumn = columnList[nextColumnIndex];

      if (!nextRow || !nextColumn) {
        return;
      }

      const nextAddr: PretableCellAddress = {
        rowId: nextRow.id,
        columnId: nextColumn.id,
      };

      focus = nextAddr;

      if (isDataRow(nextRow)) {
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
      const layoutChanged = !sameColumnLayout(options.columns, grouped);
      const groupingSemanticsChanged = !sameColumnGroupingSemantics(
        options.columns,
        grouped,
      );
      const before = groupingSemanticsChanged
        ? captureVisibleRowsForFocusReconciliation()
        : null;
      originalColumns = groupColumnsByPin(nextColumns).map((c) => ({ ...c }));
      options = { ...options, columns: grouped };

      const nextRowGroups = sanitizeRowGroups(rowGroups, grouped);
      const sanitizedGroupingChanged = !stringListsEqual(
        rowGroups,
        nextRowGroups,
      );
      if (sanitizedGroupingChanged) {
        rowGroups = nextRowGroups;
        groupExpansionOverrides = new Set<string>();
      }

      if (groupingSemanticsChanged) {
        cachedVisibleRows = null;
        reconcileFocusAfterVisibleModelChange(before);
      }

      // Callers hand us a fresh array whenever `columns` is written inline, so
      // only wake subscribers when something they can observe actually moved.
      // The merged definitions are stored either way, which is what keeps a
      // re-created `value`/`format` closure from going stale.
      if (
        layoutChanged ||
        groupingSemanticsChanged ||
        sanitizedGroupingChanged
      ) {
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
      const before = captureVisibleRowsForFocusReconciliation();

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
      reconcileFocusAfterVisibleModelChange(before);
      emit();
    },
    setRows(nextRows: TRow[]) {
      const before = captureVisibleRowsForFocusReconciliation();
      options = { ...options, rows: nextRows };
      sourceRows = createSourceRows(options);
      sourceRowIndex.clear();
      for (const entry of sourceRows) {
        sourceRowIndex.set(entry.id, entry);
      }

      // Selection and editing are keyed by source-row id and intentionally
      // survive a row replacement. Focus is reconciled against the derived
      // visible model below because it may target a group row instead.
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
      reconcileFocusAfterVisibleModelChange(before);
      emit();
    },
    setRowGroups(columnIds: readonly string[]) {
      const next = sanitizeRowGroups(columnIds, options.columns);

      if (stringListsEqual(rowGroups, next)) {
        return;
      }

      const before = captureVisibleRowsForFocusReconciliation();
      rowGroups = next;
      // Expansion ids are path-derived, so changing the levels invalidates
      // them. v1 drops the whole set rather than trying to salvage prefixes.
      groupExpansionOverrides = new Set<string>();
      reconcileFocusAfterVisibleModelChange(before);
      emit();
    },
    toggleGroup(groupId: string) {
      store.setGroupExpanded(groupId, !isGroupExpanded(groupId));
    },
    setGroupExpanded(groupId: string, expanded: boolean) {
      if (isGroupExpanded(groupId) === expanded) {
        return;
      }

      const before = captureVisibleRowsForFocusReconciliation();

      if (expanded === groupsDefaultExpanded) {
        const next = new Set(groupExpansionOverrides);
        next.delete(groupId);
        groupExpansionOverrides = next;
      } else {
        groupExpansionOverrides = addGroupExpansionOverride(
          groupExpansionOverrides,
          groupId,
          groupExpansionOverrideLimit,
        );
      }

      reconcileFocusAfterVisibleModelChange(before, {
        preferAncestor: !expanded,
      });
      emit();
    },
    expandAll() {
      setExpansionDefault(true);
    },
    collapseAll() {
      setExpansionDefault(false);
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

  /** Expanded state of one group id under the current default + overrides. */
  function isGroupExpanded(groupId: string): boolean {
    return groupExpansionOverrides.has(groupId)
      ? !groupsDefaultExpanded
      : groupsDefaultExpanded;
  }

  /**
   * `expandAll`/`collapseAll` flip the default and clear the overrides rather
   * than enumerate ids — which is what makes them apply to groups that do not
   * exist yet, including ones that arrive mid-stream.
   */
  function setExpansionDefault(expanded: boolean): void {
    if (
      groupsDefaultExpanded === expanded &&
      groupExpansionOverrides.size === 0
    ) {
      return;
    }

    const before = captureVisibleRowsForFocusReconciliation();

    groupsDefaultExpanded = expanded;
    groupExpansionOverrides = new Set<string>();
    reconcileFocusAfterVisibleModelChange(before, {
      preferAncestor: !expanded,
    });
    emit();
  }

  /** Avoid deriving the old visible model when there is no focus to repair. */
  function captureVisibleRowsForFocusReconciliation():
    readonly PretableVisibleRow<TRow>[] | null {
    return focus.rowId === null && focus.columnId === null
      ? null
      : getSnapshot().visibleRows;
  }

  /**
   * Keep non-null focus valid after any change to the derived row or column
   * model. Surviving ids win; otherwise row position is retained as closely as
   * possible and a hidden grouped column moves to the synthetic group column.
   * Collapses additionally prefer the nearest surviving ancestor so focus does
   * not jump sideways into a neighboring branch.
   */
  function reconcileFocusAfterVisibleModelChange(
    before: readonly PretableVisibleRow<TRow>[] | null,
    options: { preferAncestor?: boolean } = {},
  ): void {
    if (before === null || (focus.rowId === null && focus.columnId === null)) {
      return;
    }

    const oldRowId = focus.rowId;
    const oldIndex =
      oldRowId === null
        ? -1
        : before.findIndex((entry) => entry.id === oldRowId);

    // `cachedSnapshot` still describes the pre-mutation model. Clear it before
    // deriving the new visible rows, then clear it again after repairing focus.
    cachedSnapshot = null;
    const afterRows = getSnapshot().visibleRows;
    const afterColumns = getColumns();

    if (afterRows.length === 0 || afterColumns.length === 0) {
      focus = { rowId: null, columnId: null };
      cachedSnapshot = null;
      return;
    }

    const survivingRowIds = new Set(afterRows.map((entry) => entry.id));
    let nextRowId =
      oldRowId !== null && survivingRowIds.has(oldRowId) ? oldRowId : null;

    if (
      nextRowId === null &&
      options.preferAncestor === true &&
      oldIndex !== -1
    ) {
      const oldDepth = before[oldIndex]!.depth;

      for (let i = oldIndex - 1; i >= 0; i -= 1) {
        const candidate = before[i]!;
        if (
          candidate.kind === "group" &&
          candidate.depth < oldDepth &&
          survivingRowIds.has(candidate.id)
        ) {
          nextRowId = candidate.id;
          break;
        }
      }
    }

    if (nextRowId === null) {
      const nextIndex =
        oldIndex === -1 ? 0 : clamp(oldIndex, 0, afterRows.length - 1);
      nextRowId = afterRows[nextIndex]!.id;
    }

    const focusedColumnSurvives =
      focus.columnId !== null &&
      afterColumns.some((column) => column.id === focus.columnId);
    const groupColumn =
      rowGroups.length > 0
        ? afterColumns.find((column) => column.id === GROUP_COLUMN_ID)
        : undefined;
    const nextColumnId = focusedColumnSurvives
      ? focus.columnId!
      : (groupColumn?.id ?? afterColumns[0]!.id);

    focus = { rowId: nextRowId, columnId: nextColumnId };
    cachedSnapshot = null;
  }

  /**
   * Hand back the previous `aggregates` object whenever a recompute produced an
   * equal one. Aggregates finalize to plain scalars, so an own-key walk with
   * `Object.is` is a full comparison, not a shallow approximation.
   *
   * The map is rebuilt from the current flattening each pass, so ids for groups
   * that have gone away do not accumulate.
   */
  function preserveAggregateIdentity(
    rows: PretableVisibleRow<TRow>[],
  ): PretableVisibleRow<TRow>[] {
    const next = new Map<string, Record<string, unknown>>();
    let result = rows;

    for (let i = 0; i < rows.length; i += 1) {
      const entry = rows[i]!;
      if (entry.kind !== "group") continue;

      const previous = previousAggregates.get(entry.id);

      if (previous && recordsEqual(previous, entry.aggregates)) {
        // Copy-on-write: `rows` came straight from `buildGroupedRows`, but the
        // ungrouped short-circuit path has no group rows at all, so this only
        // ever clones a list that actually carries them.
        if (result === rows) result = rows.slice();
        result[i] = { ...entry, aggregates: previous };
        next.set(entry.id, previous);
      } else {
        next.set(entry.id, entry.aggregates);
      }
    }

    previousAggregates = next;
    return result;
  }

  /**
   * The render column list — see `PretableEngine.getColumns`. Derived on read
   * and cached, never stored in `options.columns`: `mergeColumnsFromProps`
   * rebuilds that array from the consumer's own, so a synthetic column pushed
   * into it would be dropped on the next prop identity change.
   */
  function getColumns(): readonly PretableColumn<TRow>[] {
    if (
      cachedEffectiveColumns !== null &&
      cachedEffectiveColumnsSource === options.columns &&
      cachedEffectiveColumnsRowGroups === rowGroups
    ) {
      return cachedEffectiveColumns;
    }

    const resolved = resolveEffectiveColumns({
      columns: options.columns,
      rowGroups,
      groupColumn: options.groupColumn,
      hideGroupedColumns: options.hideGroupedColumns,
    });
    // Ungrouped, `resolved` IS `options.columns`, which is already grouped by
    // pin — regrouping would only churn identity. Grouped, the freshly
    // prepended synthetic column has to be seated in its own region.
    const effective =
      resolved === options.columns ? resolved : groupColumnsByPin(resolved);

    cachedEffectiveColumns = effective;
    cachedEffectiveColumnsSource = options.columns;
    cachedEffectiveColumnsRowGroups = rowGroups;

    return effective;
  }

  function getSnapshot(): PretableGridSnapshot<TRow> {
    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    const aggregateFilteredRows = options.aggregateFilteredRows ?? false;
    const derivedIsFresh =
      cachedVisibleRows !== null &&
      cachedDerivedSort === sort &&
      cachedDerivedFilters === filters &&
      cachedDerivedRowGroups === rowGroups &&
      cachedDerivedOverrides === groupExpansionOverrides &&
      cachedDerivedDefaultExpanded === groupsDefaultExpanded &&
      cachedDerivedAggregateFiltered === aggregateFilteredRows;

    const visibleRows = derivedIsFresh
      ? cachedVisibleRows!
      : preserveAggregateIdentity(
          deriveVisibleRows({
            columns: options.columns,
            filters,
            rows: sourceRows,
            sort,
            rowGroups,
            groupExpansionOverrides,
            groupsDefaultExpanded,
            aggregateFilteredRows,
          }),
        );

    cachedVisibleRows = visibleRows;
    cachedDerivedSort = sort;
    cachedDerivedFilters = filters;
    cachedDerivedRowGroups = rowGroups;
    cachedDerivedOverrides = groupExpansionOverrides;
    cachedDerivedDefaultExpanded = groupsDefaultExpanded;
    cachedDerivedAggregateFiltered = aggregateFilteredRows;

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
      rowGroups: [...rowGroups],
      groupExpansionOverrides: new Set(groupExpansionOverrides),
      groupsDefaultExpanded,
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

/**
 * Compare only the column fields that feed grouped-row derivation.
 *
 * `formatAggregate` is display-only and React renders it from fresh props;
 * `rowGroup` seeds the initial state but does not control it after creation.
 * Keeping both out of this comparison avoids unnecessary engine emissions.
 */
function sameColumnGroupingSemantics<TRow extends PretableRow>(
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
      left.value === right.value &&
      left.aggregate === right.aggregate
    );
  });
}

function computePageStep(
  viewport: { height: number },
  rowCount: number,
): number {
  if (viewport.height <= 0 || rowCount === 0) {
    return 1;
  }

  // 32px = default row-height heuristic; the React adapter overrides this
  // with measured row heights in Phase 2.
  const estimatedRowsPerPage = Math.max(
    1,
    Math.floor((viewport.height * 0.8) / 32),
  );

  // The step counts entries in the flat visible list — the same population
  // `moveFocus` walks — so an interleaved group header costs a page step
  // exactly as much as it costs a row of rendered height. Row heights are
  // uniform across kinds, so the two stay in step.
  return Math.min(estimatedRowsPerPage, rowCount);
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

/**
 * Drop grouping levels that name an unknown column, and collapse repeats — a
 * column listed twice would otherwise build a second level whose every group
 * has exactly one child.
 */
function sanitizeRowGroups<TRow extends PretableRow>(
  columnIds: readonly string[],
  columns: PretableColumn<TRow>[],
): string[] {
  const known = new Set(columns.map((column) => column.id));
  const seen = new Set<string>();
  const next: string[] = [];

  for (const columnId of columnIds) {
    if (!known.has(columnId) || seen.has(columnId)) continue;
    seen.add(columnId);
    next.push(columnId);
  }

  return next;
}

function stringListsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Own-key equality over finalized aggregate values (all plain scalars). */
function recordsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);

  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }

  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]),
  );
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
