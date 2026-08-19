import { isValidDateValue } from "@pretable/core";

/** A row of the docs' example order book. */
export interface DocsOrder {
  id: string;
  customer: string;
  region: string;
  status: "open" | "shipped" | "delivered" | "cancelled";
  total: number;
  placedAt: string;
}

export interface DocsQuery {
  filters: readonly {
    columnId: string;
    operator: string;
    value?: unknown;
  }[];
  sort: readonly { columnId: string; direction: "asc" | "desc" }[];
  /**
   * Accepted for shape-fidelity with the engine's query; this fixture does not
   * group. Nothing here reads it — a server-side grouping demo would need a
   * real implementation, not this pass-through.
   */
  rowGroups: readonly { columnId: string }[];
}

export const EMPTY_DOCS_QUERY: DocsQuery = {
  filters: [],
  sort: [],
  rowGroups: [],
};

/**
 * The column type of every field, and the fixture's source of truth for it: a
 * docs page's column descriptors must agree with this map, because the filter
 * operators a column can use are decided by its type, and an operator outside
 * that set is a 500 rather than a silently unfiltered grid.
 *
 * `region` is an enum — four closed values — so the funnel's default `isAnyOf`
 * is answerable. Calling it text would 500 on the operator a reader reaches
 * without choosing anything.
 */
export const DOCS_COLUMN_TYPES = {
  id: "text",
  customer: "text",
  region: "enum",
  status: "enum",
  total: "number",
  placedAt: "date",
} as const satisfies Record<keyof DocsOrder, DocsColumnType>;

export type DocsColumnType = "text" | "number" | "date" | "enum";

/**
 * Mirrors `FILTER_OPERATORS` in packages/row-model/src/compiled-query.ts. The
 * filter menu offers exactly these per type, so every selection a reader can
 * make lands on a real implementation below.
 */
export const DOCS_FILTER_OPERATORS: Readonly<
  Record<DocsColumnType, ReadonlySet<string>>
> = {
  text: new Set([
    "contains",
    "notContains",
    "equals",
    "notEquals",
    "startsWith",
    "endsWith",
    "isEmpty",
    "isNotEmpty",
  ]),
  number: new Set([
    "equals",
    "notEquals",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "isEmpty",
    "isNotEmpty",
  ]),
  date: new Set([
    "on",
    "before",
    "after",
    "dateBetween",
    "isEmpty",
    "isNotEmpty",
  ]),
  enum: new Set(["isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"]),
};

/**
 * A query this fixture cannot answer. Thrown rather than quietly returning
 * every row: these pages exist to teach that the server applied the filter, so
 * an unimplemented operator must be visible, not mistaken for "no matches
 * were excluded".
 */
export class DocsQueryError extends Error {
  readonly name = "DocsQueryError";
}

const CUSTOMERS = [
  "Aldridge Foods",
  "Brightwater Labs",
  "Calder & Sons",
  "Dunmore Freight",
  "Eastvale Clinic",
  "Fairhaven Press",
  "Grantwick Metals",
  "Holloway Optics",
];

const REGIONS = ["North", "South", "East", "West"];

const STATUSES: DocsOrder["status"][] = [
  "open",
  "shipped",
  "delivered",
  "cancelled",
];

/**
 * 480 rows, generated from the index alone — no randomness, so a docs example
 * and its e2e assertions see the same numbers on every run and in every
 * environment.
 */
function buildOrders(): DocsOrder[] {
  const out: DocsOrder[] = [];

  for (let i = 0; i < 480; i += 1) {
    const day = (i % 28) + 1;
    const month = (i % 12) + 1;

    out.push({
      id: `ord-${String(i + 1).padStart(4, "0")}`,
      customer: CUSTOMERS[i % CUSTOMERS.length] as string,
      region: REGIONS[i % REGIONS.length] as string,
      status: STATUSES[i % STATUSES.length] as DocsOrder["status"],
      total: 250 + ((i * 137) % 9750),
      placedAt: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  return out;
}

export const DOCS_ORDERS: readonly DocsOrder[] = buildOrders();

function valueOf(row: DocsOrder, columnId: string): unknown {
  return (row as unknown as Record<string, unknown>)[columnId];
}

/** The engine's emptiness policy, verbatim: null, undefined, NaN, or blank. */
function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value)) ||
    (typeof value === "string" && value.trim() === "")
  );
}

function columnTypeFor(columnId: string): DocsColumnType {
  const type = (DOCS_COLUMN_TYPES as Record<string, DocsColumnType>)[columnId];

  if (!type) {
    throw new DocsQueryError(
      `Unknown column "${columnId}". This fixture serves: ${Object.keys(DOCS_COLUMN_TYPES).join(", ")}.`,
    );
  }

  return type;
}

