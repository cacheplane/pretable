import type { ReactNode } from "react";
import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableAggregateOutputOf,
  PretableAggregateSpec,
  PretableColumnCallbackContext,
  PretableColumnDefinition,
  PretableColumnOptions,
  PretableColumnTypeFor,
  PretableColumn as PretableBaseColumn,
  PretableEditInput,
  PretableEditStatus,
  PretableFocusDirection,
  PretableGridFormatInput,
  PretableRow,
  PretableRowId,
} from "@pretable/core";

declare module "@pretable/core" {
  interface PretableColumnHelper<TRow extends object> {
    accessor<
      const TKey extends Extract<keyof TRow, string>,
      const TType extends PretableColumnTypeFor<TRow[TKey]>,
      const TAggregate extends
        PretableAggregateSpec<TRow, TRow[TKey]> | undefined = undefined,
    >(
      key: TKey,
      options: PretableColumnOptions<
        TRow,
        TKey,
        TRow[TKey],
        TType,
        TAggregate
      > & {
        readonly editable: true;
        readonly setValue?: never;
      },
    ): PretableColumnDefinition<TRow, TKey, TRow[TKey], TType, TAggregate> & {
      readonly editable: true;
    };

    accessor<
      const TId extends string,
      const TValue,
      const TType extends PretableColumnTypeFor<TValue>,
      const TAggregate extends PretableAggregateSpec<TRow, TValue> | undefined =
        undefined,
    >(
      id: TId,
      accessor: (row: TRow) => TValue,
      options: {
        readonly type: TType;
        readonly header?: string;
        readonly compare?: (left: TValue, right: TValue) => number;
        readonly aggregate?: TAggregate;
        readonly format?: (input: {
          readonly value: TValue;
          readonly row: TRow;
          readonly column: PretableColumnCallbackContext<
            TRow,
            TId,
            TValue,
            TType,
            TAggregate
          >;
        }) => string;
        readonly formatAggregate?: (input: {
          readonly value: PretableAggregateOutputOf<TAggregate>;
          readonly column: PretableColumnCallbackContext<
            TRow,
            TId,
            TValue,
            TType,
            TAggregate
          >;
        }) => string;
        readonly editable: true;
        readonly setValue: (
          input: PretableSetValueInput<TRow, TValue>,
        ) => Partial<TRow>;
        readonly render?: (input: {
          readonly row: TRow;
          readonly rowId: TRow extends {
            readonly id: infer TRowId extends PretableRowId;
          }
            ? TRowId
            : PretableRowId;
          readonly value: TValue;
          readonly column: PretableColumnCallbackContext<
            TRow,
            TId,
            TValue,
            TType,
            TAggregate
          >;
        }) => ReactNode;
      },
    ): PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate> & {
      readonly editable: true;
      readonly setValue: (
        input: PretableSetValueInput<TRow, TValue>,
      ) => Partial<TRow>;
      readonly render?: (input: {
        readonly row: TRow;
        readonly rowId: TRow extends {
          readonly id: infer TRowId extends PretableRowId;
        }
          ? TRowId
          : PretableRowId;
        readonly value: TValue;
        readonly column: PretableColumnCallbackContext<
          TRow,
          TId,
          TValue,
          TType,
          TAggregate
        >;
      }) => ReactNode;
    };

    accessor<
      const TKey extends Extract<keyof TRow, string>,
      const TType extends PretableColumnTypeFor<TRow[TKey]>,
      const TAggregate extends
        PretableAggregateSpec<TRow, TRow[TKey]> | undefined = undefined,
    >(
      key: TKey,
      options: PretableColumnOptions<
        TRow,
        TKey,
        TRow[TKey],
        TType,
        TAggregate
      > & {
        readonly editable?: boolean;
        readonly widthPx?: number;
        readonly pinned?: "left" | "right";
        readonly wrap?: boolean;
        readonly render: (input: {
          readonly row: TRow;
          readonly rowId: TRow extends {
            readonly id: infer TRowId extends PretableRowId;
          }
            ? TRowId
            : PretableRowId;
          readonly value: TRow[TKey];
          readonly column: PretableColumnCallbackContext<
            TRow,
            TKey,
            TRow[TKey],
            TType,
            TAggregate
          >;
        }) => ReactNode;
      },
    ): PretableColumnDefinition<TRow, TKey, TRow[TKey], TType, TAggregate> & {
      readonly editable?: boolean;
      readonly widthPx?: number;
      readonly pinned?: "left" | "right";
      readonly wrap?: boolean;
      readonly render: (input: {
        readonly row: TRow;
        readonly rowId: TRow extends {
          readonly id: infer TRowId extends PretableRowId;
        }
          ? TRowId
          : PretableRowId;
        readonly value: TRow[TKey];
        readonly column: PretableColumnCallbackContext<
          TRow,
          TKey,
          TRow[TKey],
          TType,
          TAggregate
        >;
      }) => ReactNode;
    };

