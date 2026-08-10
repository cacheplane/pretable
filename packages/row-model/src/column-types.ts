/** Expand mapped/intersection types into readable editor hovers. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/* eslint-disable @typescript-eslint/no-explicit-any -- existential custom aggregate state */

export type PretableRowId = string | number;

export type PretableColumnType =
  "text" | "number" | "date" | "enum" | "boolean";

export interface PretableAggregator<
  TRow extends object = object,
  TValue = unknown,
  TAccumulator = unknown,
  TOutput = unknown,
> {
  init(): TAccumulator;
  accumulate(accumulator: TAccumulator, value: TValue, row: TRow): TAccumulator;
  merge(left: TAccumulator, right: TAccumulator): TAccumulator;
  finalize(accumulator: TAccumulator): TOutput;
}

export type PretableBuiltinAggregate<TValue> =
  | "count"
  | (NonNullable<TValue> extends number
      ? "sum" | "avg" | "min" | "max"
      : never);

export type PretableAggregateSpec<TRow extends object, TValue> =
  PretableBuiltinAggregate<TValue> | PretableAggregator<TRow, TValue, any, any>;

declare const columnDescriptor: unique symbol;

export interface PretableColumnDescriptor<
  TRow extends object,
  TId extends string,
  TValue,
  TType extends PretableColumnType,
  TAggregate,
> {
  readonly row: TRow;
  readonly id: TId;
  readonly value: TValue;
  readonly type: TType;
  readonly aggregate: TAggregate;
}

export interface PretableFormatInput<TRow extends object, TValue, TColumn> {
  readonly value: TValue;
  readonly row: TRow;
  readonly column: TColumn;
}

export interface PretableAggregateFormatInput<TValue, TColumn> {
  readonly value: TValue;
  readonly column: TColumn;
}

export type AggregateOutputOfSpec<TAggregate> = TAggregate extends {
  finalize(accumulator: never): infer TOutput;
}
  ? TOutput
  : TAggregate extends "sum" | "avg" | "min" | "max" | "count"
    ? number | null
    : never;

export interface PretableColumnDefinition<
  TRow extends object,
  TId extends string,
  TValue,
  TType extends PretableColumnType,
  TAggregate = undefined,
> {
  readonly id: TId;
  readonly type: TType;
  readonly header?: string;
  readonly accessorKey?: Extract<keyof TRow, string>;
  readonly accessor: (row: TRow) => TValue;
  /** Compatibility spelling retained on the original column object. */
  readonly value: (row: TRow) => TValue;
  readonly compare?: (left: TValue, right: TValue) => number;
  readonly aggregate?: TAggregate;
  readonly format?: (
    input: PretableFormatInput<
      TRow,
      TValue,
      PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>
    >,
  ) => string;
  readonly formatAggregate?: (
    input: PretableAggregateFormatInput<
      AggregateOutputOfSpec<TAggregate>,
      PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>
    >,
  ) => string;
  readonly [columnDescriptor]: PretableColumnDescriptor<
    TRow,
    TId,
    TValue,
    TType,
    TAggregate
  >;
}

type CompatibleColumnType<TValue> =
  NonNullable<TValue> extends number
    ? "number"
    : NonNullable<TValue> extends boolean
      ? "boolean"
      : NonNullable<TValue> extends Date
        ? "date"
        : NonNullable<TValue> extends string
          ? "text" | "enum" | "date"
          : PretableColumnType;

export type PretableColumnOptions<
  TRow extends object,
  TValue,
  TType extends CompatibleColumnType<TValue>,
  TAggregate extends PretableAggregateSpec<TRow, TValue> | undefined,
> = {
  readonly type: TType;
  readonly header?: string;
  readonly compare?: (left: TValue, right: TValue) => number;
  readonly aggregate?: TAggregate;
  readonly format?: (input: {
    readonly value: TValue;
    readonly row: TRow;
  }) => string;
  readonly formatAggregate?: (input: {
    readonly value: AggregateOutputOfSpec<TAggregate>;
  }) => string;
};

export interface PretableColumnHelper<TRow extends object> {
  accessor<
    const TKey extends Extract<keyof TRow, string>,
    const TType extends CompatibleColumnType<TRow[TKey]>,
    const TAggregate extends
      PretableAggregateSpec<TRow, TRow[TKey]> | undefined = undefined,
  >(
    key: TKey,
    options: PretableColumnOptions<TRow, TRow[TKey], TType, TAggregate>,
  ): PretableColumnDefinition<TRow, TKey, TRow[TKey], TType, TAggregate>;

  accessor<
    const TId extends string,
    TValue,
    const TType extends CompatibleColumnType<TValue>,
    const TAggregate extends PretableAggregateSpec<TRow, TValue> | undefined =
      undefined,
  >(
    id: TId,
    accessor: (row: TRow) => TValue,
    options: PretableColumnOptions<TRow, TValue, TType, TAggregate>,
  ): PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>;
}

export function createColumnHelper<
  TRow extends object,
