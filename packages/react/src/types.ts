import type { ReactNode } from "react";
import type {
  ColumnIdOf,
  ColumnAlign,
  ColumnOption,
  ColumnValueOf,
  PretableAggregateOutputOf,
  PretableAggregateSpec,
  PretableColumnAccessorKind,
  PretableColumnDefinition,
  PretableColumnType,
  PretableEditStatus,
  PretableFocusDirection,
  PretableFormatInput as PretableCoreFormatInput,
  PretableRow,
  PretableRowId,
  FilterOperator,
} from "@pretable/core";

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

/** Conventional row ID available while a standalone column factory runs. @public */
export type PretableColumnRowId<TRow> = TRow extends {
  readonly id: infer TRowId extends PretableRowId;
}
  ? TRowId
  : PretableRowId;

/**
 * Re-requires `getRowId` on rows-owned entry points whose row type has no
 * conventional `id: string | number`.
 *
 * Every rows-owned entry point declares `getRowId` as an *optional* member —
 * one plain inference site, which is what lets `TRow`/`TRowId` be inferred
 * from `rows` when the prop is absent — and then intersects this type in.
 * For a row with a conventional `id` it resolves to `unknown` and vanishes
 * from the intersection, leaving the prop genuinely optional and backed by
 * the engine's `row.id` fallback. For any other row shape it resolves to a
 * required `getRowId`, so the omission is a compile error at the call site
 * rather than a `PretableRowModelError` when the first row is read.
 *
 * @public
 */
export type PretableRowIdRequirement<TRow, TRowId extends PretableRowId> = [
  TRow,
] extends [{ readonly id: PretableRowId }]
  ? unknown
  : { readonly getRowId: (row: TRow) => TRowId };

/** Value-compatible column kinds accepted by the React-aware helper. @public */
export type PretableReactColumnTypeFor<TValue> = [TValue] extends [never]
  ? never
  : [NonNullable<TValue>] extends [never]
    ? Exclude<PretableColumnType, "number">
    : NonNullable<TValue> extends number
      ? "number"
      : NonNullable<TValue> extends boolean
        ? "boolean"
        : NonNullable<TValue> extends Date
          ? "date"
          : NonNullable<TValue> extends string
            ? "text" | "enum" | "date"
            : PretableColumnType;

/** Stable derivation fields visible to authoritative presentation callbacks. @public */
export interface PretableReactColumnContext<
  TRow extends object,
  TId extends string,
  TValue,
  TType extends PretableColumnType,
  TAggregate,
> {
  readonly id: TId;
  readonly type: TType;
  readonly accessor: (row: TRow) => TValue;
  readonly value: (row: TRow) => TValue;
  readonly aggregate?: TAggregate;
}

/** Visual fields carried by an effective authoritative column. @public */
export interface PretableColumnVisualPresentation {
  readonly header?: ReactNode;
  readonly widthPx?: number;
  readonly pinned?: "left" | "right";
  readonly wrap?: boolean;
  readonly flex?: number;
  readonly minWidthPx?: number;
  readonly maxWidthPx?: number;
}

/** Effective column visible to typed React presentation callbacks. @public */
export type PretableEffectiveColumn<TColumn> = TColumn &
  PretableColumnVisualPresentation;

/** Correlated input shared by editable predicates and validation hooks. @public */
export interface PretableColumnEditInput<
  TRow extends object,
  TRowId extends PretableRowId,
  TValue,
  TColumn,
> {
  readonly rowId: TRowId;
  readonly columnId: TColumn extends { readonly id: infer TId extends string }
    ? TId
    : string;
  readonly row: TRow;
  readonly column: PretableEffectiveColumn<TColumn>;
  readonly value: TValue;
}

/** Broad edit-hook input for the React presentation column. @public */
export interface PretableEditInput<TRow extends PretableRow = PretableRow> {
  readonly rowId: string;
  readonly columnId: string;
  readonly row: TRow;
  readonly column: PretableColumn<TRow>;
  readonly value: unknown;
}

/** Fully correlated typed cell-render input. @public */
export interface PretableCellRenderInput<
  TRow extends object = PretableRow,
  TRowId extends PretableRowId = string,
  TValue = unknown,
  TColumn = PretableColumn<TRow & PretableRow>,
