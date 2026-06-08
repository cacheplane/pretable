import type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusDirection,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableMoveFocusOptions,
  PretableRow,
  PretableSelectionState,
  PretableSortDirection,
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

  // sort / filter
  setSort(columnId: string | null, direction: PretableSortDirection): void;
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, string>): void;

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

  // viewport
  setViewport(viewport: PretableViewportState): void;

  // column layout
  autosizeColumns(options?: AutosizeOptions): void;
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  setColumnPinned(columnId: string, pinned: "left" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
  mergeColumnsFromProps(nextColumns: PretableColumn<TRow>[]): void;

  // streaming
  applyTransaction(transaction: PretableTransaction<TRow>): void;

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
