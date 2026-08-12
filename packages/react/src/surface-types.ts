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

/** Cell address used by controlled surface interaction state. @public */
export interface PretableSurfaceCellAddress<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  rowId: TRowId;
  columnId: PretableSurfaceInteractionColumnId<TColumns>;
}

/** Inclusive cell range used by controlled surface selection state. @public */
export interface PretableSurfaceCellRange<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  startRowId: TRowId;
  endRowId: TRowId;
  startColumnId: PretableSurfaceInteractionColumnId<TColumns>;
  endColumnId: PretableSurfaceInteractionColumnId<TColumns>;
}

/** Controlled cell-range selection state accepted by the surface. @public */
export interface PretableSurfaceSelectionState<
  TRowId extends PretableRowId = string,
  TColumns = readonly { readonly id: string }[],
> {
  ranges: PretableSurfaceCellRange<TRowId, TColumns>[];
  anchor: PretableSurfaceCellAddress<TRowId, TColumns> | null;
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
  selection?: PretableSurfaceSelectionState<TRowId, TColumns>;
  columnWidths?: Partial<Record<PretableSurfaceColumnId<TColumns>, number>>;
  columnOrder?: readonly PretableSurfaceColumnId<TColumns>[];
  columnPinned?: Partial<
    Record<PretableSurfaceColumnId<TColumns>, "left" | "right" | null>
  >;
}
