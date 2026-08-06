import type {
  ColumnFilter,
  FilterOperator,
  ColumnType,
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

/**
 * A cell value → the boolean a `type: "boolean"` column means by it.
 *
 * The stringy/numeric spellings a JSON or SQL backend might emit (`"true"`,
 * `1`, `"0"`) resolve to the obvious boolean; anything else falls back to
 * plain truthiness.
 *
 * TWIN: `toBooleanCell` in `packages/react/src/editors/boolean-utils.ts`
 * drives the checkbox's `checked` (grid-core must not depend on
 * @pretable/react). Change one and you must change the other — that is the
 * whole point: a cell holding `1` must render checked *and* match the "True"
 * filter. The shared case table in `__tests__/evaluate-filter-boolean.test.ts`
 * and its twin in
 * `packages/react/src/__tests__/pretable-surface-boolean.test.tsx` pin them
 * together.
 */
function toBooleanCell(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return Boolean(value);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * An ISO datetime; group 1 is the date portion, group 2 the zone if spelled
 * out. The separator may be `T` or a space: `2026-08-06 13:45:00` is what
 * MySQL, SQLite, Postgres-as-text and `pandas.to_csv` emit, and its date
 * portion is exactly as unambiguous as the `T` form's.
 */
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** `yyyy-mm-dd` is four digits of year; the Date range runs far wider. */
const MAX_ISO_YEAR = 9999;
/**
 * 400 Gregorian years, exactly — the calendar repeats on that cycle, so this
 * many ms is a lossless year shift for any date.
 */
const GREGORIAN_400Y_MS = 146_097 * 86_400_000;

/**
 * `Date.UTC` with years 0–99 meaning themselves, not 1900+y (`Date.UTC(50, …)`
 * is otherwise 1950). Such a year is built 400 years forward and shifted back,
 * which gets year 0's leap day right too (0000 is a leap year in the proleptic
 * Gregorian calendar; 1900 is not).
 */
function utcMs(year: number, month: number, day: number): number {
  return year >= 0 && year < 100
    ? Date.UTC(year + 400, month, day) - GREGORIAN_400Y_MS
    : Date.UTC(year, month, day);
}

/** The UTC-midnight ms of the instant `ms`, or NaN if it isn't a real instant. */
function utcDayOf(ms: number): number {
  const d = new Date(ms);
  // NaN *and* out-of-range timestamps (|ms| > 8.64e15, e.g. a nanosecond
  // epoch) both yield an Invalid Date, whose UTC getters would read as NaN.
  if (Number.isNaN(d.getTime())) return Number.NaN;
  // A 4-digit year is the contract shared with the editor's `toIsoDate`: the
  // extremes of the Date range (year 275760, year -271821) can't be spelled
  // `yyyy-mm-dd`, so no operand could ever name that day.
  const year = d.getUTCFullYear();
  if (year < 0 || year > MAX_ISO_YEAR) return Number.NaN;
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Strict `yyyy-mm-dd` → UTC-midnight ms, or NaN. Refuses calendar overflow. */
function isoDayMs(iso: string): number {
  if (!ISO_DATE_RE.test(iso)) return Number.NaN;
  const [y, m, d] = iso.split("-").map(Number);
  const ms = utcMs(y, m - 1, d);
  const back = new Date(ms);
  // Date.UTC rolls 2026-02-30 forward to March; the round-trip catches that.
  return back.getUTCFullYear() === y &&
    back.getUTCMonth() === m - 1 &&
    back.getUTCDate() === d
    ? ms
    : Number.NaN;
}

/**
 * A cell (or filter operand) → the UTC-midnight ms of its calendar day, or NaN
 * for "not a date" (which the date branch reads as "no match").
 *
 * Accepts a strict `yyyy-mm-dd` string, an ISO datetime (zoned or not, `T`-
 * or space-separated), a `Date`, or finite epoch ms. A **zone-less** datetime
 * is interpreted as UTC,
 * i.e. its literal date portion is taken — deterministic, so the same cell
 * buckets into the same day for every viewer. Locale/loose strings
 * (`08/06/2026`, `2026-8-6`, `August 6, 2026`) are refused rather than run
 * through `Date.parse`, which resolves them in the *viewer's* timezone and
 * silently rolls calendar overflow forward (`2026-02-30` → March 2).
 *
 * TWIN: `toIsoDate` in `packages/react/src/editors/date-utils.ts` implements
 * the same rule for the cell editor (grid-core must not depend on
 * @pretable/react). Change one and you must change the other; the shared case
 * table in `__tests__/evaluate-filter-date.test.ts` and its twin in
 * `packages/react/src/__tests__/date-utils.test.ts` pin them together.
 */
function toDayMs(input: unknown): number {
  if (input instanceof Date) return utcDayOf(input.getTime());
  if (typeof input === "number") return utcDayOf(input);
  if (typeof input !== "string") return Number.NaN;
  const trimmed = input.trim();
  const dateOnly = isoDayMs(trimmed);
  if (!Number.isNaN(dateOnly)) return dateOnly;
  const parts = ISO_DATETIME_RE.exec(trimmed);
  if (!parts) return Number.NaN;
  // Guard the date portion whether or not a zone follows: `Date.parse` would
  // roll `2026-02-30T00:00:00Z` forward to March.
  const day = isoDayMs(parts[1]);
  if (Number.isNaN(day)) return Number.NaN;
  // Zone-less → the literal date portion, UTC-interpreted. Zoned → the UTC
  // day of that instant, so `2026-08-06T00:00:00+02:00` is 2026-08-05. A
  // space separator is normalised to `T` first: only the `T` spelling is in
  // the `Date.parse` spec, the space form is engine-specific.
  return parts[2] ? utcDayOf(Date.parse(trimmed.replace(" ", "T"))) : day;
}

/**
 * Pure per-operator filter match. Evaluation is keyed on `type` (not the
 * operator name), so `equals` means string-equality for text and numeric-equality
 * for number. An operator outside the column's family returns false (no match).
 */
export function evaluateFilter(
  cell: unknown,
  type: ColumnType,
  operator: FilterOperator,
  value: FilterValue | undefined,
): boolean {
  if (operator === "isEmpty") return isEmptyCell(cell);
  if (operator === "isNotEmpty") return !isEmptyCell(cell);

  switch (type) {
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
    case "boolean": {
      // Compare the *coerced* value, so a cell holding `1` matches the "True"
      // option the same way it renders checked. `isEmpty`/`isNotEmpty` ran
      // above the switch, so null/undefined still read as empty, not false.
      const c = String(toBooleanCell(cell));
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