/**
 * Rejects what the engine's `validateFilter` rejects — an operator the column
 * type cannot use, or an operand of the wrong shape — so the fixture and the
 * engine disagree about nothing.
 */
function assertUsable(
  columnId: string,
  type: DocsColumnType,
  operator: string,
  value: unknown,
): void {
  if (!DOCS_FILTER_OPERATORS[type].has(operator)) {
    throw new DocsQueryError(
      `Column "${columnId}" is ${type} and cannot use operator "${operator}". ` +
        `Allowed: ${[...DOCS_FILTER_OPERATORS[type]].join(", ")}.`,
    );
  }

  if (operator === "isEmpty" || operator === "isNotEmpty") return;

  if (value === undefined || value === null) {
    throw new DocsQueryError(
      `Filter on "${columnId}" with operator "${operator}" is missing its operand.`,
    );
  }

  if (type === "number") {
    const operands = operator === "between" ? value : [value];
    if (
      !Array.isArray(operands) ||
      (operator === "between" && operands.length !== 2) ||
      operands.some((entry) => typeof entry !== "number" || Number.isNaN(entry))
    ) {
      throw new DocsQueryError(
        operator === "between"
          ? `Filter on "${columnId}" needs a range of exactly two non-NaN numbers.`
          : `Filter on "${columnId}" needs a non-NaN number operand.`,
      );
    }
    return;
  }

  if (type === "date") {
    const operands = operator === "dateBetween" ? value : [value];
    if (
      !Array.isArray(operands) ||
      (operator === "dateBetween" && operands.length !== 2) ||
      operands.some((entry) => typeof entry !== "string")
    ) {
      throw new DocsQueryError(
        operator === "dateBetween"
          ? `Filter on "${columnId}" needs a range of exactly two string operands.`
          : `Filter on "${columnId}" needs a string operand.`,
      );
    }
    return;
  }

  if (type === "text") {
    if (typeof value !== "string") {
      throw new DocsQueryError(
        `Filter on "${columnId}" needs a string operand.`,
      );
    }
    return;
  }

  if (!Array.isArray(value)) {
    throw new DocsQueryError(
      `Filter on "${columnId}" needs an array of selected values.`,
    );
  }
}

function matchesNumber(
  operator: string,
  cell: unknown,
  operand: unknown,
): boolean {
  if (typeof cell !== "number" || Number.isNaN(cell)) return false;

  if (operator === "between") {
    const [low, high] = operand as readonly [number, number];
    return cell >= Math.min(low, high) && cell <= Math.max(low, high);
  }

  const other = operand as number;

  switch (operator) {
    case "equals":
      return cell === other;
    case "notEquals":
      return cell !== other;
    case "gt":
      return cell > other;
    case "gte":
      return cell >= other;
    case "lt":
      return cell < other;
    case "lte":
      return cell <= other;
    default:
      // Unreachable by construction: `assertUsable` rejects any operator
      // outside DOCS_FILTER_OPERATORS before dispatch. It stays as the failure
      // mode for the one gap that check cannot see — an operator added to the
      // allow-list whose implementation was forgotten — which must be a loud
      // 500, never a silently unfiltered grid.
      throw new DocsQueryError(`Unimplemented number operator "${operator}".`);
  }
}

function matchesDate(
  operator: string,
  cell: unknown,
  operand: unknown,
): boolean {
  if (!isValidDateValue(cell)) return false;

  if (operator === "dateBetween") {
    const [first, second] = operand as readonly [string, string];
    if (!isValidDateValue(first) || !isValidDateValue(second)) return false;
    const lower = first <= second ? first : second;
    const upper = first <= second ? second : first;
    return cell >= lower && cell <= upper;
  }

  if (!isValidDateValue(operand)) return false;

  switch (operator) {
    case "on":
      return cell === operand;
    case "before":
      return cell < operand;
    case "after":
      return cell > operand;
    default:
      // Unreachable by construction: `assertUsable` rejects any operator
      // outside DOCS_FILTER_OPERATORS before dispatch. It stays as the failure
      // mode for the one gap that check cannot see — an operator added to the
      // allow-list whose implementation was forgotten — which must be a loud
      // 500, never a silently unfiltered grid.
      throw new DocsQueryError(`Unimplemented date operator "${operator}".`);
  }
}

