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
  /**
   * LEAF-ONLY, AND KNOWINGLY BEHIND THE ENGINE. `PretableQueryFor.filters` is
   * an AND/OR TREE: an element is either a typed leaf or a
   * `{ op, children }` GROUP, nestable. This shape admits leaves only.
   *
   * Nothing catches the mismatch at compile time, and that is not an
   * oversight to be fixed by a cast: the type boundary is genuinely severed
   * by `JSON.stringify` in each example's `fetch-rows.ts` — a query leaves the
   * client as text and arrives here as `unknown`, so `pnpm typecheck` is green
   * over a real gap.
   *
   * So the rejection is a RUNTIME one, and it is deliberate rather than
   * incidental: `applyDocsQuery` scans `filters` for `children` BEFORE it
   * reads a row and throws `DocsQueryError` naming the group, and the route
   * answers with an error rather than with wrongly-filtered rows.
   *
   * Before the scan, per-row was the only check, and it was reachable only
   * when a row survived the leaves ahead of it — so a leaf matching nothing,
   * or an empty dataset, answered 200 with zero rows and no throw at all. See
   * `applyDocsQuery` for why well-formedness is asked once, of the query.
   * (Left to itself the mismatch also failed — a group has no `columnId`, so
   * `columnTypeFor` threw — but about a column, which is not what went
   * wrong.)
   *
   * Nothing in the docs builds a group yet — the built-in column menu writes
   * top-level leaves only — so no example can reach this today. A server
   * meeting a real tree has three honest choices (reject, flatten when every
   * join is AND, or implement the recursion). This fixture REJECTS, by name,
   * in `matches()`: it is a demo of the wire contract, not a filter engine,
   * and implementing the recursion here would teach nothing the engine does
   * not already do. The contract itself is stated on the section overview,
   * `content/docs/server-data/index.mdx`.
   */
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function utcDayOf(value: number): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function isoDayMs(value: string): number {
  if (!ISO_DATE_RE.test(value)) return Number.NaN;
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const result = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(result);

  return roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
    ? result
    : Number.NaN;
}

/**
 * The engine's UTC calendar-day policy (`toDayMs`), minus its pre-year-100
 * Gregorian shim — this order book is entirely modern, and a docs fixture that
 * carried the shim would be copying code no example can reach.
 */
function toDayMs(value: unknown): number {
  if (value instanceof Date) return utcDayOf(value.getTime());
  if (typeof value === "number") return utcDayOf(value);
  if (typeof value !== "string") return Number.NaN;

  const trimmed = value.trim();
  const dateOnly = isoDayMs(trimmed);
  if (!Number.isNaN(dateOnly)) return dateOnly;

  const parts = ISO_DATETIME_RE.exec(trimmed);
  if (!parts || Number.isNaN(isoDayMs(parts[1] as string))) return Number.NaN;

  return parts[2]
    ? utcDayOf(Date.parse(trimmed.replace(" ", "T")))
    : isoDayMs(parts[1] as string);
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
      operands.some((entry) => Number.isNaN(toDayMs(entry)))
    ) {
      throw new DocsQueryError(
        operator === "dateBetween"
          ? `Filter on "${columnId}" needs a range of exactly two valid ISO dates.`
          : `Filter on "${columnId}" needs a valid ISO date operand.`,
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
  const day = toDayMs(cell);
  if (Number.isNaN(day)) return false;

  if (operator === "dateBetween") {
    const range = operand as readonly [unknown, unknown];
    const low = toDayMs(range[0]);
    const high = toDayMs(range[1]);
    return day >= Math.min(low, high) && day <= Math.max(low, high);
  }

  const other = toDayMs(operand);

  switch (operator) {
    case "on":
      return day === other;
    case "before":
      return day < other;
    case "after":
      return day > other;
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

/**
 * One wording for the one thing this fixture refuses, so the up-front scan in
 * `applyDocsQuery` and the per-row branch in `matches()` cannot drift apart.
 */
function rejectFilterGroup(index?: number): never {
  const where = index === undefined ? "" : ` at query.filters[${index}]`;
  throw new DocsQueryError(
    `This fixture answers leaf filters only, and this query carried a filter group${where}. ` +
      "A server that does not implement AND/OR groups must say so rather " +
      "than drop them: see /docs/server-data.",
  );
}

function matches(
  row: DocsOrder,
  filter: DocsQuery["filters"][number],
): boolean {
  /*
   * The rejection this fixture owes the wire contract, said out loud. On the
   * wire `query.filters` is an AND/OR tree (see `DocsQuery` above), and a
   * group carries `children` where a leaf carries `columnId`.
   *
   * Without this branch a group was already rejected — `columnTypeFor`
   * throws on the missing `columnId` — but with `Unknown column
   * "undefined"`, a message about the wrong thing entirely. A fixture whose
   * job is to teach that the server applied the filter has to name the
   * reason it did not.
   */
  if ("children" in filter) rejectFilterGroup();

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
  /*
   * The group rejection has to happen HERE, before a single row is read.
   * `matches()` carries the same test, but it runs per row inside the loop
   * below, so it is reachable only if some row survives every earlier leaf:
   * `[{ region isAnyOf ["Nowhere"] }, <group>]` — and any query at all over an
   * empty `rows` — short-circuited to zero matches and answered 200 with no
   * throw. A result quietly computed from less than the reader asked for is
   * the one failure these pages exist to argue against, and it does not stop
   * being that because the result happens to be empty.
   *
   * A query is well-formed or it is not, independently of the data; the check
   * belongs where that question is asked once. `matches()` keeps its branch as
   * belt-and-braces for any future caller that reaches it directly.
   */
  for (const [index, filter] of query.filters.entries()) {
    if ("children" in filter) rejectFilterGroup(index);
  }

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
