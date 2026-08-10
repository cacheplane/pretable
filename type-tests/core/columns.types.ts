import {
  createColumnHelper,
  type ColumnIdOf,
  type ColumnValueOf,
  type PretableAggregator,
} from "@pretable/core";
import type { Equal, Expect } from "../shared/assert";

export interface Holding {
  id: number;
  symbol: string;
  quantity: number;
  active: boolean;
  openedAt: Date;
}

const column = createColumnHelper<Holding>();

const labelTotal: PretableAggregator<
  Holding,
  number,
  { readonly total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value, row) => ({
    total: accumulator.total + value + row.id * 0,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  finalize: ({ total }) => total.toFixed(2),
};

export const holdingColumns = [
  column.accessor("symbol", { type: "text", aggregate: "count" }),
  column.accessor("quantity", {
    type: "number",
    aggregate: "sum",
    format: ({ value, row, column }) =>
      `${column.id}:${row.symbol}:${value.toFixed(0)}`,
    formatAggregate: ({ value, column }) =>
      `${column.id}:${value?.toFixed(0) ?? ""}`,
  }),
  column.accessor("active", { type: "boolean" }),
  column.accessor("openedAt", { type: "date" }),
  column.accessor("quantityLabel", (row) => row.quantity, {
    type: "number",
    aggregate: labelTotal,
    formatAggregate: ({ value }) => value.toUpperCase(),
  }),
] as const;

type _ColumnIds = Expect<
  Equal<
    ColumnIdOf<typeof holdingColumns>,
    "symbol" | "quantity" | "active" | "openedAt" | "quantityLabel"
  >
>;
type _Quantity = Expect<
  Equal<ColumnValueOf<typeof holdingColumns, "quantity">, number>
>;
type _Computed = Expect<
  Equal<ColumnValueOf<typeof holdingColumns, "quantityLabel">, number>
>;

// @ts-expect-error ordinary row interfaces still reject unknown accessor keys
column.accessor("missing", { type: "text" });

column.accessor("symbol", { type: "text", aggregate: "count" });
// @ts-expect-error numeric built-in aggregates are unavailable for text values
column.accessor("symbol", { type: "text", aggregate: "sum" });
// @ts-expect-error a number-valued accessor cannot declare a text column
column.accessor("quantity", { type: "text" });

interface NumericEligibilityRow {
  nullableNumber: number | null;
  nullOnly: null;
  undefinedOnly: undefined;
  numberOrText: number | string;
}
const numericEligibilityColumn = createColumnHelper<NumericEligibilityRow>();

numericEligibilityColumn.accessor("nullableNumber", {
  type: "number",
  aggregate: "sum",
});
numericEligibilityColumn.accessor(
  "computedNullableNumber",
  (row) => row.nullableNumber,
  { type: "number", aggregate: "avg" },
);
numericEligibilityColumn.accessor("nullOnly", {
  // @ts-expect-error null-only values are not numeric columns
  type: "number",
  // @ts-expect-error null-only values are not summable
  aggregate: "sum",
});
numericEligibilityColumn.accessor("undefinedOnly", {
  // @ts-expect-error undefined-only values are not numeric columns
  type: "number",
  // @ts-expect-error undefined-only values are not averageable
  aggregate: "avg",
});
numericEligibilityColumn.accessor("numberOrText", {
  type: "number",
  // @ts-expect-error a number|string value is not wholly numeric
  aggregate: "sum",
});
numericEligibilityColumn.accessor("computedNullOnly", (row) => row.nullOnly, {
  // @ts-expect-error computed null-only values are not numeric columns
  type: "number",
  // @ts-expect-error computed null-only values are not summable
  aggregate: "sum",
});
numericEligibilityColumn.accessor(
  "computedUndefinedOnly",
  (row) => row.undefinedOnly,
  {
    // @ts-expect-error computed undefined-only values are not numeric columns
    type: "number",
    // @ts-expect-error computed undefined-only values are not averageable
    aggregate: "avg",
  },
);

void (null as unknown as _ColumnIds);
void (null as unknown as _Quantity);
void (null as unknown as _Computed);