> {
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly column: PretableEffectiveColumn<TColumn>;
  readonly value: TValue;
  readonly formattedValue: string;
  readonly rowIndex: number;
  readonly isFocused: boolean;
  readonly isSelected: boolean;
  readonly pinned: "left" | "right" | null;
}

/** Fully correlated typed header-render input. @public */
export interface PretableHeaderRenderInput<
  TRow extends object = PretableRow,
  TColumn = PretableColumn<TRow & PretableRow>,
> {
  readonly column: PretableEffectiveColumn<TColumn>;
  readonly label: string;
  readonly sortDirection: "asc" | "desc" | null;
  readonly isSorted: boolean;
  readonly pinned: "left" | "right" | null;
}

/** Typed custom-editor input including its current draft lifecycle. @public */
export interface PretableEditorInput<
  TRow extends object = PretableRow,
  TRowId extends PretableRowId = string,
  TValue = unknown,
  TColumn = PretableColumn<TRow & PretableRow>,
> extends PretableColumnEditInput<TRow, TRowId, TValue, TColumn> {
  readonly status: PretableEditStatus;
  readonly error?: string;
  readonly draft: TValue | string;
  readonly setDraft: (value: TValue | string) => void;
  readonly commit: (direction?: PretableFocusDirection) => void;
  readonly cancel: () => void;
  readonly seededFromTyping?: boolean;
}

/** Non-render presentation and edit behavior for an authoritative column. @public */
export interface PretableColumnPresentationOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumn,
> extends PretableColumnVisualPresentation {
  readonly editable?:
    | boolean
    | ((
        input: PretableColumnEditInput<
          TRow,
          TRowId,
          PretableColumnValue<TColumn>,
          TColumn
        >,
      ) => boolean | Promise<boolean>);
  readonly validate?: (
    value: PretableColumnValue<TColumn>,
    input: PretableColumnEditInput<
      TRow,
      TRowId,
      PretableColumnValue<TColumn>,
      TColumn
    >,
  ) => true | string | Promise<true | string>;
  readonly parseEditValue?: (
    raw: string,
    input: PretableColumnEditInput<
      TRow,
      TRowId,
      PretableColumnValue<TColumn>,
      TColumn
    >,
  ) => PretableColumnValue<TColumn>;
  readonly formatEditValue?: (
    value: PretableColumnValue<TColumn>,
    input: PretableColumnEditInput<
      TRow,
      TRowId,
      PretableColumnValue<TColumn>,
      TColumn
    >,
  ) => string;
  readonly setValue?: (
    input: PretableSetValueInput<TRow, PretableColumnValue<TColumn>>,
  ) => Partial<TRow>;
}

/** React presentation behavior attachable to a typed model column. @public */
export interface PretableColumnPresentation<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumn,
> extends PretableColumnPresentationOptions<TRow, TRowId, TColumn> {
  readonly render?: (
    input: PretableCellRenderInput<
      TRow,
      TRowId,
      PretableColumnValue<TColumn>,
      TColumn
    >,
  ) => ReactNode;
  readonly renderHeader?: (
    input: PretableHeaderRenderInput<TRow, TColumn>,
  ) => ReactNode;
  readonly renderEditor?: (
    input: PretableEditorInput<
      TRow,
      TRowId,
      PretableColumnValue<TColumn>,
      TColumn
    >,
  ) => ReactNode;
}

/** Editable predicate type inferred for one authoritative column. @public */
export type PretableColumnEditablePredicate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumn,
> = (
  input: PretableColumnEditInput<
    TRow,
    TRowId,
    PretableColumnValue<TColumn>,
    TColumn
  >,
) => boolean | Promise<boolean>;

/** Reverse-mapping requirement inferred from a typed column. @public */
export type PretableEditableColumnRequirement<TColumn> = TColumn extends {
  readonly editable: infer TEditable;
}
  ? TEditable extends false | undefined
    ? Record<never, never>
    : TColumn extends PretableColumnAccessorKind<"direct">
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

