/**
 * Expand mapped/intersection types into readable editor hovers.
 * @public
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** @public */
export type PretableRowId = string | number;

/**
 * Values with stable, collision-free local grouping identity.
 * @public
 */
export type PretableGroupKey =
  string | number | bigint | boolean | Date | null | undefined;

/** @public */
export type PretableColumnType =
  "text" | "number" | "date" | "enum" | "boolean";

/** @public */
export interface PretableAggregator<
  TRow extends object = object,
  TValue = unknown,
  TAccumulator = unknown,
  TOutput = unknown,
> {
  readonly init: () => TAccumulator;
  readonly accumulate: (
    accumulator: TAccumulator,
    value: TValue,
    row: TRow,
  ) => TAccumulator;
  readonly merge: (left: TAccumulator, right: TAccumulator) => TAccumulator;
  /**
   * Produces a detached accumulator for `finalize`. Required when the
   * accumulator is a class instance or otherwise cannot be structured-cloned
   * without losing behavior.
   */
  readonly snapshotAccumulator?: (accumulator: TAccumulator) => TAccumulator;
  readonly finalize: (accumulator: TAccumulator) => TOutput;
}

/** @public */
export type PretableBuiltinAggregate<TValue> =
  | "count"
  | ([NonNullable<TValue>] extends [never]
      ? never
      : NonNullable<TValue> extends number
        ? "sum" | "avg" | "min" | "max"
        : never);

/** @public */
export type PretableAggregateSpec<TRow extends object, TValue> =
  | PretableBuiltinAggregate<TValue>
  | PretableCompatibleAggregator<TRow, TValue, unknown>;

declare const columnDescriptor: unique symbol;

/** @public */
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

/** @public */
export interface PretableFormatInput<TRow extends object, TValue, TColumn> {
  readonly value: TValue;
  readonly row: TRow;
  readonly column: TColumn;
}

/** @public */
export interface PretableAggregateFormatInput<TValue, TColumn> {
  readonly value: TValue;
  readonly column: TColumn;
}

/** @public */
export type PretableAggregateOutputOf<TAggregate> = TAggregate extends {
  readonly finalize: (accumulator: never) => infer TOutput;
}
  ? TOutput
  : TAggregate extends "sum" | "avg" | "min" | "max" | "count"
    ? number | null
    : never;

/** @public */
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
      PretableAggregateOutputOf<TAggregate>,
      PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>
    >,
  ) => string;
  readonly [columnDescriptor]: {
    readonly row: TRow;
    readonly id: TId;
    readonly value: TValue;
    readonly type: TType;
    readonly aggregate: TAggregate;
  };
}

/** @public */
export type PretableColumnTypeFor<TValue> = [TValue] extends [never]
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

/** @public */
export interface PretableColumnCallbackContext<
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

/** @public */
export type PretableColumnOptions<
  TRow extends object,
  TId extends string,
  TValue,
  TType extends PretableColumnTypeFor<TValue>,
  TAggregate extends PretableAggregateSpec<TRow, TValue> | undefined,
> = {
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
};

/** @public */
export interface PretableColumnHelper<TRow extends object> {
  accessor<
    const TId extends string,
    const TAccessor extends (...args: never[]) => unknown,
    const TType extends
      | (unknown extends NoInfer<TValue>
          ? never
          : PretableColumnTypeFor<NoInfer<TValue>>)
      | ([TValue] extends [typeof columnDescriptor]
          ? [ReturnType<TAccessor>] extends [never]
            ? never
            : PretableColumnType
          : never),
    TValue = typeof columnDescriptor,
    const TAggregate extends
      | PretableAggregateSpec<TRow, NoInfer<TValue>>
      | ([TValue] extends [typeof columnDescriptor]
          ? [ReturnType<TAccessor>] extends [never]
            ? never
            : PretableAggregateSpec<TRow, never> | "sum" | "avg" | "min" | "max"
          : never)
      | undefined = undefined,
  >(
    id: TId,
    accessor: TAccessor & ((row: TRow) => TValue),
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
    },
  ): PretableColumnDefinition<
    TRow,
    TId,
    ReturnType<TAccessor>,
    TType,
    TAggregate
  >;

  accessor<
    const TKey extends Extract<keyof TRow, string>,
    const TType extends PretableColumnTypeFor<TRow[TKey]>,
    const TAggregate extends
      PretableAggregateSpec<TRow, TRow[TKey]> | undefined = undefined,
  >(
    key: TKey,
    options: PretableColumnOptions<TRow, TKey, TRow[TKey], TType, TAggregate>,
  ): PretableColumnDefinition<TRow, TKey, TRow[TKey], TType, TAggregate>;
}

