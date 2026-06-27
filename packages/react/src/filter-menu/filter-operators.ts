// packages/react/src/filter-menu/filter-operators.ts
import type { ColumnFilter, FilterOperator, FilterType } from "@pretable/core";

/** Local editing shape for the popover. One field set per value-shape. */
export interface FilterDraft {
  operator: FilterOperator;
  text?: string; // single (text/number/date)
  min?: string; // range lower
  max?: string; // range upper
  selected?: string[]; // set (enum)
}

export type ValueShape = "none" | "single" | "range" | "set";

const TEXT_OPS: FilterOperator[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
];
const NUMBER_OPS: FilterOperator[] = [
  "equals",
  "notEquals",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
];
const DATE_OPS: FilterOperator[] = ["on", "before", "after", "dateBetween"];
const ENUM_OPS: FilterOperator[] = ["isAnyOf", "isNoneOf"];
const SHARED_OPS: FilterOperator[] = ["isEmpty", "isNotEmpty"];

export function operatorsForType(type: FilterType): FilterOperator[] {
  const base =
    type === "number"
      ? NUMBER_OPS
      : type === "date"
        ? DATE_OPS
        : type === "enum"
          ? ENUM_OPS
          : TEXT_OPS;
  return [...base, ...SHARED_OPS];
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  equals: "equals",
  notEquals: "does not equal",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  between: "is between",
  isAnyOf: "is any of",
  isNoneOf: "is none of",
  on: "on",
  before: "before",
  after: "after",
  dateBetween: "is between",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};

const RANGE_OPS = new Set<FilterOperator>(["between", "dateBetween"]);
const SET_OPS = new Set<FilterOperator>(["isAnyOf", "isNoneOf"]);
const NONE_OPS = new Set<FilterOperator>(["isEmpty", "isNotEmpty"]);

export function operatorValueShape(op: FilterOperator): ValueShape {
  if (NONE_OPS.has(op)) return "none";
  if (RANGE_OPS.has(op)) return "range";
  if (SET_OPS.has(op)) return "set";
  return "single";
}

export function defaultDraft(type: FilterType): FilterDraft {
  const operator = operatorsForType(type)[0]!;
  if (operatorValueShape(operator) === "set") return { operator, selected: [] };
  if (operatorValueShape(operator) === "range")
    return { operator, min: "", max: "" };
  return { operator, text: "" };
}

const isNum = (s: string | undefined): s is string =>
  s !== undefined && s.trim() !== "" && !Number.isNaN(Number(s));

export function isComplete(type: FilterType, d: FilterDraft): boolean {
  const shape = operatorValueShape(d.operator);
  if (shape === "none") return true;
  if (shape === "set") return (d.selected?.length ?? 0) > 0;
  if (shape === "range") {
    if (type === "number") return isNum(d.min) && isNum(d.max);
    return !!d.min && !!d.max; // date ISO strings
  }
  // single
  if (type === "number") return isNum(d.text);
  return !!d.text && d.text.trim() !== "";
}

export function toColumnFilter(
  type: FilterType,
  d: FilterDraft,
): ColumnFilter | null {
  const shape = operatorValueShape(d.operator);
  if (shape === "none") return { operator: d.operator };
  if (!isComplete(type, d)) return null;
  if (shape === "set") return { operator: d.operator, value: [...d.selected!] };
  if (shape === "range") {
    if (type === "number")
      return { operator: d.operator, value: [Number(d.min), Number(d.max)] };
    return { operator: d.operator, value: [d.min!, d.max!] };
  }
  // single
  if (type === "number") return { operator: d.operator, value: Number(d.text) };
  return { operator: d.operator, value: d.text! };
}

export function fromColumnFilter(
  type: FilterType,
  filter: ColumnFilter | null,
): FilterDraft {
  if (!filter) return defaultDraft(type);
  const { operator, value } = filter;
  const shape = operatorValueShape(operator);
  if (shape === "none") return { operator };
  if (shape === "set")
    return {
      operator,
      selected: Array.isArray(value) ? value.map(String) : [],
    };
  if (shape === "range") {
    const arr = Array.isArray(value) ? value : ["", ""];
    return { operator, min: String(arr[0] ?? ""), max: String(arr[1] ?? "") };
  }
  return {
    operator,
    text: value === null || value === undefined ? "" : String(value),
  };
}
