import type { PretableRowId } from "@pretable/core";

interface WritableColumn<
  TRow extends object,
  TColumnId extends string,
  TValue,
> {
  readonly id: TColumnId;
  readonly accessorKey?: Extract<keyof TRow, string>;
  readonly setValue?: (input: {
    readonly row: TRow;
    readonly value: TValue;
  }) => Partial<TRow>;
}

/** Derive one immutable, minimal row-change proposal from an edited value. */
export function deriveRowChange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumnId extends string,
  TValue,
>(input: {
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly column: WritableColumn<TRow, TColumnId, TValue>;
  readonly value: TValue;
}): {
  readonly rowId: TRowId;
  readonly columnId: TColumnId;
  readonly previousRow: TRow;
  readonly row: TRow;
  readonly changes: Partial<TRow>;
  readonly value: TValue;
} {
  const changes =
    input.column.setValue !== undefined
      ? input.column.setValue({ row: input.row, value: input.value })
      : input.column.accessorKey !== undefined
        ? ({ [input.column.accessorKey]: input.value } as Partial<TRow>)
        : null;
  if (changes === null) {
    throw new TypeError(
      `Editable computed column "${input.column.id}" requires setValue({ row, value }).`,
    );
  }
  return {
    rowId: input.rowId,
    columnId: input.column.id,
    previousRow: input.row,
    row: Object.assign({}, input.row, changes),
    changes,
    value: input.value,
  };
}