/** @public */
export function createColumnHelper<
  TRow extends object,
>(): PretableColumnHelper<TRow> {
  return {
    accessor(
      id: string,
      accessorOrOptions:
        | ((row: TRow) => unknown)
        | PretableColumnOptions<
            TRow,
            string,
            unknown,
            PretableColumnType,
            undefined
          >,
      maybeOptions?: PretableColumnOptions<
        TRow,
        string,
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

/** @public */
export type ColumnDescriptorOf<TColumns> = DescriptorOf<ColumnUnion<TColumns>>;

/** @public */
export type ColumnIdOf<TColumns> = TColumns extends readonly (infer TColumn)[]
  ? TColumn extends { readonly id: infer TId extends string }
    ? TId
    : never
  : never;

/** @public */
export type ColumnValueOf<
  TColumns,
  TColumnId extends ColumnIdOf<TColumns>,
> = TColumns extends readonly (infer TColumn)[]
  ? TColumn extends {
      readonly id: TColumnId;
      readonly accessor: (...args: never[]) => infer TValue;
    }
    ? TValue
    : never
  : never;

/** @public */
export type ColumnAggregateValueOf<
  TColumns,
  TColumnId extends ColumnIdOf<TColumns>,
> = TColumns extends readonly (infer TColumn)[]
  ? TColumn extends {
      readonly id: TColumnId;
      readonly aggregate?: infer TAggregate;
    }
    ? PretableAggregateOutputOf<TAggregate>
    : never
  : never;

/** @public */
export type PretableAggregatesFor<TColumns> = Prettify<{
  readonly [
    TColumn in TColumns extends readonly (infer TItem)[]
      ? TItem
      : never as TColumn extends {
      readonly id: infer TId extends string;
      readonly aggregate?: infer TAggregate;
    }
      ? [TAggregate] extends [undefined]
        ? never
        : TId
      : never
  ]: TColumn extends { readonly aggregate?: infer TAggregate }
    ? PretableAggregateOutputOf<TAggregate>
    : never;
}>;

/**
 * The runtime filter operand accepted by a declared column type.
 * Enum columns retain known string literal values and otherwise accept strings.
 * @public
 */
export type PretableFilterOperandFor<
  TValue,
  TType extends PretableColumnType,
> = TType extends "text"
  ? string
  : TType extends "number"
    ? number
    : TType extends "date"
      ? string | number | Date
      : TType extends "boolean"
        ? boolean
        : [Extract<NonNullable<TValue>, string>] extends [never]
          ? string
          : Extract<NonNullable<TValue>, string>;

/** @public */
export type PretableFilterFor<TColumns> =
  TColumns extends readonly (infer TColumn)[]
    ? TColumn extends {
        readonly id: infer TId extends string;
        readonly accessor: (...args: never[]) => infer TValue;
        readonly type: infer TType extends PretableColumnType;
      }
      ? | {
            readonly columnId: TId;
            readonly operator: "isEmpty" | "isNotEmpty";
          }
        | (TType extends "number"
            ? | {
                  readonly columnId: TId;
                  readonly operator:
                    "equals" | "notEquals" | "gt" | "gte" | "lt" | "lte";
                  readonly value: PretableFilterOperandFor<TValue, TType>;
                }
              | {
                  readonly columnId: TId;
                  readonly operator: "between";
                  readonly value: readonly [
                    PretableFilterOperandFor<TValue, TType>,
                    PretableFilterOperandFor<TValue, TType>,
                  ];
                }
            : TType extends "date"
              ? | {
                    readonly columnId: TId;
                    readonly operator: "on" | "before" | "after";
                    readonly value: PretableFilterOperandFor<TValue, TType>;
                  }
                | {
                    readonly columnId: TId;
                    readonly operator: "dateBetween";
                    readonly value: readonly [
                      PretableFilterOperandFor<TValue, TType>,
                      PretableFilterOperandFor<TValue, TType>,
                    ];
                  }
              : TType extends "enum" | "boolean"
                ? {
                    readonly columnId: TId;
                    readonly operator: "isAnyOf" | "isNoneOf";
                    readonly value: readonly PretableFilterOperandFor<
                      TValue,
                      TType
                    >[];
                  }
                : {
                    readonly columnId: TId;
                    readonly operator:
                      | "contains"
                      | "notContains"
                      | "equals"
                      | "notEquals"
                      | "startsWith"
                      | "endsWith";
                    readonly value: PretableFilterOperandFor<TValue, TType>;
                  })
      : never
    : never;

/** @public */
export type PretableSortFor<TColumns> = Prettify<
  (TColumns extends readonly (infer TColumn)[]
    ? TColumn extends { readonly id: infer TId extends string }
      ? { readonly columnId: TId }
      : never
    : never) & {
    readonly direction: "asc" | "desc";
    readonly nulls?: "first" | "last";
  }
>;

/** @public */
export type PretableRowGroupFor<TColumns> = Prettify<
  (TColumns extends readonly (infer TColumn)[]
    ? TColumn extends {
        readonly id: infer TId extends string;
        readonly accessor: (...args: never[]) => infer TValue;
      }
      ? [TValue] extends [never]
        ? never
        : [TValue] extends [PretableGroupKey]
          ? { readonly columnId: TId }
          : never
      : never
    : never) & {
    readonly direction?: "asc" | "desc";
    readonly nulls?: "first" | "last";
  }
>;

/** @public */
export interface PretableQueryFor<TColumns> {
  readonly filters: readonly PretableFilterFor<TColumns>[];
  readonly sort: readonly PretableSortFor<TColumns>[];
  readonly rowGroups: readonly PretableRowGroupFor<TColumns>[];
}

/** @public */
export interface PretableCompatibleAggregator<
  TRow extends object,
  TValue,
  TOutput,
> {
  readonly init: () => unknown;
  readonly accumulate: {
    bivarianceHack(accumulator: unknown, value: TValue, row: TRow): unknown;
  }["bivarianceHack"] &
    ((accumulator: never, value: TValue, row: TRow) => unknown);
  readonly merge: {
    bivarianceHack(left: unknown, right: unknown): unknown;
  }["bivarianceHack"];
  readonly snapshotAccumulator?: {
    bivarianceHack(accumulator: unknown): unknown;
  }["bivarianceHack"];
  readonly finalize: {
    bivarianceHack(accumulator: unknown): TOutput;
  }["bivarianceHack"];
}

/** @public */
export type PretableCompatibleAggregateSpec<
  TRow extends object,
  TValue,
  TAggregate,
> = [TAggregate] extends [undefined]
  ? undefined
  : | ([PretableAggregateOutputOf<TAggregate>] extends [number | null]
        ? [number | null] extends [PretableAggregateOutputOf<TAggregate>]
          ? PretableBuiltinAggregate<TValue>
          : never
        : never)
    | PretableCompatibleAggregator<
        TRow,
        TValue,
        PretableAggregateOutputOf<TAggregate>
      >;

/** @public */
export interface PretableColumnDerivation<
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
  readonly compare?: (left: TValue, right: TValue) => number;
  readonly aggregate?: PretableCompatibleAggregateSpec<
    TRow,
    TValue,
    TAggregate
  >;
  readonly [columnDescriptor]: {
    readonly row: TRow;
    readonly id: TId;
    readonly value: TValue;
    readonly type: TType;
    readonly aggregate: PretableCompatibleAggregateSpec<
      TRow,
      TValue,
      TAggregate
    >;
  };
}

/** @public */
export type PretableDerivationsFor<TColumns> = {
  readonly [K in keyof TColumns]: TColumns[K] extends {
    readonly id: infer TId extends string;
    readonly type: infer TType extends PretableColumnType;
    readonly accessor: (row: infer TRow extends object) => infer TValue;
    readonly aggregate?: infer TAggregate;
  }
    ? PretableColumnDerivation<TRow, TId, TValue, TType, TAggregate>
    : never;
};
