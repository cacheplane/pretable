import {
  createColumnHelper,
  type PretableAggregator,
  type PretableAggregateOutputOf,
  type PretableBuiltinAggregate,
  type PretableDerivationsFor,
  type PretableFilterOperandFor,
  type PretableFilterFor,
  type PretableGroupRow,
  type PretableQueryFor,
} from "@pretable/core";
import type { Equal, Expect, IsAny } from "../shared/assert";
import { holdingColumns } from "./columns.types";

const query: PretableQueryFor<typeof holdingColumns> = {
  filters: [
    { columnId: "symbol", operator: "contains", value: "PRE" },
    { columnId: "quantity", operator: "between", value: [1, 100] },
    { columnId: "active", operator: "isAnyOf", value: [true] },
    {
      columnId: "openedAt",
      operator: "dateBetween",
      value: ["1970-01-01", "2026-08-18"],
    },
  ],
  sort: [{ columnId: "quantity", direction: "desc", nulls: "last" }],
  rowGroups: [{ columnId: "symbol", direction: "asc" }],
};
void query;

type _NumberBuiltins = Expect<
  Equal<
    PretableBuiltinAggregate<number | null, "number">,
    "count" | "sum" | "avg" | "min" | "max"
  >
>;
type _DateBuiltins = Expect<
  Equal<
    PretableBuiltinAggregate<string | null, "date">,
    "count" | "min" | "max"
  >
>;
type _TextBuiltins = Expect<
  Equal<PretableBuiltinAggregate<string, "text">, "count">
>;
type _NumberMinOutput = Expect<
  Equal<PretableAggregateOutputOf<"min", "number">, number | null>
>;
type _DateMinOutput = Expect<
  Equal<PretableAggregateOutputOf<"min", "date">, string | null>
>;
type _DateMaxOutput = Expect<
  Equal<PretableAggregateOutputOf<"max", "date">, string | null>
>;
type _CountOutput = Expect<
  Equal<PretableAggregateOutputOf<"count", "date">, number | null>
>;

interface DatedAggregateRow {
  id: number;
  earliest: string | null;
  latest: string;
  label: string;
  timestamp: Date;
}
const datedAggregateColumn = createColumnHelper<DatedAggregateRow>();
const datedAggregateColumns = [
  datedAggregateColumn.accessor("earliest", {
    type: "date",
    aggregate: "min",
    formatAggregate: ({ value }) => {
      const exact: string | null = value;
      return exact ?? "";
    },
  }),
  datedAggregateColumn.accessor("latest", {
    type: "date",
    aggregate: "max",
    formatAggregate: ({ value }) => {
      const exact: string | null = value;
      return exact ?? "";
    },
  }),
] as const;
const dateSpan = {
  init: () => ({ first: null as string | null, last: null as string | null }),
  accumulate: (
    accumulator: {
      readonly first: string | null;
      readonly last: string | null;
    },
    value: string | null,
  ) => ({
    first: accumulator.first ?? value,
    last: value ?? accumulator.last,
  }),
  merge: (
    left: { readonly first: string | null; readonly last: string | null },
    right: { readonly first: string | null; readonly last: string | null },
  ) => ({
    first: left.first ?? right.first,
    last: right.last ?? left.last,
  }),
  finalize: (accumulator: {
    readonly first: string | null;
    readonly last: string | null;
  }) => ({ ...accumulator }),
} satisfies PretableAggregator<
  DatedAggregateRow,
  string | null,
  { readonly first: string | null; readonly last: string | null },
  { readonly first: string | null; readonly last: string | null }
>;
const structuralFinalizeColumn = datedAggregateColumn.accessor(
  "dateSpan",
  (row) => row.earliest,
  {
    type: "date",
    aggregate: dateSpan,
    formatAggregate: ({ value }) => {
      const exact: {
        readonly first: string | null;
        readonly last: string | null;
      } = value;
      return `${exact.first ?? ""}:${exact.last ?? ""}`;
    },
  },
);
type _DatedAggregateValues = Expect<
  Equal<
    PretableGroupRow<typeof datedAggregateColumns>["aggregates"],
    { readonly earliest: string | null; readonly latest: string | null }
  >
>;

datedAggregateColumn.accessor("earliest", {
  type: "date",
  // @ts-expect-error date columns reject numeric sum
  aggregate: "sum",
});
datedAggregateColumn.accessor("latest", {
  type: "date",
  // @ts-expect-error date columns reject numeric average
  aggregate: "avg",
});
datedAggregateColumn.accessor("label", {
  type: "text",
  // @ts-expect-error text columns do not gain string extrema
  aggregate: "min",
});
datedAggregateColumn.accessor("label", {
  type: "text",
  // @ts-expect-error text columns do not gain string extrema
  aggregate: "max",
});
datedAggregateColumn.accessor("timestamp", {
  // @ts-expect-error Date-valued columns cannot opt into calendar-date extrema
  type: "date",
  // @ts-expect-error Date-valued extrema are not admitted as built-ins
  aggregate: "min",
});

