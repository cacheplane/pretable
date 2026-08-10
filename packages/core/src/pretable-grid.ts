import type {
  AutosizeOptions,
  ColumnFilter,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusDirection,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableMoveFocusOptions,
  PretableResultMeta,
  PretableRow,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortEntry,
  PretableTransaction,
  PretableViewportState,
} from "@pretable-internal/grid-core";

/**
 * Public handle returned by {@link createGrid}. Exposes every action and
 * observation pretable promises to support; does not extend the internal
 * engine type, so private methods cannot leak through the public surface.
 *
 * @public
 */
export interface PretableGrid<TRow extends PretableRow = PretableRow> {
  /** Discriminator — distinguishes `PretableGrid` from arbitrary objects. */
  readonly kind: "pretable-grid";

  /** The options the grid was constructed with. */
  readonly options: PretableGridOptions<TRow>;

  /** Subscribe to grid mutations. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  /** Read the current snapshot. Stable reference until the next mutation. */
  getSnapshot(): PretableGridSnapshot<TRow>;

  /**
   * The columns to draw: `options.columns` plus the derived group column, minus
   * the grouped columns, while grouping is active. Identical to
   * `options.columns` — by identity — when ungrouped. Stable reference until
   * the columns or the grouping levels change.
   */
  getColumns(): readonly PretableColumn<TRow>[];

  // sort / filter
  setSort(columnId: string | null, direction: PretableSortDirection): void;
  /** Atomically replace the ordered sort list. Unknown and `sortable: false` columns are dropped. */
  replaceSort(entries: PretableSortEntry[]): void;
  setColumnFilter(columnId: string, filter: ColumnFilter | null): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, ColumnFilter>): void;
  /**
   * The distinct values a column takes across the LOADED records — never a
   * claim about the matching population. Under external filter authority the
   * loaded records are a window onto the result set, so this list can omit
   * values the user would need to filter for; declare `column.options` to give
   * an enum filter its full universe. The surface dev-warns when a funnel menu
   * falls back to this list in that mode.
   */
  distinctColumnValues(columnId: string): string[];

  // selection
  setSelection(state: PretableSelectionState): void;
  selectAll(): void;
  clearSelection(): void;
  addRange(range: PretableCellRange): void;
  extendRangeFromAnchor(addr: PretableCellAddress): void;
  toggleRowSelection(rowId: string): void;
  setSelectAllVisible(checked: boolean): void;

  // focus
  setFocus(addr: PretableCellAddress | null): void;
  moveFocus(
    direction: PretableFocusDirection,
    options?: PretableMoveFocusOptions,
  ): void;

  // row grouping
  /**
   * Replace the grouping levels, outermost first; `[]` ungroups. Ids that do
   * not match a column are dropped, and expansion state for groups that no
   * longer exist is pruned.
   */
  setRowGroups(columnIds: readonly string[]): void;
  /** Flip one group's expanded state. Unknown ids are still recorded. */
  toggleGroup(groupId: string): void;
  /** Set one group's expanded state explicitly. */
  setGroupExpanded(groupId: string, expanded: boolean): void;
  /** Expand every group, including ones that do not exist yet. */
  expandAll(): void;
  /** Collapse every group, including ones that do not exist yet. */
  collapseAll(): void;

  // viewport
  setViewport(viewport: PretableViewportState): void;

  // column layout
  autosizeColumns(options?: AutosizeOptions): void;
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  /**
   * Set the relative order of the columns. Ids that do not match a column are
   * ignored, and columns absent from `ids` keep their current relative order at
   * the end. Pin state is never read from `ids` nor changed: the result is
   * regrouped into `[pinned "left"…, unpinned…, pinned "right"…]`, so an order
   * that interleaves pinned and unpinned columns is normalised rather than
   * honoured literally.
   */
  setColumnOrder(ids: readonly string[]): void;
  setColumnPinned(columnId: string, pinned: "left" | "right" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
  mergeColumnsFromProps(nextColumns: PretableColumn<TRow>[]): void;

  // streaming
  applyTransaction(transaction: PretableTransaction<TRow>): void;
  /**
   * Replace the full row set in place. Unlike recreating the grid, this
   * preserves selection and focus (both keyed by row id), dropping only the
   * references whose rows are no longer present. Suited to high-frequency
   * updates where row identities are stable.
   */
  setRows(rows: TRow[], meta?: PretableResultMeta): void;
  /**
   * Update result metadata without a rows replacement — a late-arriving exact
   * count, say. Avoids forcing a fake rows-identity change.
   *
   * @experimental
   */
  setResultMeta(meta: PretableResultMeta): void;

  // cell editing (v1)
  beginEdit(
    addr: PretableCellAddress,
    opts?: { draft?: unknown; status?: "checking" | "editing" },
  ): void;
  setEditDraft(value: unknown): void;
  markEditing(): void;
  markEditValidating(): void;
  markEditSaving(): void;
  markEditInvalid(message: string): void;
  markEditError(message: string): void;
  commitEditSucceeded(): void;
  cancelEdit(): void;
}
