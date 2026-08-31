// packages/react/src/filter-menu/filter-operators.ts
import type {
  ColumnFilter,
  ColumnOption,
  ColumnType,
  FilterOperator,
  PretableProcessingOptions,
} from "@pretable/core";
import { isValidDateValue } from "@pretable-internal/calendar-date";
import { warnOnce } from "../dev-warn";

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

export function operatorsForType(
  type: ColumnType,
  allowed?: readonly FilterOperator[],
): FilterOperator[] {
  const base =
    type === "number"
      ? NUMBER_OPS
      : type === "date"
        ? DATE_OPS
        : type === "enum" || type === "boolean"
          ? ENUM_OPS
          : TEXT_OPS;
  const full = [...base, ...SHARED_OPS];

  if (!allowed) {
    return full;
  }

  // Intersect rather than take `allowed` verbatim: the menu's order is the
  // per-type order, and an operator outside the type's set has no value editor.
  const permitted = new Set(allowed);
  const pruned = full.filter((op) => permitted.has(op));

  if (pruned.length === 0) {
    warnOnce(
      `filter-operators-empty:${type}`,
      `[pretable] column.filterOperators removed every operator a "${type}" ` +
        "column can offer. Falling back to the full set — an empty filter menu " +
        "is not a usable control. Check the operator names against the column type.",
    );
    return full;
  }

  return pruned;
}

/**
 * The operators the select renders: the permitted set, plus whichever operator
 * the filter currently applies. A `<select>` whose value matches no option
 * silently displays the first one, so pruning the applied operator would leave
 * the menu naming an operator the filter is not using — and that named operator
 * unreachable, since choosing what is already displayed fires no change event.
 */
export function menuOperators(
  type: ColumnType,
  active: FilterOperator,
  allowed?: readonly FilterOperator[],
): FilterOperator[] {
  const permitted = operatorsForType(type, allowed);
  if (permitted.includes(active)) {
    return permitted;
  }
  const full = operatorsForType(type);
  if (!full.includes(active)) {
    return [...permitted, active];
  }
  const kept = new Set([...permitted, active]);
  return full.filter((op) => kept.has(op));
}

/**
 * What each operator is CALLED, in English.
 *
 * ## Why this is still hardcoded after the tool panel's messages sweep
 *
 * Every other user-facing string the filter builder renders moved to
 * `PretableSurfaceMessages` (see `tool-panel/messages.ts`). These did not, and
 * the reason is that this record has TWO consumers: the tool panel's
 * `FilterRow` and the header funnel's `FilterMenu`. The funnel has no
 * `messages` thread of any kind — it is not handed the surface's resolved
 * messages, and nothing in `filter-menu/` reads them.
 *
 * So localizing this record for the panel alone would put the SAME operator in
 * two languages in one grid: `contains` in the header funnel, its translation
 * three inches away in the panel. That is precisely the drift this module
 * exists to prevent — the funnel and the row must offer the same filters under
 * the same names, and a second derivation is how they come apart.
 *
 * Paying it is therefore a TWO-CONSUMER job, not a one-line change: the funnel
 * menu has to be threaded first (it needs the surface's `effectiveMessages`
 * reaching `FilterMenu`, which today receives none), and only then can one
 * message key serve both call sites. Adding a key here before that would leave
 * the funnel behind and make the inconsistency shippable.
 *
 * Until then this is the one place in the filter UI that renders untranslatable
 * English, and it is deliberate.
 */
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

export function defaultDraft(
  type: ColumnType,
  allowed?: readonly FilterOperator[],
): FilterDraft {
  const operator = operatorsForType(type, allowed)[0]!;
  if (operatorValueShape(operator) === "set") return { operator, selected: [] };
  if (operatorValueShape(operator) === "range")
    return { operator, min: "", max: "" };
  return { operator, text: "" };
}

const isNum = (s: string | undefined): s is string =>
  s !== undefined && s.trim() !== "" && !Number.isNaN(Number(s));

export function isComplete(type: ColumnType, d: FilterDraft): boolean {
  const shape = operatorValueShape(d.operator);
  if (shape === "none") return true;
  if (shape === "set") return (d.selected?.length ?? 0) > 0;
  if (shape === "range") {
    if (type === "number") return isNum(d.min) && isNum(d.max);
    if (type === "date")
      return isValidDateValue(d.min) && isValidDateValue(d.max);
    return !!d.min && !!d.max;
  }
  // single
  if (type === "number") return isNum(d.text);
  if (type === "date") return isValidDateValue(d.text);
  return !!d.text && d.text.trim() !== "";
}

export function toColumnFilter(
  type: ColumnType,
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
  type: ColumnType,
  filter: ColumnFilter | null,
  allowed?: readonly FilterOperator[],
): FilterDraft {
  if (!filter) return defaultDraft(type, allowed);
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

const BOOLEAN_OPTIONS: ColumnOption[] = [
  { value: "true", label: "True" },
  { value: "false", label: "False" },
];

/**
 * The option set a column's enum-style UI should offer. Boolean columns get
 * implicit True/False unless they declare their own; enum columns use their
 * declared options, falling back to the caller-supplied distinct values.
 * Every other type has no checklist, so no distinct-value scan runs.
 *
 * `processing` is read only to judge that fallback: values scanned out of the
 * loaded records are the whole universe under engine filter authority and a
 * fragment of it under external.
 */
export function resolveColumnOptions(
  column: { id: string; type?: ColumnType; options?: ColumnOption[] },
  distinctValues: () => string[],
  processing?: PretableProcessingOptions,
): ColumnOption[] {
  // Only enum-style columns render a checklist; skip the scan for the rest.
  if (column.type === "boolean") return column.options ?? BOOLEAN_OPTIONS;
  if (column.type !== "enum") return [];
  if (column.options) return column.options;

  // Reaching the fallback under external filter authority means the funnel is
  // about to offer the distinct values of the LOADED window as an `isAnyOf`
  // universe — an incomplete one, silently.
  if (processing?.filter === "external") {
    warnOnce(
      `distinct-values-fallback:${column.id}`,
      `[pretable] Column "${column.id}" has no \`options\` and filtering is ` +
        "external, so the funnel is offering the distinct values of the " +
        "loaded window. That is an incomplete universe for isAnyOf. " +
        "Declare `column.options`.",
    );
  }

  return distinctValues().map((value) => ({ value }));
}