void datedAggregateColumns;
void structuralFinalizeColumn;
void (null as unknown as _NumberBuiltins);
void (null as unknown as _DateBuiltins);
void (null as unknown as _TextBuiltins);
void (null as unknown as _NumberMinOutput);
void (null as unknown as _DateMinOutput);
void (null as unknown as _DateMaxOutput);
void (null as unknown as _CountOutput);
void (null as unknown as _DatedAggregateValues);

const invalidNumberOperator: PretableQueryFor<typeof holdingColumns> = {
  filters: [
    // @ts-expect-error number columns reject text-only operators and operands
    { columnId: "quantity", operator: "contains", value: "10" },
  ],
  sort: [],
  rowGroups: [],
};
void invalidNumberOperator;

const invalidBooleanOperand: PretableQueryFor<typeof holdingColumns> = {
  filters: [
    // @ts-expect-error boolean set filters require boolean values
    { columnId: "active", operator: "isAnyOf", value: ["yes"] },
  ],
  sort: [],
  rowGroups: [],
};
void invalidBooleanOperand;

const invalidSort: PretableQueryFor<typeof holdingColumns> = {
  filters: [],
  // @ts-expect-error sort IDs are limited to declared columns
  sort: [{ columnId: "missing", direction: "asc" }],
  rowGroups: [],
};
void invalidSort;

const invalidGroup: PretableQueryFor<typeof holdingColumns> = {
  filters: [],
  sort: [],
  // @ts-expect-error group IDs are limited to declared group-compatible columns
  rowGroups: [{ columnId: "missing" }],
};
void invalidGroup;

interface FilterOperandRow {
  id: number;
  objectText: { readonly label: string };
  unknownText: unknown;
  nullableText: string | null;
  nullableNumber: number | null;
  nullableDate: string | null;
  nullableEnum: "draft" | "published" | null;
  opaqueEnum: object;
  nullableBoolean: boolean | null;
}

const filterOperandColumn = createColumnHelper<FilterOperandRow>();
const filterOperandColumns = [
  filterOperandColumn.accessor("objectText", { type: "text" }),
  filterOperandColumn.accessor("unknownText", { type: "text" }),
  filterOperandColumn.accessor("nullableText", { type: "text" }),
  filterOperandColumn.accessor("nullableNumber", { type: "number" }),
  filterOperandColumn.accessor("nullableDate", { type: "date" }),
  filterOperandColumn.accessor("nullableEnum", { type: "enum" }),
  filterOperandColumn.accessor("opaqueEnum", { type: "enum" }),
  filterOperandColumn.accessor("nullableBoolean", { type: "boolean" }),
] as const;

type _ObjectTextOperand = Expect<
  Equal<PretableFilterOperandFor<{ readonly label: string }, "text">, string>
>;
type _NullableDateOperand = Expect<
  Equal<PretableFilterOperandFor<string | null, "date">, string>
>;
type _NullableEnumOperand = Expect<
  Equal<
    PretableFilterOperandFor<"draft" | "published" | null, "enum">,
    "draft" | "published"
  >
>;
type _OpaqueEnumOperand = Expect<
  Equal<PretableFilterOperandFor<object, "enum">, string>
>;

const validFilterOperands: PretableQueryFor<typeof filterOperandColumns> = {
  filters: [
    { columnId: "objectText", operator: "contains", value: "needle" },
    { columnId: "unknownText", operator: "equals", value: "known operand" },
    { columnId: "nullableText", operator: "startsWith", value: "prefix" },
    { columnId: "nullableNumber", operator: "gte", value: 1 },
    { columnId: "nullableNumber", operator: "between", value: [1, 2] },
    { columnId: "nullableDate", operator: "on", value: "2026-08-10" },
    { columnId: "nullableDate", operator: "before", value: "2026-08-11" },
    { columnId: "nullableDate", operator: "after", value: "2026-08-09" },
    {
      columnId: "nullableDate",
      operator: "dateBetween",
      value: ["2026-08-01", "2026-08-31"],
    },
    { columnId: "nullableEnum", operator: "isAnyOf", value: ["draft"] },
    { columnId: "opaqueEnum", operator: "isNoneOf", value: ["hidden"] },
    {
      columnId: "nullableBoolean",
      operator: "isAnyOf",
      value: [true, false],
    },
    { columnId: "objectText", operator: "isEmpty" },
  ],
  sort: [],
  rowGroups: [],
};
void validFilterOperands;

