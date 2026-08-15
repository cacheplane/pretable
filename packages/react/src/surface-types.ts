import type {
  PretableGroupId,
  PretableIndexedFocusRef,
  PretableRowId,
  PretableRowSelectionState,
} from "@pretable/core";

/** Column id accepted by a surface backed by `TColumns`. @public */
export type PretableSurfaceColumnId<TColumns> =
  TColumns extends readonly (infer TColumn)[]
    ? TColumn extends { readonly id: infer TColumnId extends string }
      ? TColumnId
      : never
    : never;

/** Schema and synthetic column ids that can participate in interaction state. @public */
export type PretableSurfaceInteractionColumnId<TColumns> =
  | PretableSurfaceColumnId<TColumns>
  | "__pretable_group__"
  | "__pretable_row_select__";

/**
 * Cell address used by controlled surface interaction state, narrowed to a
 * column tuple — the `columnId` companion to {@link PretableSelectionFor}.
 * Mirrors the `XFor<TColumns>` shape of `PretableQueryFor` et al. from
 * `@pretable/core`, with `TRowId` a defaulted second parameter since
 * addresses (unlike queries) reference rows.
 * @public
 */
export interface PretableCellAddressFor<
  TColumns,
  TRowId extends PretableRowId = string,
> {
  rowId: TRowId;
  columnId: PretableSurfaceInteractionColumnId<TColumns>;
}

/**
 * Inclusive cell range used by controlled surface selection state, narrowed
 * to a column tuple. See {@link PretableCellAddressFor}.
 * @public
 */
export interface PretableCellRangeFor<
  TColumns,
  TRowId extends PretableRowId = string,
> {
  startRowId: TRowId;
  endRowId: TRowId;
  startColumnId: PretableSurfaceInteractionColumnId<TColumns>;
  endColumnId: PretableSurfaceInteractionColumnId<TColumns>;
}

/**
 * Controlled cell-range selection state accepted by the surface, narrowed to
 * a column tuple — write this as the type of a hand-declared
 * `useState<PretableSelectionFor<typeof columns>>` when controlling
 * selection. Column ids typo-check against `TColumns` the same way
 * `PretableQueryFor<TColumns>` checks a controlled query.
 *
 * `@pretable/core`'s `PretableSelectionState` is the loose, id-as-`string`
 * counterpart the underlying engine and any code working from drawn column
 * ids (not a static column tuple) should use instead.
 *
 * This is the CELL-RANGE slice only. The `rowSelectionColumn` checkboxes are
 * a separate engine slice — a sparse row-selection program that can hold "all
 * rows" without materializing them, which a list of (start, end) cell
 * addresses cannot express. Controlling `selection` therefore neither reads
 * nor writes the checked set: ticking a checkbox does not fire
 * `onSelectionChange`, and resetting `selection` to an empty `ranges` list
 * with a null `anchor` does not untick anything. The checked set has its own
 * controlled slice, `state.rowSelection`, typed
 * {@link PretableSurfaceState.rowSelection | PretableRowSelectionState}; read
 * it back with `onRowSelectionChange`, and clear both slices at once with the
 * grid handle's `clearSelection()` from `onGridReady`.
 * @public
 */
export interface PretableSelectionFor<
  TColumns,
  TRowId extends PretableRowId = string,
> {
  ranges: PretableCellRangeFor<TColumns, TRowId>[];
  anchor: PretableCellAddressFor<TColumns, TRowId> | null;
}

/**
 * Controlled focused cell accepted by the surface, and the shape
 * `onFocusChange` reports.
 *
 * `ref` is a {@link PretableIndexedFocusRef}, not a
 * {@link PretableVisibleRowRef}: the cursor can sit on a column HEADER
 * (`{kind: "header"}`) as well as on a data or group row, and the header is
 * reached with ArrowUp from the first row rather than with Tab. A consumer
 * switching on `ref.kind` has three cases, and one that only handles `"data"`
 * and `"group"` should say what it does with the third rather than assume the
 * cursor is on a row.
 *
 * @public
 */
export interface PretableSurfaceFocusState<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  ref: PretableIndexedFocusRef<TRowId> | null;
  columnId: PretableSurfaceInteractionColumnId<TColumns> | null;
}

/** Telemetry numbers about the current indexed render. @public */
export interface PretableTelemetry<TRowId extends PretableRowId = string> {
  focusedRowId: TRowId | PretableGroupId | null;
  /** Number of source records currently loaded into the indexed model. */
  loadedRowCount: number;
  rowModelRowCount: number;
  renderedRowCount: number;
  selectedRowId: TRowId | null;
  totalRowCount: number;
  totalHeight: number;
  visibleRowCount: number;
  visibleRowRange: { end: number; start: number };
  /**
   * The viewport is over rows that were not supplied. The GRID computes this,
   * because the grid owns the geometry — a consumer deriving it from
   * `visibleRowRange` and a threshold is reconstructing what is already known.
   */
  windowGap?: {
    readonly direction: "before" | "after";
    readonly rowCount: number;
  };
}

/** Controlled interaction and layout slices accepted by the surface. @public */
export interface PretableSurfaceState<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  focus?: PretableSurfaceFocusState<TRowId, TColumns>;
  selection?: PretableSelectionFor<TColumns, TRowId>;
  /**
   * The `rowSelectionColumn` checkboxes — the slice `onRowSelectionChange`
   * reports, and the one `selection` cannot describe.
   *
   * Written to the engine when the VALUE changes (or when the row model
   * publishes a new snapshot, since which rows a request can reach depends on
   * it), not on every render. That is what lets it pair with
   * `onRowSelectionChange`, which fires from an effect rather than from the
   * click: re-asserting a value the consumer has not echoed yet would untick
   * the row the user just ticked, and the callback would then report the untick
   * — one generation behind forever.
   *
   * Feed `onRowSelectionChange`'s ids straight back as
   * `{ kind: "explicit", rowIds }`. To keep a SYMBOLIC selection symbolic — a
   * select-all, or a shift-checked span — take
   * `describeRowSelection(grid.getState().selection.rows)` from `onGridReady`
   * instead; flattening either one to ids is what this slice exists to avoid.
   */
  rowSelection?: PretableRowSelectionState<TRowId>;
  /**
   * The three layout slices address DRAWN columns, so they are typed with
   * {@link PretableSurfaceInteractionColumnId} — schema ids plus the two
   * synthetic ids — exactly like `focus` and `selection`.
   *
   * `columnOrder` in particular has to be: it is applied only when it covers
   * the drawn layout exactly (same length, every id present), and the drawn
   * layout contains `__pretable_row_select__` whenever `rowSelectionColumn` is
   * enabled and `__pretable_group__` whenever rows are grouped. Typed to
   * schema ids alone, a consumer with checkboxes on could not write an order
   * that passes that gate, and the slice was silently inert for them.
   */
  columnWidths?: Partial<
    Record<PretableSurfaceInteractionColumnId<TColumns>, number>
  >;
  columnOrder?: readonly PretableSurfaceInteractionColumnId<TColumns>[];
  columnPinned?: Partial<
    Record<
      PretableSurfaceInteractionColumnId<TColumns>,
      "left" | "right" | null
    >
  >;
}