/** Edit contract for a model-mode presentation override. @public */
export type PretablePresentationEditRequirement<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumn,
> =
  TColumn extends PretableColumnAccessorKind<"direct">
    ? {
        readonly editable?:
          boolean | PretableColumnEditablePredicate<TRow, TRowId, TColumn>;
        readonly setValue?: (
          input: PretableSetValueInput<TRow, PretableColumnValue<TColumn>>,
        ) => Partial<TRow>;
      }
    : | { readonly editable?: false; readonly setValue?: never }
      | {
          readonly editable:
            true | PretableColumnEditablePredicate<TRow, TRowId, TColumn>;
          readonly setValue: (
            input: PretableSetValueInput<TRow, PretableColumnValue<TColumn>>,
          ) => Partial<TRow>;
        };

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
> = TColumns extends readonly (infer TColumn)[]
  ? readonly (TColumn extends {
      readonly id: infer TId extends string;
      readonly accessor: (row: infer TRow extends object) => unknown;
    }
      ? Omit<
          PretableColumnPresentation<TRow, TRowId, TColumn>,
          "editable" | "setValue"
        > &
          PretablePresentationEditRequirement<TRow, TRowId, TColumn> & {
            readonly id: TId;
            readonly accessor?: never;
            readonly value?: never;
            readonly compare?: never;
            readonly aggregate?: never;
            readonly type?: never;
          }
      : never)[] & {
      readonly length: TColumns["length"];
    }
  : never;

/** Options accepted by the React-aware authoritative column helper. @public */
export type PretableColumnFactoryOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TId extends string,
  TValue,
  TType extends PretableReactColumnTypeFor<TValue>,
  TAggregate extends PretableAggregateSpec<TRow, TValue, TType> | undefined,
> = {
  readonly type: TType;
  readonly compare?: (left: TValue, right: TValue) => number;
  readonly aggregate?: TAggregate;
  /**
   * Native number presentation. `format` outranks it for data cells and
   * `formatAggregate` outranks it for group aggregates.
   */
  readonly numberFormat?: Intl.NumberFormatOptions;
  readonly format?: (input: {
    readonly value: TValue;
    readonly row: TRow;
    readonly column: PretableReactColumnContext<
      TRow,
      TId,
      TValue,
      TType,
      TAggregate
    >;
  }) => string;
  readonly formatAggregate?: (input: {
    readonly value: PretableAggregateOutputOf<TAggregate, TType>;
    readonly column: PretableReactColumnContext<
      TRow,
      TId,
      TValue,
      TType,
      TAggregate
    >;
  }) => string;
} & PretableColumnPresentation<
  TRow,
  TRowId,
  PretableReactColumnContext<TRow, TId, TValue, TType, TAggregate>
>;

/** React-aware authoritative column returned by the helper. @public */
export type PretableReactColumnDefinition<
  TRow extends object,
  TRowId extends PretableRowId,
  TId extends string,
  TValue,
  TType extends PretableReactColumnTypeFor<TValue>,
  TAggregate extends PretableAggregateSpec<TRow, TValue, TType> | undefined,
  TDirect extends boolean,
> = Omit<
  PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>,
  "header" | "accessorKey"
> &
  PretableColumnPresentation<
    TRow,
    TRowId,
    PretableReactColumnContext<TRow, TId, TValue, TType, TAggregate>
  > &
  PretableColumnAccessorKind<TDirect extends true ? "direct" : "computed"> &
  (TDirect extends true
    ? { readonly accessorKey: TId }
    : { readonly accessorKey?: undefined });

declare module "@pretable/core" {
  interface PretableColumnHelper<TRow extends object> {
    accessor<
      const TKey extends Extract<keyof TRow, string>,
      const TType extends PretableReactColumnTypeFor<TRow[TKey]>,
      const TAggregate extends
        PretableAggregateSpec<TRow, TRow[TKey], TType> | undefined = undefined,
    >(
      key: TKey,
      options: PretableColumnFactoryOptions<
        TRow,
        PretableColumnRowId<TRow>,
        TKey,
        TRow[TKey],
        TType,
        TAggregate
      >,
    ): PretableReactColumnDefinition<
      TRow,
      PretableColumnRowId<TRow>,
      TKey,
      TRow[TKey],
      TType,
      TAggregate,
      true
    >;