    accessor<
      const TId extends string,
      const TValue,
      const TType extends PretableColumnTypeFor<TValue>,
      const TAggregate extends PretableAggregateSpec<TRow, TValue> | undefined =
        undefined,
    >(
      id: TId,
      accessor: (row: TRow) => TValue,
      options: {
        readonly type: TType;
        readonly header?: string;
        readonly compare?: (left: TValue, right: TValue) => number;
        readonly aggregate?: TAggregate;
        readonly editable?: false;
        readonly setValue?: never;
        readonly widthPx?: number;
        readonly pinned?: "left" | "right";
        readonly wrap?: boolean;
        readonly render: (input: {
          readonly row: TRow;
          readonly rowId: TRow extends {
            readonly id: infer TRowId extends PretableRowId;
          }
            ? TRowId
            : PretableRowId;
          readonly value: TValue;
          readonly column: PretableColumnCallbackContext<
            TRow,
            TId,
            TValue,
            TType,
            TAggregate
          >;
        }) => ReactNode;
      },
    ): PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate> & {
      readonly editable?: false;
      readonly widthPx?: number;
      readonly pinned?: "left" | "right";
      readonly wrap?: boolean;
      readonly render: (input: {
        readonly row: TRow;
        readonly rowId: TRow extends {
          readonly id: infer TRowId extends PretableRowId;
        }
          ? TRowId
          : PretableRowId;
        readonly value: TValue;
        readonly column: PretableColumnCallbackContext<
          TRow,
          TId,
          TValue,
          TType,
          TAggregate
        >;
      }) => ReactNode;
    };
  }
}

/** Value inferred from a typed Pretable column definition. @public */
export type PretableColumnValue<TColumn> = TColumn extends {
  readonly accessor: (row: object) => infer TValue;
}
  ? TValue
  : TColumn extends {
        readonly accessor: (...args: never[]) => infer TValue;
      }
    ? TValue
    : never;

/** Row inferred from a typed Pretable column definition. @public */
export type PretableColumnRow<TColumn> = TColumn extends {
  readonly accessor: (row: infer TRow extends object) => unknown;
}
  ? TRow
  : never;

/** Reverse-mapping requirement inferred from a typed column. @public */
export type PretableEditableColumnRequirement<TColumn> = TColumn extends {
  readonly editable: true;
  readonly id: infer TId extends string;
}
  ? TId extends keyof PretableColumnRow<TColumn>
    ? {
        readonly setValue?: (
          input: PretableSetValueInput<
            PretableColumnRow<TColumn>,
            PretableColumnValue<TColumn>
          >,
        ) => Partial<PretableColumnRow<TColumn>>;
      }
    : {
        readonly setValue: (
          input: PretableSetValueInput<
            PretableColumnRow<TColumn>,
            PretableColumnValue<TColumn>
          >,
        ) => Partial<PretableColumnRow<TColumn>>;
      }
  : Record<never, never>;

/** Input to a computed editable column's reverse mapping. @public */
export interface PretableSetValueInput<TRow extends object, TValue> {
  readonly row: TRow;
  readonly value: TValue;
}

/** One typed row-change proposal emitted in rows ownership mode. @public */
export type PretableRowChange<
  TRow extends object,
  TRowId extends string | number,
  TColumns,
> = {
  readonly [TColumnId in ColumnIdOf<TColumns>]: {
    readonly rowId: TRowId;
    readonly columnId: TColumnId;
    readonly previousRow: TRow;
    readonly row: TRow;
    readonly changes: Partial<TRow>;
    readonly value: ColumnValueOf<TColumns, TColumnId>;
  };
}[ColumnIdOf<TColumns>];

/** React presentation behavior attachable to a typed model column. @public */
export interface PretableColumnPresentation<
  TRow extends object,
  TRowId extends string | number,
  TColumn,
> {
  readonly header?: ReactNode;
  readonly widthPx?: number;
  readonly pinned?: "left" | "right";
  readonly wrap?: boolean;
  readonly flex?: number;
  readonly minWidthPx?: number;
  readonly maxWidthPx?: number;
  readonly editable?: boolean;
  readonly setValue?: (
    input: PretableSetValueInput<TRow, PretableColumnValue<TColumn>>,
  ) => Partial<TRow>;
  readonly render?: (input: {
    readonly row: TRow;
    readonly rowId: TRowId;
    readonly value: PretableColumnValue<TColumn>;
    readonly column: TColumn;
  }) => ReactNode;
}

/** Edit contract for a model-mode presentation override. @public */
export type PretablePresentationEditRequirement<
  TRow extends object,
  TColumn,