const acceptFilterOperand = (
  filter: PretableFilterFor<typeof filterOperandColumns>,
) => filter;

// @ts-expect-error text operands are strings even when the accessor returns an object
acceptFilterOperand({ columnId: "objectText", operator: "equals", value: {} });
// @ts-expect-error text operands reject numbers
acceptFilterOperand({ columnId: "objectText", operator: "equals", value: 1 });
acceptFilterOperand({
  columnId: "objectText",
  operator: "equals",
  // @ts-expect-error text operands reject null
  value: null,
});
// @ts-expect-error unknown accessors classified as text reject object operands
acceptFilterOperand({ columnId: "unknownText", operator: "equals", value: {} });
// @ts-expect-error unknown accessors classified as text reject number operands
acceptFilterOperand({ columnId: "unknownText", operator: "equals", value: 1 });
acceptFilterOperand({
  columnId: "unknownText",
  operator: "equals",
  // @ts-expect-error unknown accessors classified as text reject null operands
  value: null,
});
// @ts-expect-error text columns reject number-only operators
acceptFilterOperand({ columnId: "unknownText", operator: "gte", value: "1" });
acceptFilterOperand({
  columnId: "unknownText",
  operator: "isEmpty",
  // @ts-expect-error empty operators do not accept an operand
  value: "",
});
acceptFilterOperand({
  columnId: "nullableText",
  operator: "equals",
  // @ts-expect-error nullable text columns still reject null operands
  value: null,
});
acceptFilterOperand({
  columnId: "nullableNumber",
  operator: "equals",
  // @ts-expect-error nullable number columns reject null scalar operands
  value: null,
});
acceptFilterOperand({
  columnId: "nullableNumber",
  operator: "between",
  // @ts-expect-error nullable number ranges reject null endpoints
  value: [1, null],
});
// @ts-expect-error nullable date columns reject null scalar operands
acceptFilterOperand({ columnId: "nullableDate", operator: "on", value: null });
// @ts-expect-error calendar-date operands reject epoch numbers
acceptFilterOperand({ columnId: "nullableDate", operator: "on", value: 0 });
acceptFilterOperand({
  columnId: "nullableDate",
  operator: "on",
  // @ts-expect-error calendar-date operands reject Date instances
  value: new Date(0),
});
acceptFilterOperand({
  columnId: "nullableDate",
  operator: "dateBetween",
  // @ts-expect-error nullable date ranges reject null endpoints
  value: ["2026-08-01", null],
});
acceptFilterOperand({
  columnId: "nullableEnum",
  operator: "isAnyOf",
  // @ts-expect-error known enum operands preserve their declared string literals
  value: ["archived"],
});
acceptFilterOperand({
  columnId: "nullableEnum",
  operator: "isAnyOf",
  // @ts-expect-error nullable enums reject null selections
  value: [null],
});
acceptFilterOperand({
  columnId: "nullableEnum",
  operator: "isAnyOf",
  // @ts-expect-error enums reject non-string selections
  value: [1],
});
acceptFilterOperand({
  columnId: "opaqueEnum",
  operator: "isAnyOf",
  // @ts-expect-error opaque enums use string operands rather than raw object values
  value: [{}],
});
acceptFilterOperand({
  columnId: "opaqueEnum",
  operator: "isAnyOf",
  // @ts-expect-error opaque enums reject null selections
  value: [null],
});
acceptFilterOperand({
  columnId: "nullableBoolean",
  operator: "isAnyOf",
  // @ts-expect-error nullable boolean selections reject null
  value: [true, null],
});

void (null as unknown as _ObjectTextOperand);
void (null as unknown as _NullableDateOperand);
void (null as unknown as _NullableEnumOperand);
void (null as unknown as _OpaqueEnumOperand);

type Aggregates = PretableGroupRow<typeof holdingColumns>["aggregates"];
const aggregates: Aggregates = {
  symbol: 1,
  quantity: 42,
  quantityLabel: "42.00",
};
void aggregates;

const invalidAggregateOutput: Aggregates = {
  symbol: 1,
  quantity: 42,
  // @ts-expect-error custom aggregate output flows into group records
  quantityLabel: 42,
};
void invalidAggregateOutput;

type QuantityDerivation = PretableDerivationsFor<typeof holdingColumns>[1];
type CompatibleAggregate = Extract<QuantityDerivation["aggregate"], object>;
type CompatibleAccumulator = Parameters<CompatibleAggregate["accumulate"]>[0];
type _AccumulatorDoesNotLeakAny = Expect<
  Equal<IsAny<CompatibleAccumulator>, false>
>;
void (null as unknown as _AccumulatorDoesNotLeakAny);