    accessor<
      const TId extends string,
      const TValue,
      const TType extends PretableReactColumnTypeFor<TValue>,
      const TAggregate extends
        PretableAggregateSpec<TRow, TValue, TType> | undefined = undefined,
    >(
      id: TId,
      accessor: (row: TRow) => TValue,
      options: Omit<
        PretableColumnFactoryOptions<
          TRow,
          PretableColumnRowId<TRow>,
          TId,
          TValue,
          TType,
          TAggregate
        >,
        "editable" | "setValue"
      > & {
        readonly editable:
          | true
          | PretableColumnEditablePredicate<
              TRow,
              PretableColumnRowId<TRow>,
              PretableReactColumnContext<TRow, TId, TValue, TType, TAggregate>
            >;
        readonly setValue: (
          input: PretableSetValueInput<TRow, TValue>,
        ) => Partial<TRow>;
      },
    ): Omit<
      PretableReactColumnDefinition<
        TRow,
        PretableColumnRowId<TRow>,
        TId,
        TValue,
        TType,
        TAggregate,
        false
      >,
      "editable" | "setValue"
    > & {
      readonly editable:
        | true
        | PretableColumnEditablePredicate<
            TRow,
            PretableColumnRowId<TRow>,
            PretableReactColumnContext<TRow, TId, TValue, TType, TAggregate>
          >;
      readonly setValue: (
        input: PretableSetValueInput<TRow, TValue>,
      ) => Partial<TRow>;
    };

    accessor<
      const TId extends string,
      const TValue,
      const TType extends PretableReactColumnTypeFor<TValue>,
      const TAggregate extends
        PretableAggregateSpec<TRow, TValue, TType> | undefined = undefined,
    >(
      id: TId,
      accessor: (row: TRow) => TValue,
      options: Omit<
        PretableColumnFactoryOptions<
          TRow,
          PretableColumnRowId<TRow>,
          TId,
          TValue,
          TType,
          TAggregate
        >,
        "editable" | "setValue"
      > & {
        readonly editable?: false;
        readonly setValue?: never;
      },
    ): Omit<
      PretableReactColumnDefinition<
        TRow,
        PretableColumnRowId<TRow>,
        TId,
        TValue,
        TType,
        TAggregate,
        false
      >,
      "editable" | "setValue"
    > & {
      readonly editable?: false;
      readonly setValue?: never;
    };
  }
}

/**
 * React column definition for the presentation layer.
 *
 * @public
 */
export interface PretableColumn<TRow extends PretableRow = PretableRow> {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left" | "right";
  sortable?: boolean;
  step?: number;
  filterable?: boolean;
  /** Restrict the filter menu to operators the active processor supports. */
  filterOperators?: FilterOperator[];
  type?: PretableColumnType;
  /** Horizontal alignment. Number columns default to `"end"`. */
  align?: ColumnAlign;
  options?: ColumnOption[];
  value?: (row: TRow) => unknown;
  format?: (input: {
    value: unknown;
    row: TRow;
    column: PretableColumn<TRow>;
  }) => string;
  /** Native number presentation; derivation and editing keep raw values. */
  numberFormat?: Intl.NumberFormatOptions;
  formatAggregate?: (input: {
    value: unknown;
    column: PretableColumn<TRow>;
    group: {
      readonly id: string;
      readonly groupId: string;
      readonly depth: number;
      readonly columnId: string;
      readonly value: unknown;
      readonly childCount: number;
      readonly aggregates: Readonly<Record<string, unknown>>;
      readonly expanded: boolean;
    };
    /** Whether the aggregate covers the full result or only loaded rows. */
    scope: "all" | "loaded";
  }) => string;
  minWidthPx?: number;
  maxWidthPx?: number;
  flex?: number;
  resizable?: boolean;
  reorderable?: boolean;
  aggregate?: unknown;
  editable?:
    | boolean
    | ((input: {
        rowId: string;
        columnId: string;
        row: TRow;
        column: PretableColumn<TRow>;
        value: unknown;
      }) => boolean | Promise<boolean>);
  validate?: (
    value: unknown,
    input: {
      rowId: string;
      columnId: string;
      row: TRow;
      column: PretableColumn<TRow>;
      value: unknown;
    },
  ) => true | string | Promise<true | string>;
  parseEditValue?: (
    raw: string,
    input: {
      rowId: string;
      columnId: string;
      row: TRow;
      column: PretableColumn<TRow>;
      value: unknown;
    },
  ) => unknown;
  formatEditValue?: (
    value: unknown,
    input: {
      rowId: string;
      columnId: string;
      row: TRow;
      column: PretableColumn<TRow>;
      value: unknown;
    },
  ) => string;
  render?: (input: PretableCellRenderInput<TRow>) => ReactNode;
  renderHeader?: (input: PretableHeaderRenderInput<TRow>) => ReactNode;
  renderEditor?: (input: PretableEditorInput<TRow>) => ReactNode;
}

export type { PretableCoreFormatInput as PretableFormatInput };
