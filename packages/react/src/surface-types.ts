import type {
  PretableGroupId,
  PretableRowId,
  PretableVisibleRowRef,
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
 * @public
 */
export interface PretableSelectionFor<
  TColumns,
  TRowId extends PretableRowId = string,
> {
  ranges: PretableCellRangeFor<TColumns, TRowId>[];
  anchor: PretableCellAddressFor<TColumns, TRowId> | null;
}

/** Controlled focused cell accepted by the surface. @public */
export interface PretableSurfaceFocusState<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  ref: PretableVisibleRowRef<TRowId> | null;
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
}

/** Controlled interaction and layout slices accepted by the surface. @public */
export interface PretableSurfaceState<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  focus?: PretableSurfaceFocusState<TRowId, TColumns>;
  selection?: PretableSelectionFor<TColumns, TRowId>;
  columnWidths?: Partial<Record<PretableSurfaceColumnId<TColumns>, number>>;
  columnOrder?: readonly PretableSurfaceColumnId<TColumns>[];
  columnPinned?: Partial<
    Record<PretableSurfaceColumnId<TColumns>, "left" | "right" | null>
  >;
}
