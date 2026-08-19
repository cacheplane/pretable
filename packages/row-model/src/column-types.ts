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
  string | number | bigint | boolean | null | undefined;

/** @public */
export type PretableColumnType =
  "text" | "number" | "date" | "enum" | "boolean";

/**
 * Native presentation options for canonical `YYYY-MM-DD` strings.
 *
 * Pretable fixes the formatter time zone to UTC and excludes every time or
 * time-zone option. This configuration affects presentation only; derivation,
 * editing, and row-model reads continue to use raw values.
 *
 * @public
 */
export type PretableDateFormatOptions = {
  [TKey in keyof Intl.DateTimeFormatOptions]?: TKey extends
    | "localeMatcher"
    | "calendar"
    | "numberingSystem"
    | "dateStyle"
    | "weekday"
    | "era"
    | "year"
    | "month"
    | "day"
    | "formatMatcher"
    ? Intl.DateTimeFormatOptions[TKey]
    : never;
};

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
export type PretableBuiltinAggregate<TValue, TType extends PretableColumnType> =
  | "count"
  | (TType extends "number"
      ? NonNullable<TValue> extends number
        ? "sum" | "avg" | "min" | "max"
        : never
      : TType extends "date"
        ? NonNullable<TValue> extends string
          ? "min" | "max"
          : never
        : never);

/** @public */
export type PretableAggregateSpec<
  TRow extends object,
  TValue,
  TType extends PretableColumnType,
> =
  | PretableBuiltinAggregate<TValue, TType>
  | PretableCompatibleAggregator<TRow, TValue, unknown>;

/**
 * Compile-time-only sentinel for `PretableColumnHelper.accessor`'s `TValue`:
 * it means "no value type has been inferred from the accessor yet", which is
 * what lets the helper offer the widened `type` and `aggregate` choices in the
 * accessor-form overload and the narrowed ones everywhere else.
 *
 * It is an interface with an unwritable key rather than the `unique symbol` it
 * replaced, for the reason spelled out over `PretableGroupId` in `./types.ts`:
 * a `unique symbol` is nominal per declaration file, and these declarations are
 * re-emitted into `core/dist` by `tsup`'s bundled `.d.ts`.
 *
 * @public
 */
export interface PretableUninferredColumnValue {
  readonly "~pretableUninferredColumnValue": true;
}

/** Compile-time-only accessor-form carrier emitted by the column helper. @public */
export interface PretableColumnAccessorKind<
  TKind extends "direct" | "computed",
> {
  readonly "~pretableColumn": { readonly accessorKind: TKind };
}

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
export interface PretableFormatInput<
  TRow extends object,
  TValue = unknown,
  TColumn = unknown,
> {
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
export type PretableAggregateOutputOf<
  TAggregate,
  TType extends PretableColumnType,
> = TAggregate extends {
  readonly finalize: (accumulator: never) => infer TOutput;
}
  ? TOutput
  : TAggregate extends "min" | "max"
    ? TType extends "date"
      ? string | null
      : number | null
    : TAggregate extends "sum" | "avg" | "count"
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
  /**
   * Native number presentation. Outranked by `format` for data cells and by
   * `formatAggregate` for group aggregates; derivation, editing, and every
   * row-model read continue to see the raw value.
   */
  readonly numberFormat?: Intl.NumberFormatOptions;
  /**
   * Native calendar-date presentation for canonical `YYYY-MM-DD` strings.
   * `format` outranks it; derivation and editing continue to use raw values.
   */
  readonly dateFormat?: PretableDateFormatOptions;
  readonly format?: (
    input: PretableFormatInput<
      TRow,
      TValue,
      PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>
    >,
  ) => string;
  readonly formatAggregate?: (
    input: PretableAggregateFormatInput<
      PretableAggregateOutputOf<TAggregate, TType>,
      PretableColumnDefinition<TRow, TId, TValue, TType, TAggregate>
    >,
  ) => string;
  readonly ["~pretableColumn"]: {
    readonly row: TRow;
    readonly id: TId;
    readonly value: TValue;
    readonly type: TType;
    readonly aggregate: TAggregate;
  };
}

/** @public */
export type PretableColumnTypeFor<TValue> = 0 extends 1 & TValue
  ? Exclude<PretableColumnType, "date">
  : [TValue] extends [never]
    ? never
    : [NonNullable<TValue>] extends [never]
      ? Exclude<PretableColumnType, "number" | "date">
      : NonNullable<TValue> extends number
        ? "number"
        : NonNullable<TValue> extends boolean
          ? "boolean"
          : NonNullable<TValue> extends string
            ? | "text"
              | "enum"
              | ([TValue] extends [string | null] ? "date" : never)
            : Exclude<PretableColumnType, "date">;

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
  TAggregate extends PretableAggregateSpec<TRow, TValue, TType> | undefined,
