/**
 * `rowIds` is the grid's row-id type, not the `PretableRowId` union.
 *
 * The union is `string | number`, so typing the set against it accepted a
 * `Set<number>` on a string-id grid and produced a header-only file. That is
 * the silent narrowing this module refuses everywhere else — an unknown
 * `columnIds` throws rather than dropping a column, and `onlySelected` with a
 * `rowIds` throws rather than picking one — so a mistyped id quietly emptying
 * the file was out of character.
 *
 * Every `@ts-expect-error` below is load-bearing in both directions: if the
 * constraint is loosened again, the directive becomes unused and TypeScript
 * reports THAT, so this file cannot silently stop testing anything.
 */
import {
  PretableSurface,
  serializeCsv,
  type PretableColumn,
  type PretableCsvOptions,
  type PretableRowModelSnapshot,
  type PretableSurfaceGrid,
} from "@pretable/react";

interface StringIdRow extends Record<string, unknown> {
  id: string;
  symbol: string;
}

interface NumberIdRow extends Record<string, unknown> {
  id: number;
  symbol: string;
}

declare const stringSnapshot: PretableRowModelSnapshot<
  StringIdRow,
  string,
  readonly { readonly id: string }[]
>;
declare const numberSnapshot: PretableRowModelSnapshot<
  NumberIdRow,
  number,
  readonly { readonly id: string }[]
>;
declare const stringColumns: readonly PretableColumn<StringIdRow>[];
declare const numberColumns: readonly PretableColumn<NumberIdRow>[];

// The matching id type is accepted.
serializeCsv({
  rowModelSnapshot: stringSnapshot,
  columns: stringColumns,
  scope: "all",
  options: { rowIds: new Set(["r1", "r2"]) },
});

serializeCsv({
  rowModelSnapshot: numberSnapshot,
  columns: numberColumns,
  scope: "all",
  options: { rowIds: new Set([1, 2]) },
});

serializeCsv({
  rowModelSnapshot: stringSnapshot,
  columns: stringColumns,
  scope: "all",
  // @ts-expect-error a number id cannot name a row on a string-id grid
  options: { rowIds: new Set([1, 2]) },
});

serializeCsv({
  rowModelSnapshot: numberSnapshot,
  columns: numberColumns,
  scope: "all",
  // @ts-expect-error a string id cannot name a row on a number-id grid
  options: { rowIds: new Set(["r1"]) },
});

// The same rule reaches the surface, through both of its doors: the per-call
// options and the `csvOptions` prop. Guarding one and not the other is exactly
// the defect the merged-value check in `exportCsv` was written to close.
declare const grid: PretableSurfaceGrid<
  StringIdRow,
  string,
  readonly PretableColumn<StringIdRow>[]
>;

grid.exportCsv({ rowIds: new Set(["r1"]) });
// @ts-expect-error a number id cannot name a row on a string-id grid
grid.exportCsv({ rowIds: new Set([1]) });

declare const rows: StringIdRow[];

export const wellTypedSurface = (
  <PretableSurface<StringIdRow>
    ariaLabel="Positions"
    columns={stringColumns}
    csvOptions={{ rowIds: new Set(["r1"]) }}
    getRowId={(row) => row.id}
    rows={rows}
    viewportHeight={520}
  />
);

export const mistypedSurface = (
  <PretableSurface<StringIdRow>
    ariaLabel="Positions"
    columns={stringColumns}
    // @ts-expect-error a number id cannot name a row on a string-id grid
    csvOptions={{ rowIds: new Set([1]) }}
    // Annotated because the rejected `csvOptions` above collapses inference for
    // the rest of the element; without it the failure this block asserts would
    // be joined by an unrelated implicit-`any`, and a reader could not tell
    // which of the two the `@ts-expect-error` was for.
    getRowId={(row: StringIdRow) => row.id}
    rows={rows}
    viewportHeight={520}
  />
);

// The default parameter keeps a bare `PretableCsvOptions` usable — the type is
// referenced by name in docs and by consumers who never touch `rowIds`.
export const bareOptions: PretableCsvOptions = { delimiter: ";", bom: false };
