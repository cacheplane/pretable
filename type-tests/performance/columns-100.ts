import {
  createColumnHelper,
  createLocalRowModel,
  type ColumnsOf,
  type PretableAggregator,
  type PretableGroupRow,
  type PretableQueryFor,
  type RowOf,
} from "@pretable/core";

interface WideRow100 {
  readonly id: number;
  readonly col_000: number;
  readonly col_001: string;
  readonly col_002: boolean;
  readonly col_003: Date;
  readonly col_004: "alpha" | "beta";
  readonly col_005: number;
  readonly col_006: string;
  readonly col_007: boolean;
  readonly col_008: Date;
  readonly col_009: "alpha" | "beta";
  readonly col_010: number;
  readonly col_011: string;
  readonly col_012: boolean;
  readonly col_013: Date;
  readonly col_014: "alpha" | "beta";
  readonly col_015: number;
  readonly col_016: string;
  readonly col_017: boolean;
  readonly col_018: Date;
  readonly col_019: "alpha" | "beta";
  readonly col_020: number;
  readonly col_021: string;
  readonly col_022: boolean;
  readonly col_023: Date;
  readonly col_024: "alpha" | "beta";
  readonly col_025: number;
  readonly col_026: string;
  readonly col_027: boolean;
  readonly col_028: Date;
  readonly col_029: "alpha" | "beta";
  readonly col_030: number;
  readonly col_031: string;
  readonly col_032: boolean;
  readonly col_033: Date;
  readonly col_034: "alpha" | "beta";
  readonly col_035: number;
  readonly col_036: string;
  readonly col_037: boolean;
  readonly col_038: Date;
  readonly col_039: "alpha" | "beta";
  readonly col_040: number;
  readonly col_041: string;
  readonly col_042: boolean;
  readonly col_043: Date;
  readonly col_044: "alpha" | "beta";
  readonly col_045: number;
  readonly col_046: string;
  readonly col_047: boolean;
  readonly col_048: Date;
  readonly col_049: "alpha" | "beta";
  readonly col_050: number;
  readonly col_051: string;
  readonly col_052: boolean;
  readonly col_053: Date;
  readonly col_054: "alpha" | "beta";
  readonly col_055: number;
  readonly col_056: string;
  readonly col_057: boolean;
  readonly col_058: Date;
  readonly col_059: "alpha" | "beta";
  readonly col_060: number;
  readonly col_061: string;
  readonly col_062: boolean;
  readonly col_063: Date;
  readonly col_064: "alpha" | "beta";
  readonly col_065: number;
  readonly col_066: string;
  readonly col_067: boolean;
  readonly col_068: Date;
  readonly col_069: "alpha" | "beta";
  readonly col_070: number;
  readonly col_071: string;
  readonly col_072: boolean;
  readonly col_073: Date;
  readonly col_074: "alpha" | "beta";
  readonly col_075: number;
  readonly col_076: string;
  readonly col_077: boolean;
  readonly col_078: Date;
  readonly col_079: "alpha" | "beta";
  readonly col_080: number;
  readonly col_081: string;
  readonly col_082: boolean;
  readonly col_083: Date;
  readonly col_084: "alpha" | "beta";
  readonly col_085: number;
  readonly col_086: string;
  readonly col_087: boolean;
  readonly col_088: Date;
  readonly col_089: "alpha" | "beta";
  readonly col_090: number;
  readonly col_091: string;
  readonly col_092: boolean;
  readonly col_093: Date;
  readonly col_094: "alpha" | "beta";
  readonly col_095: number;
  readonly col_096: string;
  readonly col_097: boolean;
  readonly col_098: Date;
  readonly col_099: "alpha" | "beta";
}

