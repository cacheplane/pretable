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
  rowGroups: readonly { columnId: string }[];
}

export const EMPTY_DOCS_QUERY: DocsQuery = {
  filters: [],
  sort: [],
  rowGroups: [],
};

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

function matches(
  row: DocsOrder,
  filter: DocsQuery["filters"][number],
): boolean {
  const cell = valueOf(row, filter.columnId);

  switch (filter.operator) {
    case "contains":
      return String(cell)
        .toLowerCase()
        .includes(String(filter.value ?? "").toLowerCase());
    case "equals":
      return String(cell) === String(filter.value);
    case "isAnyOf":
      return (
        Array.isArray(filter.value) &&
        filter.value.map(String).includes(String(cell))
      );
    case "gt":
      return Number(cell) > Number(filter.value);
    case "lt":
      return Number(cell) < Number(filter.value);
    default:
      // An operator this fixture does not implement must not silently drop
      // every row — that would read as "the server filtered it" on a page
      // about who filtered what.
      return true;
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