> = {
  readonly type: TType;
  readonly header?: string;
  readonly compare?: (left: TValue, right: TValue) => number;
  readonly aggregate?: TAggregate;
  /** Native number presentation; `format` outranks it for data cells. */
  readonly numberFormat?: Intl.NumberFormatOptions;
  /** Native calendar-date presentation; `format` outranks it for data cells. */
  readonly dateFormat?: PretableDateFormatOptions;
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
    readonly value: PretableAggregateOutputOf<TAggregate, TType>;
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
      | ([TValue] extends [PretableUninferredColumnValue]
          ? [ReturnType<TAccessor>] extends [never]
            ? never
            : 0 extends 1 & ReturnType<TAccessor>
              ? Exclude<PretableColumnType, "date">
              : PretableColumnType
          : never),
    TValue = PretableUninferredColumnValue,
    const TAggregate extends
      | PretableAggregateSpec<TRow, NoInfer<TValue>, TType>
      | ([TValue] extends [PretableUninferredColumnValue]
          ? [ReturnType<TAccessor>] extends [never]
            ? never
            : | PretableAggregateSpec<TRow, never, TType>
              | (TType extends "number"
                  ? "sum" | "avg" | "min" | "max"
                  : TType extends "date"
                    ? "min" | "max"
                    : never)
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
      /** Native number presentation; `format` outranks it for data cells. */
      readonly numberFormat?: Intl.NumberFormatOptions;
      /** Native calendar-date presentation; `format` outranks it for data cells. */
      readonly dateFormat?: PretableDateFormatOptions;
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
        readonly value: PretableAggregateOutputOf<TAggregate, TType>;
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
  > &
    PretableColumnAccessorKind<"computed">;

  accessor<
    const TKey extends Extract<keyof TRow, string>,
    const TType extends PretableColumnTypeFor<TRow[TKey]>,
    const TAggregate extends
      PretableAggregateSpec<TRow, TRow[TKey], TType> | undefined = undefined,
  >(
    key: TKey,
    options: PretableColumnOptions<TRow, TKey, TRow[TKey], TType, TAggregate>,
  ): PretableColumnDefinition<TRow, TKey, TRow[TKey], TType, TAggregate> &
    PretableColumnAccessorKind<"direct">;
}

/** @public */
export function createColumnHelper<
  TRow extends object,
>(): PretableColumnHelper<TRow> {
  return {
    accessor(
      id: string,
      accessorOrOptions: ((row: TRow) => unknown) | object,
      maybeOptions?: object,
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

/**
 * The value type of the column with the given id.
 *
 * An accessored column resolves to its exact declared type. A column that
 * declares no accessor — the loose, id-keyed shape — resolves to `unknown`,
 * not `never`: the value genuinely isn't known statically, and `never` is
 * assignable to everything, so it silently accepted (and made vacuous) every
 * runtime guard written against it. `unknown` forces the guard instead.
 *
 * Two pieces of the shape below are load-bearing:
 *
 * - The inner `never` stays `never`. The lookup distributes over the column
 *   union, so for a mixed tuple every non-matching member contributes to the
 *   result union; `never` is the union identity, so those members vanish and
 *   the matching member's type survives exactly. Falling back to `unknown`
 *   per member would union `unknown` into every answer and destroy that.
 * - The fallback is applied through `[...] extends [infer TResolved]`, which
 *   binds the resolved type once (no repetition, no extra exported alias)
 *   while the tuple wrapper blocks distribution. A naked `extends infer` would
 *   distribute, and distributing over `never` short-circuits the whole
 *   conditional to `never` — which is precisely the case this fallback exists
 *   to catch.
 *
 * @public
 */
export type ColumnValueOf<TColumns, TColumnId extends ColumnIdOf<TColumns>> = [
  TColumns extends readonly (infer TColumn)[]
    ? TColumn extends {
        readonly id: TColumnId;
        readonly accessor: (...args: never[]) => infer TValue;
      }
      ? TValue
      : never
    : never,
] extends [infer TResolved]
  ? [TResolved] extends [never]
    ? unknown
    : TResolved
  : never;

/** @public */
export type ColumnAggregateValueOf<
  TColumns,
  TColumnId extends ColumnIdOf<TColumns>,
> = TColumns extends readonly (infer TColumn)[]
  ? TColumn extends {
      readonly id: TColumnId;
      readonly type: infer TType extends PretableColumnType;
      readonly aggregate?: infer TAggregate;
    }
    ? PretableAggregateOutputOf<TAggregate, TType>
    : never
  : never;

/** @public */
export type PretableAggregatesFor<TColumns> = Prettify<{
  readonly [
    TColumn in TColumns extends readonly (infer TItem)[]
      ? TItem
      : never as TColumn extends {
      readonly id: infer TId extends string;
      readonly type: PretableColumnType;
      readonly aggregate?: infer TAggregate;
    }
      ? [TAggregate] extends [undefined]
        ? never
        : TId
      : never
  ]: TColumn extends {
    readonly type: infer TType extends PretableColumnType;
    readonly aggregate?: infer TAggregate;
  }
    ? PretableAggregateOutputOf<TAggregate, TType>
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
      ? string
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
  TType extends PretableColumnType,
  TAggregate,
> = [TAggregate] extends [undefined]
  ? undefined
  : | (PretableBuiltinAggregate<TValue, TType> extends infer TName
        ? TName extends PretableBuiltinAggregate<TValue, TType>
          ? [PretableAggregateOutputOf<TName, TType>] extends [
              PretableAggregateOutputOf<TAggregate, TType>,
            ]
            ? [PretableAggregateOutputOf<TAggregate, TType>] extends [
                PretableAggregateOutputOf<TName, TType>,
              ]
              ? TName
              : never
            : never
          : never
        : never)
    | PretableCompatibleAggregator<
        TRow,
        TValue,
        PretableAggregateOutputOf<TAggregate, TType>
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
    TType,
    TAggregate
  >;
  readonly ["~pretableColumn"]: {
    readonly row: TRow;
    readonly id: TId;
    readonly value: TValue;
    readonly type: TType;
    readonly aggregate: PretableCompatibleAggregateSpec<
      TRow,
      TValue,
      TType,
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
