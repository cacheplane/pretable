import {
  createLocalRowModel as createInternalLocalRowModel,
  type ColumnDescriptorOf,
  type CreateLocalRowModelOptions as InternalCreateLocalRowModelOptions,
  type PretableDerivationsFor,
  type PretableExpansionDefault,
  type PretableQueryFor,
  type Prettify,
  type PretableRowId,
  type PretableRowModel,
} from "@pretable-internal/row-model";

type RowForColumns<TColumns> =
  ColumnDescriptorOf<TColumns> extends {
    readonly row: infer TRow extends object;
  }
    ? TRow
    : never;

/** Options for a local row model with an explicit row-ID accessor. @public */
export interface CreateLocalRowModelOptions<
  TColumns,
  TRowId extends PretableRowId,
> {
  readonly rows: readonly (TColumns extends readonly (infer TColumn)[]
    ? TColumn extends {
        readonly accessor: (row: infer TRow extends object) => unknown;
      }
      ? TRow
      : never
    : never)[];
  readonly columns: TColumns;
  readonly derivations?: PretableDerivationsFor<TColumns>;
  readonly query?: PretableQueryFor<TColumns>;
  readonly initialExpansion?: PretableExpansionDefault;
  readonly aggregateFilteredRows?: boolean;
  readonly getRowId: (
    row: TColumns extends readonly (infer TColumn)[]
      ? TColumn extends {
          readonly accessor: (row: infer TRow extends object) => unknown;
        }
        ? TRow
        : never
      : never,
  ) => TRowId;
}

/** Options for a local row model using the conventional `row.id`. @public */
export type CreateLocalRowModelWithDefaultIdOptions<TColumns> = (
  TColumns extends readonly (infer TColumn)[]
    ? TColumn extends {
        readonly accessor: (row: infer TRow extends object) => unknown;
      }
      ? TRow
      : never
    : never
) extends { readonly id: PretableRowId }
  ? Prettify<{
      readonly rows: readonly (TColumns extends readonly (infer TColumn)[]
        ? TColumn extends {
            readonly accessor: (row: infer TRow extends object) => unknown;
          }
          ? TRow
          : never
        : never)[];
      readonly columns: TColumns;
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
export function createLocalRowModel<const TColumns extends readonly unknown[]>(
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
  const TColumns extends readonly unknown[],
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
): PretableRowModel<RowForColumns<TColumns>, TRowId, TColumns> {
  return createInternalLocalRowModel(
    options as unknown as InternalCreateLocalRowModelOptions<TColumns, TRowId>,
  );
}