>(): PretableColumnHelper<TRow> {
  return {
    accessor(
      id: string,
      accessorOrOptions:
        | ((row: TRow) => unknown)
        | PretableColumnOptions<TRow, unknown, PretableColumnType, undefined>,
      maybeOptions?: PretableColumnOptions<
        TRow,
        unknown,
        PretableColumnType,
        undefined
      >,
    ) {
      const isFunctionAccessor = typeof accessorOrOptions === "function";
      const accessor = isFunctionAccessor
        ? accessorOrOptions
        : (row: TRow) => (row as Record<string, unknown>)[id];
      const options = isFunctionAccessor ? maybeOptions : accessorOrOptions;

      return {
        ...options,
        id,
        accessorKey: isFunctionAccessor
          ? undefined
          : (id as Extract<keyof TRow, string>),
        accessor,
        value: accessor,
      };
    },
  } as PretableColumnHelper<TRow>;
}

type ColumnUnion<TColumns> = TColumns extends readonly (infer TColumn)[]
  ? TColumn
  : never;

type DescriptorOf<TColumn> =
  TColumn extends PretableColumnDefinition<
    infer TRow,
    infer TId,
    infer TValue,
    infer TType,
    infer TAggregate
  >
    ? PretableColumnDescriptor<TRow, TId, TValue, TType, TAggregate>
    : never;

export type ColumnIdOf<TColumns> = DescriptorOf<ColumnUnion<TColumns>>["id"];

export type ColumnValueOf<TColumns, TColumnId extends ColumnIdOf<TColumns>> =
  DescriptorOf<ColumnUnion<TColumns>> extends infer TDescriptor
    ? TDescriptor extends {
        readonly id: TColumnId;
        readonly value: infer TValue;
      }
      ? TValue
      : never
    : never;

export type ColumnAggregateValueOf<
  TColumns,
  TColumnId extends ColumnIdOf<TColumns>,
> =
  DescriptorOf<ColumnUnion<TColumns>> extends infer TDescriptor
    ? TDescriptor extends {
        readonly id: TColumnId;
        readonly aggregate: infer TAggregate;
      }
      ? AggregateOutputOfSpec<TAggregate>
      : never
    : never;

type EmptyFilter<TId extends string> = {
  readonly columnId: TId;
  readonly operator: "isEmpty" | "isNotEmpty";
};

type ValueFilter<TId extends string, TOperator extends string, TValue> = {
  readonly columnId: TId;
  readonly operator: TOperator;
  readonly value: TValue;
};

type FilterForDescriptor<TDescriptor> =
  TDescriptor extends PretableColumnDescriptor<
    object,
    infer TId,
    infer TValue,
    infer TType,
    unknown
  >
    ? | EmptyFilter<TId>
      | (TType extends "number"
          ? | ValueFilter<
                TId,
                "equals" | "notEquals" | "gt" | "gte" | "lt" | "lte",
                TValue
              >
            | ValueFilter<TId, "between", readonly [TValue, TValue]>
          : TType extends "date"
            ? | ValueFilter<TId, "on" | "before" | "after", TValue>
              | ValueFilter<TId, "dateBetween", readonly [TValue, TValue]>
            : TType extends "enum" | "boolean"
              ? ValueFilter<TId, "isAnyOf" | "isNoneOf", readonly TValue[]>
              : ValueFilter<
                  TId,
                  | "contains"
                  | "notContains"
                  | "equals"
                  | "notEquals"
                  | "startsWith"
                  | "endsWith",
                  TValue
                >)
    : never;

export type PretableFilterFor<TColumns> = FilterForDescriptor<
  DescriptorOf<ColumnUnion<TColumns>>
>;

type ColumnReferenceFor<TColumns> =
  DescriptorOf<ColumnUnion<TColumns>> extends infer TDescriptor
    ? TDescriptor extends { readonly id: infer TId extends string }
      ? { readonly columnId: TId }
      : never
    : never;

export type PretableSortFor<TColumns> = Prettify<
  ColumnReferenceFor<TColumns> & {
    readonly direction: "asc" | "desc";
    readonly nulls?: "first" | "last";
  }
>;

export type PretableRowGroupFor<TColumns> = Prettify<
  ColumnReferenceFor<TColumns> & {
    readonly direction?: "asc" | "desc";
    readonly nulls?: "first" | "last";
  }
>;

export interface PretableQueryFor<TColumns> {
  readonly filters: readonly PretableFilterFor<TColumns>[];
  readonly sort: readonly PretableSortFor<TColumns>[];
  readonly rowGroups: readonly PretableRowGroupFor<TColumns>[];
}

type RuntimeColumnOf<TColumn> =
  DescriptorOf<TColumn> extends PretableColumnDescriptor<
    infer TRow,
    infer TId,
    infer TValue,
    infer TType,
    infer TAggregate
  >
    ? PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>
    : never;

export type PretableDerivationsFor<TColumns> = {
  readonly [K in keyof TColumns]: RuntimeColumnOf<TColumns[K]>;
};
