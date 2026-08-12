import {
  createColumnHelper,
  createLocalRowModel,
  type ColumnsOf,
  type PretableRowModelError,
  type RowIdOf,
  type RowOf,
} from "@pretable/core";
import type { Equal, Expect } from "../shared/assert";
import { holdingColumns, type Holding } from "./columns.types";

const holdings: readonly Holding[] = [
  {
    id: 1,
    symbol: "PRE",
    quantity: 10,
    active: true,
    openedAt: new Date(0),
  },
];

const conventional = createLocalRowModel({
  rows: holdings,
  columns: holdingColumns,
});
type _ConventionalRow = Expect<Equal<RowOf<typeof conventional>, Holding>>;
type _ConventionalId = Expect<Equal<RowIdOf<typeof conventional>, number>>;
type _ConventionalColumns = Expect<
  Equal<ColumnsOf<typeof conventional>, typeof holdingColumns>
>;

conventional.applyTransaction({
  update: [{ id: 1, changes: { quantity: 11, active: false } }],
  remove: [1],
});
createLocalRowModel({
  rows: holdings,
  columns: holdingColumns,
  // @ts-expect-error deterministic scheduler injection is not public API
  transitionScheduler: { schedule: () => () => {} },
});
// @ts-expect-error the conventional id remains numeric
conventional.applyTransaction({ remove: ["1"] });
conventional.applyTransaction({
  update: [
    {
      id: 1,
      // @ts-expect-error transaction patches only accept row keys
      changes: { missing: true },
    },
  ],
});
// @ts-expect-error setRows retains the model's inferred row type
conventional.setRows([{ id: 2, symbol: "BAD" }]);

interface AccountRow {
  key: `acct_${number}`;
  label: string;
}
const accountColumn = createColumnHelper<AccountRow>();
const accountColumns = [
  accountColumn.accessor("label", { type: "text" }),
] as const;
const accountModel = createLocalRowModel({
  rows: [{ key: "acct_1", label: "Cash" }],
  columns: accountColumns,
  getRowId: (row) => row.key,
});
type _TemplateId = Expect<
  Equal<RowIdOf<typeof accountModel>, `acct_${number}`>
>;
accountModel.applyTransaction({ remove: ["acct_2"] });
// @ts-expect-error explicit template IDs reject arbitrary strings
accountModel.applyTransaction({ remove: ["holding_2"] });

interface StringKeyRow {
  key: string;
  value: string;
}
const stringColumn = createColumnHelper<StringKeyRow>();
const stringColumns = [
  stringColumn.accessor("value", { type: "text" }),
] as const;
const stringModel = createLocalRowModel({
  rows: [{ key: "one", value: "one" }],
  columns: stringColumns,
  getRowId: (row) => row.key,
});
type _ExplicitStringId = Expect<Equal<RowIdOf<typeof stringModel>, string>>;

interface NumericKeyRow {
  key: number;
  value: string;
}
const numericColumn = createColumnHelper<NumericKeyRow>();
const numericColumns = [
  numericColumn.accessor("value", { type: "text" }),
] as const;
const numericModel = createLocalRowModel({
  rows: [{ key: 1, value: "one" }],
  columns: numericColumns,
  getRowId: (row) => row.key,
});
type _ExplicitNumberId = Expect<Equal<RowIdOf<typeof numericModel>, number>>;

interface AlphaRow {
  id: string;
  alpha: string;
}
interface BetaRow {
  id: string;
  beta: number;
}
const alphaColumn = createColumnHelper<AlphaRow>();
const secondAlphaColumn = createColumnHelper<AlphaRow>();
const betaColumn = createColumnHelper<BetaRow>();
const mixedRowColumns = [
  alphaColumn.accessor("alpha", { type: "text" }),
  betaColumn.accessor("beta", { type: "number" }),
] as const;
const sameRowColumns = [
  alphaColumn.accessor("alpha", { type: "text" }),
  secondAlphaColumn.accessor("id", { type: "text" }),
] as const;

interface BaseRow {
  id: string;
}
interface DetailedRow extends BaseRow {
  detail: string;
}
const baseColumn = createColumnHelper<BaseRow>();
const detailedColumn = createColumnHelper<DetailedRow>();
const subtypeMixedColumns = [
  baseColumn.accessor("id", { type: "text" }),
  detailedColumn.accessor("detail", { type: "text" }),
] as const;

const sameRowDefaultModel = createLocalRowModel({
  rows: [{ id: "alpha-1", alpha: "one" }],
  columns: sameRowColumns,
});
const sameRowExplicitModel = createLocalRowModel({
  rows: [{ id: "alpha-1", alpha: "one" }],
  columns: sameRowColumns,
  getRowId: (row) => row.id,
});
type _SameRowDefault = Expect<
  Equal<RowOf<typeof sameRowDefaultModel>, AlphaRow>
>;
type _SameRowExplicit = Expect<
  Equal<RowOf<typeof sameRowExplicitModel>, AlphaRow>
>;

createLocalRowModel({
  rows: [{ id: "alpha-1", alpha: "one" }],
  // @ts-expect-error one model cannot combine columns from incompatible row helpers
  columns: mixedRowColumns,
});
createLocalRowModel({
  rows: [{ id: "alpha-1", alpha: "one" }],
  // @ts-expect-error explicit IDs do not make incompatible row helpers compatible
  columns: mixedRowColumns,
  getRowId: (row: AlphaRow) => row.id,
});
// @ts-expect-error row-helper correlation is invariant, even for row subtypes
createLocalRowModel({
  rows: [{ id: "detail-1", detail: "one" }],
  columns: subtypeMixedColumns,
});

// @ts-expect-error rows without a conventional id require getRowId
createLocalRowModel({
  rows: [{ key: 1, value: "one" }],
  columns: numericColumns,
});
// @ts-expect-error row IDs must be strings or numbers
createLocalRowModel({
  rows: [{ key: 1, value: "one" }],
  columns: numericColumns,
  getRowId: () => true,
});
// @ts-expect-error rows must match the row type carried by the columns
createLocalRowModel({
  rows: [{ key: "wrong", value: "one" }],
  columns: numericColumns,
  getRowId: (row: NumericKeyRow) => row.key,
});

function handleModelError(error: PretableRowModelError) {
  const code: string = error.code;
  const operation: string = error.operation;
  return `${code}:${operation}`;
}

void handleModelError;
void (null as unknown as _ConventionalRow);
void (null as unknown as _ConventionalId);
void (null as unknown as _ConventionalColumns);
void (null as unknown as _TemplateId);
void (null as unknown as _ExplicitStringId);
void (null as unknown as _ExplicitNumberId);
void (null as unknown as _SameRowDefault);
void (null as unknown as _SameRowExplicit);