const column100 = createColumnHelper<WideRow100>();
const numericLabelAggregate100: PretableAggregator<
  WideRow100,
  number,
  { readonly total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value) => ({
    total: accumulator.total + value,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  finalize: ({ total }) => total.toFixed(2),
};

export const columns100 = [
  column100.accessor("col_000", {
    type: "number",
    aggregate: numericLabelAggregate100,
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_001", (row) => row.col_001, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_002", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_003", (row) => row.col_003, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_004", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_005", (row) => row.col_005, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_006", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_007", (row) => row.col_007, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_008", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_009", (row) => row.col_009, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_010", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_011", (row) => row.col_011, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_012", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_013", (row) => row.col_013, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_014", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_015", (row) => row.col_015, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_016", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_017", (row) => row.col_017, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_018", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_019", (row) => row.col_019, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_020", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_021", (row) => row.col_021, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_022", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_023", (row) => row.col_023, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_024", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_025", (row) => row.col_025, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_026", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_027", (row) => row.col_027, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_028", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_029", (row) => row.col_029, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_030", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_031", (row) => row.col_031, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_032", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_033", (row) => row.col_033, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_034", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_035", (row) => row.col_035, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_036", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_037", (row) => row.col_037, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_038", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_039", (row) => row.col_039, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_040", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_041", (row) => row.col_041, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_042", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_043", (row) => row.col_043, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_044", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_045", (row) => row.col_045, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_046", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_047", (row) => row.col_047, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_048", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_049", (row) => row.col_049, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_050", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_051", (row) => row.col_051, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_052", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_053", (row) => row.col_053, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_054", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_055", (row) => row.col_055, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_056", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_057", (row) => row.col_057, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_058", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_059", (row) => row.col_059, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_060", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_061", (row) => row.col_061, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_062", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_063", (row) => row.col_063, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_064", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_065", (row) => row.col_065, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_066", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_067", (row) => row.col_067, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_068", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_069", (row) => row.col_069, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_070", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_071", (row) => row.col_071, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_072", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_073", (row) => row.col_073, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_074", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_075", (row) => row.col_075, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_076", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_077", (row) => row.col_077, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_078", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_079", (row) => row.col_079, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_080", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_081", (row) => row.col_081, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_082", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_083", (row) => row.col_083, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_084", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_085", (row) => row.col_085, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_086", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_087", (row) => row.col_087, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_088", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_089", (row) => row.col_089, {
    type: "enum",
    format: ({ value }) => value,
  }),
  column100.accessor("col_090", {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("derived_091", (row) => row.col_091, {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("col_092", {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("derived_093", (row) => row.col_093, {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("col_094", { type: "enum", format: ({ value }) => value }),
  column100.accessor("derived_095", (row) => row.col_095, {
    type: "number",
    aggregate: "sum",
    format: ({ value }) => value.toFixed(2),
    formatAggregate: ({ value }) => value?.toFixed(2) ?? "",
  }),
  column100.accessor("col_096", {
    type: "text",
    aggregate: "count",
    format: ({ value }) => value.toUpperCase(),
  }),
  column100.accessor("derived_097", (row) => row.col_097, {
    type: "boolean",
    format: ({ value }) => (value ? "yes" : "no"),
  }),
  column100.accessor("col_098", {
    type: "date",
    format: ({ value }) => value.toISOString(),
  }),
  column100.accessor("derived_099", (row) => row.col_099, {
    type: "enum",
    format: ({ value }) => value,
  }),
] as const;

declare const rows100: readonly WideRow100[];
const model100 = createLocalRowModel({
  rows: rows100,
  columns: columns100,
});

const query100: PretableQueryFor<typeof columns100> = {
  filters: [
    { columnId: "col_000", operator: "between", value: [0, 100] },
    { columnId: "derived_001", operator: "contains", value: "alpha" },
    { columnId: "col_002", operator: "isAnyOf", value: [true] },
    {
      columnId: "derived_003",
      operator: "dateBetween",
      value: [0, new Date(0)],
    },
    { columnId: "col_004", operator: "isAnyOf", value: ["alpha"] },
    { columnId: "derived_095", operator: "gte", value: 0 },
    { columnId: "derived_099", operator: "isNoneOf", value: ["beta"] },
  ],
  sort: [{ columnId: "derived_095", direction: "desc" }],
  rowGroups: [{ columnId: "col_096", direction: "asc" }],
};
model100.setQuery(query100);

type ModelRow100 = RowOf<typeof model100>;
type ModelColumns100 = ColumnsOf<typeof model100>;
type Group100 = PretableGroupRow<typeof columns100>;

declare const modelRow100: ModelRow100;
declare const fixtureRow100: WideRow100;
const rowFromModel100: WideRow100 = modelRow100;
const rowIntoModel100: ModelRow100 = fixtureRow100;
declare const modelColumns100: ModelColumns100;
const columnsFromModel100: typeof columns100 = modelColumns100;
const customAggregateOutput100: string =
  null as unknown as Group100["aggregates"]["col_000"];

void rowFromModel100;
void rowIntoModel100;
void columnsFromModel100;
void customAggregateOutput100;