> = TColumn extends { readonly id: infer TId extends string }
  ? TId extends keyof TRow
    ? {
        readonly editable?: boolean;
        readonly setValue?: (
          input: PretableSetValueInput<TRow, PretableColumnValue<TColumn>>,
        ) => Partial<TRow>;
      }
    : | { readonly editable?: false; readonly setValue?: never }
      | {
          readonly editable: true;
          readonly setValue: (
            input: PretableSetValueInput<TRow, PretableColumnValue<TColumn>>,
          ) => Partial<TRow>;
        }
  : never;

/** Full rows-mode column tuple with React presentation fields. @public */
export type PretableReactColumns<TColumns, TRowId extends string | number> = {
  readonly [K in keyof TColumns]: TColumns[K] extends {
    readonly accessor: (row: infer TRow extends object) => unknown;
  }
    ? TColumns[K] &
        PretableColumnPresentation<TRow, TRowId, TColumns[K]> &
        PretableEditableColumnRequirement<TColumns[K]>
    : never;
};

/** Presentation-only model-mode override; derivation fields are forbidden. @public */
export type PretablePresentationColumns<
  TColumns,
  TRowId extends string | number,
> = {
  readonly [K in keyof TColumns]: TColumns[K] extends {
    readonly id: infer TId extends string;
    readonly accessor: (row: infer TRow extends object) => unknown;
  }
    ? Omit<
        PretableColumnPresentation<TRow, TRowId, TColumns[K]>,
        "editable" | "setValue"
      > &
        PretablePresentationEditRequirement<TRow, TColumns[K]> & {
          readonly id: TId;
          readonly accessor?: never;
          readonly value?: never;
          readonly compare?: never;
          readonly aggregate?: never;
          readonly type?: never;
        }
    : never;
};

/**
 * React-extended column definition. Adds the `render` and `renderHeader` JSX-typed callbacks on top of `@pretable/core`'s base column.
 *
 * @public
 */
export interface PretableColumn<
  TRow extends PretableRow = PretableRow,
> extends PretableBaseColumn<TRow> {
  render?: (input: PretableCellRenderInput<TRow>) => ReactNode;
  renderHeader?: (input: PretableHeaderRenderInput<TRow>) => ReactNode;
  renderEditor?: (input: PretableEditorInput<TRow>) => ReactNode;
}

/**
 * Input passed to a column's `renderEditor`. Extends the engine edit input with
 * draft controls bound to the active edit. `commit` accepts the focus direction
 * to move after a successful commit (Enter → "down", Tab → "right").
 *
 * @public
 */
export interface PretableEditorInput<
  TRow extends PretableRow = PretableRow,
> extends Omit<PretableEditInput<TRow>, "column"> {
  column: PretableColumn<TRow>;
  status: PretableEditStatus;
  error?: string;
  draft: unknown;
  setDraft: (value: unknown) => void;
  commit: (direction?: PretableFocusDirection) => void;
  cancel: () => void;
  /**
   * True when the edit began by typing a printable character on the focused
   * cell (type-to-replace), so the draft is already that character. Editors
   * put the caret at the end in that case — select-all would make the next
   * keystroke replace the seed instead of appending to it. Absent/false for
   * Enter, F2 and double-click, where select-all is the wanted behavior.
   */
  seededFromTyping?: boolean;
}

/**
 * Input passed to a column's `render` function.
 *
 * @public
 */
export interface PretableCellRenderInput<
  TRow extends PretableRow = PretableRow,
> extends PretableGridFormatInput<TRow> {
  formattedValue: string;
  rowId: string;
  rowIndex: number;
  isFocused: boolean;
  isSelected: boolean;
  /**
   * Authoritative pin side for this column, from the engine's column plan —
   * not the `columns` prop, which goes stale the moment a pin is set through
   * controlled `state.columnPinned`, `grid.setColumnPinned`, or drag-to-pin.
   * Normalized to `null` when unpinned (the column's own optional `pinned` is
   * `undefined` in that case) so consumers only ever branch on one shape.
   */
  pinned: "left" | "right" | null;
}

/**
 * Input passed to a column's `renderHeader` function.
 *
 * @public
 */
export interface PretableHeaderRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
  isSorted: boolean;
  /**
   * Authoritative pin side for this column, from the engine's column plan —
   * not the `columns` prop, which goes stale the moment a pin is set through
   * controlled `state.columnPinned`, `grid.setColumnPinned`, or drag-to-pin.
   * Normalized to `null` when unpinned (the column's own optional `pinned` is
   * `undefined` in that case) so consumers only ever branch on one shape.
   */
  pinned: "left" | "right" | null;
}

export type { PretableGridFormatInput as PretableFormatInput };
