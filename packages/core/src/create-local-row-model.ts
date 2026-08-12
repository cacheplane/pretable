import {
  createLocalRowModel as createInternalLocalRowModel,
  type CreateLocalRowModelOptions as InternalCreateLocalRowModelOptions,
  type PretableDerivationsFor,
  type PretableExpansionDefault,
  type PretableQueryFor,
  type Prettify,
  type PretableRowId,
  type PretableRowModel,
} from "@pretable-internal/row-model";

/** Options for a local row model with an explicit row-ID accessor. @public */
export interface CreateLocalRowModelOptions<
  TColumns,
  TRowId extends PretableRowId,
> {
  readonly rows: readonly (TColumns extends readonly [
    infer TFirstColumn,
    ...(readonly unknown[]),
  ]
    ? TFirstColumn extends {
        readonly accessor: (row: infer TRow extends object) => infer TValue;
      }
      ? [TValue] extends [unknown]
        ? TRow
        : never
      : never
    : never)[];
  readonly columns: TColumns & {
    readonly [K in keyof TColumns]: TColumns[K] extends {
      readonly accessor: (
        row: infer TColumnRow extends object,
      ) => infer TColumnValue;
    }
      ? [TColumnValue] extends [unknown]
        ? TColumns extends readonly [
            infer TFirstColumn,
            ...(readonly unknown[]),
          ]
          ? TFirstColumn extends {
              readonly accessor: (
                row: infer TFirstRow extends object,
              ) => infer TFirstValue;
            }
            ? [TFirstValue] extends [unknown]
              ? [TColumnRow] extends [TFirstRow]
                ? [TFirstRow] extends [TColumnRow]
                  ? TColumns[K]
                  : never
                : never
              : never
            : never
          : never
        : never
      : never;
  };
  readonly derivations?: PretableDerivationsFor<TColumns>;
  readonly query?: PretableQueryFor<TColumns>;
  readonly initialExpansion?: PretableExpansionDefault;
  readonly aggregateFilteredRows?: boolean;
  readonly getRowId: (
    row: TColumns extends readonly [infer TFirstColumn, ...(readonly unknown[])]
      ? TFirstColumn extends {
          readonly accessor: (row: infer TRow extends object) => infer TValue;
        }
        ? [TValue] extends [unknown]
          ? TRow
          : never
        : never
      : never,
  ) => TRowId;
}

/** Options for a local row model using the conventional `row.id`. @public */
export type CreateLocalRowModelWithDefaultIdOptions<TColumns> = (
  TColumns extends readonly [infer TFirstColumn, ...(readonly unknown[])]
    ? TFirstColumn extends {
        readonly accessor: (row: infer TRow extends object) => infer TValue;
      }
      ? [TValue] extends [unknown]
        ? TRow
        : never
      : never
    : never
) extends { readonly id: PretableRowId }
  ? Prettify<{
      readonly rows: readonly (TColumns extends readonly [
        infer TFirstColumn,
        ...(readonly unknown[]),
      ]
        ? TFirstColumn extends {
            readonly accessor: (row: infer TRow extends object) => infer TValue;
          }
          ? [TValue] extends [unknown]
            ? TRow
            : never
          : never
        : never)[];
      readonly columns: TColumns & {
        readonly [K in keyof TColumns]: TColumns[K] extends {
          readonly accessor: (
            row: infer TColumnRow extends object,
          ) => infer TColumnValue;
        }
          ? [TColumnValue] extends [unknown]
            ? TColumns extends readonly [
                infer TFirstColumn,
                ...(readonly unknown[]),
              ]
              ? TFirstColumn extends {
                  readonly accessor: (
                    row: infer TFirstRow extends object,
                  ) => infer TFirstValue;
                }
                ? [TFirstValue] extends [unknown]
                  ? [TColumnRow] extends [TFirstRow]
                    ? [TFirstRow] extends [TColumnRow]
                      ? TColumns[K]
                      : never
                    : never
                  : never
                : never
              : never
            : never
          : never;
      };
      readonly derivations?: PretableDerivationsFor<TColumns>;
      readonly query?: PretableQueryFor<TColumns>;
      readonly initialExpansion?: PretableExpansionDefault;
      readonly aggregateFilteredRows?: boolean;
      readonly getRowId?: undefined;
    }>
  : never;

/**
 * Creates a local row model using the conventional `row.id` field.
 *
 * @public
 */
export function createLocalRowModel<
  const TColumns extends readonly [unknown, ...(readonly unknown[])],
>(
  options: CreateLocalRowModelWithDefaultIdOptions<TColumns>,
): PretableRowModel<
  CreateLocalRowModelWithDefaultIdOptions<TColumns>["rows"][number],
  CreateLocalRowModelWithDefaultIdOptions<TColumns>["rows"][number] extends {
    readonly id: infer TRowId extends PretableRowId;
  }
    ? TRowId
    : never,
  TColumns
>;
/**
 * Creates a local row model using an explicit string or number row ID.
 *
 * @public
 */
export function createLocalRowModel<
  const TColumns extends readonly [unknown, ...(readonly unknown[])],
  const TRowId extends PretableRowId,
>(
  options: CreateLocalRowModelOptions<TColumns, TRowId>,
): PretableRowModel<
  CreateLocalRowModelOptions<TColumns, TRowId>["rows"][number],
  TRowId,
  TColumns
>;
export function createLocalRowModel<
  const TColumns extends readonly unknown[],
  const TRowId extends PretableRowId,
>(
  options:
    | CreateLocalRowModelWithDefaultIdOptions<TColumns>
    | CreateLocalRowModelOptions<TColumns, TRowId>,
): unknown {
  return createInternalLocalRowModel(
    options as unknown as InternalCreateLocalRowModelOptions<TColumns, TRowId>,
  );
}
