import type {
  ColumnFilter,
  FilterOperator,
  FilterType,
  FilterValue,
} from "./types";

const NO_OPERAND: ReadonlySet<FilterOperator> = new Set([
  "isEmpty",
  "isNotEmpty",
]);

/** Is this filter active (has a usable operand)? Blank/empty operands are inactive. */
export function isFilterActive(filter: ColumnFilter): boolean {
  const { operator, value } = filter;
  if (NO_OPERAND.has(operator)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true; // number
}

function isEmptyCell(cell: unknown): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === "number") return Number.isNaN(cell);
  return String(cell).trim() === "";
}

function toDayMs(input: unknown): number {
  // Day-resolution: parse and zero the time so "on"/range compare by calendar day.
  const ms = typeof input === "number" ? input : Date.parse(String(input));
  if (Number.isNaN(ms)) return Number.NaN;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Pure per-operator filter match. Evaluation is keyed on `filterType` (not the
 * operator name), so `equals` means string-equality for text and numeric-equality
 * for number. An operator outside the column's family returns false (no match).
 */
export function evaluateFilter(
  cell: unknown,
  filterType: FilterType,
  operator: FilterOperator,
  value: FilterValue | undefined,
): boolean {
  if (operator === "isEmpty") return isEmptyCell(cell);
  if (operator === "isNotEmpty") return !isEmptyCell(cell);

  switch (filterType) {
    case "number": {
      const n = typeof cell === "number" ? cell : Number(cell);
      if (Number.isNaN(n)) return false;
      switch (operator) {
        case "equals":
          return n === Number(value);
        case "notEquals":
          return n !== Number(value);
        case "gt":
          return n > Number(value);
        case "gte":
          return n >= Number(value);
        case "lt":
          return n < Number(value);
        case "lte":
          return n <= Number(value);
        case "between": {
          if (!Array.isArray(value)) return false;
          const a = Number(value[0]);
          const b = Number(value[1]);
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return n >= lo && n <= hi;
        }
        default:
          return false;
      }
    }
    case "date": {
      const c = toDayMs(cell);
      if (Number.isNaN(c)) return false;
      switch (operator) {
        case "on":
          return c === toDayMs(value);
        case "before":
          return c < toDayMs(value);
        case "after":
          return c > toDayMs(value);
        case "dateBetween": {
          if (!Array.isArray(value)) return false;
          const a = toDayMs(value[0]);
          const b = toDayMs(value[1]);
          if (Number.isNaN(a) || Number.isNaN(b)) return false;
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return c >= lo && c <= hi;
        }
        default:
          return false;
      }
    }
    case "enum": {
      const c = String(cell);
      const set = Array.isArray(value) ? value.map(String) : [];
      if (set.length === 0) return true; // empty selection = no constraint
      switch (operator) {
        case "isAnyOf":
          return set.includes(c);
        case "isNoneOf":
          return !set.includes(c);
        default:
          return false;
      }
    }
    case "text":
    default: {
      const hay = String(cell ?? "").toLowerCase();
      const needle = String(value ?? "").toLowerCase();
      switch (operator) {
        case "contains":
          return hay.includes(needle);
        case "notContains":
          return !hay.includes(needle);
        case "equals":
          return hay === needle;
        case "notEquals":
          return hay !== needle;
        case "startsWith":
          return hay.startsWith(needle);
        case "endsWith":
          return hay.endsWith(needle);
        default:
          return false;
      }
    }
  }
}