function matchesEnum(
  operator: string,
  cell: unknown,
  operand: unknown,
): boolean {
  const selected = operand as readonly unknown[];
  // An empty selection excludes nothing — the engine's rule, so that clearing
  // every checkbox reads as "no filter" rather than "no rows".
  if (selected.length === 0) return true;

  const included = selected.map(String).includes(String(cell));

  switch (operator) {
    case "isAnyOf":
      return included;
    case "isNoneOf":
      return !included;
    default:
      // Unreachable by construction: `assertUsable` rejects any operator
      // outside DOCS_FILTER_OPERATORS before dispatch. It stays as the failure
      // mode for the one gap that check cannot see — an operator added to the
      // allow-list whose implementation was forgotten — which must be a loud
      // 500, never a silently unfiltered grid.
      throw new DocsQueryError(
        `Unimplemented selection operator "${operator}".`,
      );
  }
}

function matchesText(
  operator: string,
  cell: unknown,
  operand: unknown,
): boolean {
  // The engine lower-cases both sides, so text comparison is case-insensitive.
  const haystack = String(cell ?? "").toLocaleLowerCase();
  const needle = String(operand).toLocaleLowerCase();

  switch (operator) {
    case "contains":
      return haystack.includes(needle);
    case "notContains":
      return !haystack.includes(needle);
    case "equals":
      return haystack === needle;
    case "notEquals":
      return haystack !== needle;
    case "startsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
    default:
      // Unreachable by construction: `assertUsable` rejects any operator
      // outside DOCS_FILTER_OPERATORS before dispatch. It stays as the failure
      // mode for the one gap that check cannot see — an operator added to the
      // allow-list whose implementation was forgotten — which must be a loud
      // 500, never a silently unfiltered grid.
      throw new DocsQueryError(`Unimplemented text operator "${operator}".`);
  }
}

function matches(
  row: DocsOrder,
  filter: DocsQuery["filters"][number],
): boolean {
  const type = columnTypeFor(filter.columnId);
  assertUsable(filter.columnId, type, filter.operator, filter.value);

  const cell = valueOf(row, filter.columnId);

  if (filter.operator === "isEmpty") return isEmptyValue(cell);
  if (filter.operator === "isNotEmpty") return !isEmptyValue(cell);

  switch (type) {
    case "number":
      return matchesNumber(filter.operator, cell, filter.value);
    case "date":
      return matchesDate(filter.operator, cell, filter.value);
    case "enum":
      return matchesEnum(filter.operator, cell, filter.value);
    case "text":
      return matchesText(filter.operator, cell, filter.value);
    default:
      throw new DocsQueryError(`Unimplemented column type "${String(type)}".`);
  }
}

export function applyDocsQuery(
  rows: readonly DocsOrder[],
  query: DocsQuery,
): DocsOrder[] {
  const filtered = rows.filter((row) =>
    query.filters.every((filter) => matches(row, filter)),
  );

  if (query.sort.length === 0) return [...filtered];

  return [...filtered].sort((a, b) => {
    for (const entry of query.sort) {
      const left = valueOf(a, entry.columnId);
      const right = valueOf(b, entry.columnId);
      if (left === right) continue;

      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));

      return entry.direction === "desc" ? -order : order;
    }

    return 0;
  });
}

export type DocsTotalKind = "exact" | "estimate" | "unknown";

export type DocsMatchingTotal =
  | { kind: "exact"; count: number }
  | { kind: "estimate"; count: number }
  | { kind: "unknown"; atLeast?: number };

/**
 * The three shapes of `PretableMatchingTotal`, each answered honestly:
 * `estimate` rounds rather than reporting the number it actually knows, and
 * `unknown` reports only what this response proves — the rows already
 * delivered.
 *
 * The `estimate` rounding is deliberately UP, past the true count: a real query
 * planner over-claims, and `resolveDataScope` gates scope "all" on
 * `kind === "exact"`, so an inflated estimate cannot corrupt the honesty logic.
 * Do not "fix" this to `Math.round`.
 */
export function totalFor(
  kind: DocsTotalKind,
  matchedCount: number,
  offset: number,
  deliveredCount: number,
): DocsMatchingTotal {
  switch (kind) {
    case "exact":
      return { kind: "exact", count: matchedCount };
    case "estimate":
      return { kind: "estimate", count: Math.ceil(matchedCount / 50) * 50 };
    case "unknown":
      return { kind: "unknown", atLeast: offset + deliveredCount };
  }
}

/** Whether any filter value asks this fixture to fail. */
export function asksToFail(query: DocsQuery): boolean {
  return query.filters.some((filter) => /fail/i.test(String(filter.value)));
}
