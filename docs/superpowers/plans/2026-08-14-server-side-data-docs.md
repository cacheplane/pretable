# Server-side data docs section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give pretable's server-controlled data surface a documented, guard-pinned home at `/docs/server-data`, backed by a real endpoint and probative e2e coverage.

**Architecture:** Four MDX pages in a new nav section, each leading with a live example that fetches from a docs-owned Next route (`POST /api/docs/rows`) with real latency, injectable failure, and a variable total kind. Every type the pages print is registered with the fail-closed docs-api-surface guard, and every registration is mutation-tested.

**Tech Stack:** Next (App Router), MDX, React, `@pretable/react`, Vitest, Playwright, api-extractor, changesets.

**Spec:** `docs/superpowers/specs/2026-08-14-server-side-data-docs-design.md`

**Out of scope, deliberately:** `PretableResultMeta.window` at a nonzero start, and eviction. Both are blocked on the defect in `docs/superpowers/specs/2026-08-15-window-coordinates-design.md`. No page may claim anything about either.

---

## File structure

**Create:**

| Path | Responsibility |
| --- | --- |
| `apps/website/app/api/docs/rows/dataset.ts` | The deterministic dataset and the query application. No HTTP. |
| `apps/website/app/api/docs/rows/route.ts` | The HTTP shell: latency, failure injection, paging, total kind. |
| `apps/website/app/api/docs/rows/__tests__/dataset.test.ts` | Unit tests for query application and total kinds. |
| `apps/website/content/docs/server-data/index.mdx` | Overview: ownership, endpoint contract, scope note. |
| `apps/website/content/docs/server-data/query-ownership.mdx` | `processing`, the three `PretableQueryOptions` arms. |
| `apps/website/content/docs/server-data/lifecycle.mdx` | `PretableDataState`, `renderBodyState`, `datasetKey`. |
| `apps/website/content/docs/server-data/totals.mdx` | `PretableMatchingTotal`, `resolveDataScope`. |
| `apps/website/content/examples/server-data-overview/` | Overview example. |
| `apps/website/content/examples/server-query-ownership/` | Notify-only on `<Pretable>`. |
| `apps/website/content/examples/server-totals/` | Total-kind toggle. |
| `apps/website/app/docs/__tests__/server-data.types.tsx` | Compile fixture transcribing every fence on the four pages. |
| `apps/website/e2e/server-data.spec.ts` | Probative e2e for all four pages. |

**Modify:**

| Path | Change |
| --- | --- |
| `apps/website/app/docs/_nav.ts` | New section between Grid and Headless engine. |
| `apps/website/content/docs/grid/api-reference.mdx:72` | Drop the "experimental" hedge; point at the new section. |
| `apps/website/content/docs/grid/pretable-surface.mdx` | Shrink the server section to a pointer; replace the stale telemetry fence with a bound member table. |
| `apps/website/content/docs/grid/export.mdx` | Explain `resolveDataScope`; link to `totals.mdx`. |
| `apps/website/content/docs/grid/pretable-component.mdx` | The four server props `<Pretable>` accepts. |
| `apps/website/content/examples/data-state-lifecycle/` | Repoint at the real route; example moves pages. |
| `apps/website/lib/docs/__tests__/docs-api-surface.test.ts` | New registry entries. |
| `packages/grid-core/src/types.ts`, `packages/react/src/data-state.ts`, `packages/react/src/pretable-surface.tsx` | Remove seven `@experimental` tags. |
| `.changeset/` | One patch changeset. |

---

## Task 1: The docs endpoint

**Files:**
- Create: `apps/website/app/api/docs/rows/dataset.ts`
- Create: `apps/website/app/api/docs/rows/route.ts`
- Test: `apps/website/app/api/docs/rows/__tests__/dataset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/app/api/docs/rows/__tests__/dataset.test.ts
import { describe, expect, test } from "vitest";

import {
  applyDocsQuery,
  DOCS_ORDERS,
  EMPTY_DOCS_QUERY,
  totalFor,
} from "../dataset";

describe("applyDocsQuery", () => {
  test("returns every row for an empty query", () => {
    expect(applyDocsQuery(DOCS_ORDERS, EMPTY_DOCS_QUERY)).toHaveLength(
      DOCS_ORDERS.length,
    );
  });

  test("a contains filter narrows to matching rows only", () => {
    const rows = applyDocsQuery(DOCS_ORDERS, {
      ...EMPTY_DOCS_QUERY,
      filters: [{ columnId: "customer", operator: "contains", value: "a" }],
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(DOCS_ORDERS.length);
    for (const row of rows) expect(row.customer.toLowerCase()).toContain("a");
  });

  test("an isAnyOf filter keeps only the named statuses", () => {
    const rows = applyDocsQuery(DOCS_ORDERS, {
      ...EMPTY_DOCS_QUERY,
      filters: [
        { columnId: "status", operator: "isAnyOf", value: ["open", "shipped"] },
      ],
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(["open", "shipped"]).toContain(row.status);
  });

  test("sort orders descending by total", () => {
    const rows = applyDocsQuery(DOCS_ORDERS, {
      ...EMPTY_DOCS_QUERY,
      sort: [{ columnId: "total", direction: "desc" }],
    });

    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.total).toBeGreaterThanOrEqual(rows[i]!.total);
    }
  });
});

describe("totalFor", () => {
  test("exact reports the matched count", () => {
    expect(totalFor("exact", 137, 0, 25)).toEqual({ kind: "exact", count: 137 });
  });

  test("estimate rounds, and does not report the matched count", () => {
    const total = totalFor("estimate", 137, 0, 25);

    expect(total.kind).toBe("estimate");
    expect(total).not.toEqual({ kind: "exact", count: 137 });
    expect(total).toEqual({ kind: "estimate", count: 150 });
  });

  test("unknown reports only what the response proves", () => {
    expect(totalFor("unknown", 137, 50, 25)).toEqual({
      kind: "unknown",
      atLeast: 75,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @pretable/website exec vitest run app/api/docs/rows/__tests__/dataset.test.ts
```

Expected: FAIL — `Failed to resolve import "../dataset"`.

- [ ] **Step 3: Write the dataset module**

```ts
// apps/website/app/api/docs/rows/dataset.ts

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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @pretable/website exec vitest run app/api/docs/rows/__tests__/dataset.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the route**

```ts
// apps/website/app/api/docs/rows/route.ts
import { NextResponse } from "next/server";

import {
  applyDocsQuery,
  asksToFail,
  DOCS_ORDERS,
  type DocsQuery,
  type DocsTotalKind,
  EMPTY_DOCS_QUERY,
  totalFor,
} from "./dataset";

/**
 * Enough delay that `loading` and `stale` are things a reader can watch
 * happen. The docs pages state this number, so changing it changes prose.
 */
const LATENCY_MS = 500;

interface DocsRowsRequest {
  query?: Partial<DocsQuery>;
  offset?: number;
  limit?: number;
  totalKind?: DocsTotalKind;
  datasetKey?: string;
}

/**
 * Rows for a query. POST so the query travels as JSON rather than a
 * hand-rolled encoding, and `no-store` so one query change is one request —
 * the e2e counts them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as DocsRowsRequest;

  const query: DocsQuery = {
    filters: body.query?.filters ?? EMPTY_DOCS_QUERY.filters,
    sort: body.query?.sort ?? EMPTY_DOCS_QUERY.sort,
    rowGroups: body.query?.rowGroups ?? EMPTY_DOCS_QUERY.rowGroups,
  };

  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  if (asksToFail(query)) {
    return NextResponse.json(
      { message: "Order service unavailable" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const matched = applyDocsQuery(DOCS_ORDERS, query);
  const offset = body.offset ?? 0;
  const limit = body.limit ?? matched.length;
  const rows = matched.slice(offset, offset + limit);

  return NextResponse.json(
    {
      rows,
      total: totalFor(body.totalKind ?? "exact", matched.length, offset, rows.length),
      datasetKey: body.datasetKey ?? "",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 6: Verify the route answers**

```bash
pnpm --filter @pretable/website exec next build
```

Expected: build succeeds and the route appears in the output as `/api/docs/rows`.

- [ ] **Step 7: Commit**

```bash
git add apps/website/app/api/docs/rows
git commit -m "feat(website): a docs-owned rows endpoint with latency, failure and total kinds"
```

---

## Task 2: Nav section and the overview page

**Files:**
- Modify: `apps/website/app/docs/_nav.ts`
- Create: `apps/website/content/docs/server-data/index.mdx`
- Create: `apps/website/content/examples/server-data-overview/{example.ts,demo.tsx,ServerDataGrid.tsx,columns.ts,fetch-rows.ts}`

- [ ] **Step 1: Add the nav section**

In `apps/website/app/docs/_nav.ts`, insert between the `Grid` and `Headless engine` entries:

```ts
  {
    title: "Server-side data",
    items: [
      { title: "Overview", href: "/docs/server-data" },
      { title: "Query ownership", href: "/docs/server-data/query-ownership" },
      {
        title: "Loading, staleness, errors",
        href: "/docs/server-data/lifecycle",
      },
      { title: "Totals and honesty", href: "/docs/server-data/totals" },
    ],
  },
```

- [ ] **Step 2: Write the shared fetch helper**

```ts
// apps/website/content/examples/server-data-overview/fetch-rows.ts
import type { PretableMatchingTotal, PretableQueryFor } from "@pretable/react";

import type { columns } from "./columns";

export interface Order {
  id: string;
  customer: string;
  region: string;
  status: string;
  total: number;
  placedAt: string;
}

export interface RowsResponse {
  rows: Order[];
  total: PretableMatchingTotal;
  datasetKey: string;
}

/**
 * The whole of the client's job: send the query, receive rows plus a
 * description of them. The grid never does this — it has no idea a network
 * exists.
 */
export async function fetchRows(
  query: PretableQueryFor<typeof columns>,
  options: { totalKind?: "exact" | "estimate" | "unknown" } = {},
): Promise<RowsResponse> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, totalKind: options.totalKind ?? "exact" }),
  });

  if (!response.ok) throw new Error("Order service unavailable");

  return (await response.json()) as RowsResponse;
}
```

- [ ] **Step 3: Write the columns**

```ts
// apps/website/content/examples/server-data-overview/columns.ts
import { defineColumns } from "@pretable/react";

import type { Order } from "./fetch-rows";

export const columns = defineColumns<Order>([
  { id: "customer", header: "Customer" },
  { id: "region", header: "Region", type: "enum" },
  { id: "status", header: "Status", type: "enum" },
  { id: "total", header: "Total", type: "number" },
  { id: "placedAt", header: "Placed", type: "date" },
]);
```

If `defineColumns` is not the helper this codebase exports, use the idiom the other examples use — check `apps/website/content/examples/column-filters/columns.ts` and match it exactly rather than inventing one.

- [ ] **Step 4: Write the grid**

```tsx
// apps/website/content/examples/server-data-overview/ServerDataGrid.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  PretableSurface,
  type PretableDataState,
  type PretableMatchingTotal,
  type PretableQueryFor,
} from "@pretable/react";

import { columns } from "./columns";
import { fetchRows, type Order } from "./fetch-rows";

const EMPTY_QUERY: PretableQueryFor<typeof columns> = {
  filters: [],
  sort: [],
  rowGroups: [],
};

export function ServerDataGrid() {
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState<PretableMatchingTotal>({
    kind: "unknown",
  });
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  const hasCommitted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });

    fetchRows(query).then(
      (result) => {
        if (cancelled) return;
        hasCommitted.current = true;
        setRows(result.rows);
        setTotal(result.total);
        setDataState({ phase: "idle" });
      },
      (error: unknown) => {
        if (cancelled) return;
        hasCommitted.current = true;
        setDataState({
          phase: "error",
          message: error instanceof Error ? error.message : "Request failed",
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [query]);

  const onQueryChange = useCallback(
    (next: PretableQueryFor<typeof columns>) => setQuery(next),
    [],
  );

  return (
    <PretableSurface
      ariaLabel="Orders"
      columns={columns}
      dataState={dataState}
      getRowId={(row) => row.id}
      onQueryChange={onQueryChange}
      processing={{ filter: "external", sort: "external" }}
      query={query}
      resultMeta={{ total, datasetKey: JSON.stringify(query) }}
      rows={rows}
      viewportHeight={360}
    />
  );
}
```

- [ ] **Step 5: Write demo and example metadata**

```tsx
// apps/website/content/examples/server-data-overview/demo.tsx
import { ServerDataGrid } from "./ServerDataGrid";

export default function Demo() {
  return <ServerDataGrid />;
}
```

```ts
// apps/website/content/examples/server-data-overview/example.ts
import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "A grid whose filtering and sorting happen on the server",
  description:
    "Every header sort and column filter becomes one POST to /api/docs/rows with a 500ms delay. The grid applies neither — it renders what came back and reports what the reader asked for.",
  files: ["ServerDataGrid.tsx", "columns.ts", "fetch-rows.ts"],
  height: 460,
});
```

- [ ] **Step 6: Write the overview page**

Create `apps/website/content/docs/server-data/index.mdx` with frontmatter matching the convention on `grid/filtering.mdx` (`title`, `description`, `nav: Server-side data`; no `order:` — that key was deleted repo-wide).

Required headings, in this order — the guard keys tables and fences by heading, so these names are load-bearing:

1. Intro paragraph, then `<Example id="server-data-overview" />`.
2. `## What the grid owns` — a table with first header `Concern` (deliberately NOT `prop`/`field`/`option`/`method`, so it is not detected as a member table; it documents no single exported type). Rows: query intent, focus/selection/editing, viewport geometry — grid-owned; fetching, filtering, sorting, totals, lifecycle — consumer-owned.
3. `## The endpoint these examples use` — the request/response fence from the spec, plus a sentence naming the 500ms delay and the `fail` convention.
4. `## Where to go next` — links to the other three pages.
5. `## Not covered yet` — exactly this, no more: windows that do not start at row 0, and eviction, are not documented yet. Do not describe their behavior.

- [ ] **Step 7: Verify the page renders and the example runs**

```bash
pnpm --filter @pretable/website exec next build
```

Expected: build succeeds; `/docs/server-data` is in the route list.

- [ ] **Step 8: Commit**

```bash
git add apps/website/app/docs/_nav.ts apps/website/content/docs/server-data apps/website/content/examples/server-data-overview
git commit -m "docs(server-data): the section, its overview, and a server-backed example"
```

---

## Task 3: Query ownership page

**Files:**
- Create: `apps/website/content/docs/server-data/query-ownership.mdx`
- Create: `apps/website/content/examples/server-query-ownership/{example.ts,demo.tsx,NotifyOnlyGrid.tsx,columns.ts,fetch-rows.ts}`

- [ ] **Step 1: Write the notify-only example**

This is the `<Pretable>` story nothing documents — the uncontrolled-but-reporting arm. Note it passes `onQueryChange` **without** `query`, and uses the plain `<Pretable>` component, not the surface.

```tsx
// apps/website/content/examples/server-query-ownership/NotifyOnlyGrid.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Pretable,
  type PretableDataState,
  type PretableQueryFor,
} from "@pretable/react";

import { columns } from "./columns";
import { fetchRows, type Order } from "./fetch-rows";

const EMPTY_QUERY: PretableQueryFor<typeof columns> = {
  filters: [],
  sort: [],
  rowGroups: [],
};

export function NotifyOnlyGrid() {
  const [rows, setRows] = useState<Order[]>([]);
  const [requests, setRequests] = useState(0);
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  const hasCommitted = useRef(false);

  const load = useCallback((query: PretableQueryFor<typeof columns>) => {
    setRequests((count) => count + 1);
    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });

    fetchRows(query).then(
      (result) => {
        hasCommitted.current = true;
        setRows(result.rows);
        setDataState({ phase: "idle" });
      },
      () => {
        hasCommitted.current = true;
        setDataState({ phase: "error", message: "Order service unavailable" });
      },
    );
  }, []);

  useEffect(() => {
    load(EMPTY_QUERY);
  }, [load]);

  return (
    <div>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Requests sent: <code data-testid="request-count">{requests}</code>. The
        grid holds the query; it only tells you when it changed.
      </p>
      <Pretable
        ariaLabel="Orders"
        columns={columns}
        dataState={dataState}
        getRowId={(row) => row.id}
        onQueryChange={load}
        processing={{ filter: "external", sort: "external" }}
        rows={rows}
      />
    </div>
  );
}
```

`columns.ts` and `fetch-rows.ts`: copy the two files from `server-data-overview` verbatim, changing only the relative import paths if needed. They are small and per-example self-containment is the pattern the other examples already follow.

`demo.tsx` and `example.ts`: same shape as Task 2 Step 5, with `id` `server-query-ownership`, files `["NotifyOnlyGrid.tsx", "columns.ts", "fetch-rows.ts"]`, and a description naming that this is `<Pretable>` — four props plus `onQueryChange`.

- [ ] **Step 2: Write the page**

Required headings:

1. Intro, then `<Example id="server-query-ownership" />`.
2. `## Processing authority` — `processing: { filter, sort }`, `"engine"` vs `"external"`, and that it is create-time configuration: changing it reconstructs the local model. State that it does **not** move query ownership.
3. `## Three ways to own the query` — a table whose first header is `Shape` (not a member-table header). Three rows: controlled pair (`query` + `onQueryChange`), silent uncontrolled (neither), notify-only (`onQueryChange` alone). Say plainly that `query` without `onQueryChange` is a compile error, and why: `value` requires `onChange`.
4. `## Which props each component accepts` — `<Pretable>` takes `processing`, `resultMeta`, `dataState`, `onQueryChange`; `renderBodyState` is `<PretableSurface>` only. Verify this against `packages/react/react.api.md`'s `PretableBaseProps` before writing it, and do not list a prop the report does not show.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @pretable/website exec next build
```

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs/server-data/query-ownership.mdx apps/website/content/examples/server-query-ownership
git commit -m "docs(server-data): query ownership, including the notify-only arm"
```

---

## Task 4: Lifecycle page

**Files:**
- Create: `apps/website/content/docs/server-data/lifecycle.mdx`
- Modify: `apps/website/content/examples/data-state-lifecycle/search-products.ts` (repoint at the route)
- Modify: `apps/website/content/docs/grid/pretable-surface.mdx` (remove the `<Example id="data-state-lifecycle" />` usage and its paragraph)

- [ ] **Step 1: Repoint the existing example at the real route**

Replace the body of `search-products.ts` so it fetches rather than scripting a delay. Keep the exported `searchProducts(query: string)` signature so `DataStateGrid.tsx` needs no change:

```ts
// apps/website/content/examples/data-state-lifecycle/search-products.ts
import type { Product } from "./data";

export interface SearchResult {
  rows: Product[];
  total: number;
}

/**
 * One POST per search, against the docs' own endpoint: a real 500ms delay so
 * `stale` is visible, and a deterministic failure — any query containing
 * "fail" — so the `error` phase is reachable without waiting on network flake.
 */
export async function searchProducts(query: string): Promise<SearchResult> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: {
        filters: query.trim()
          ? [{ columnId: "customer", operator: "contains", value: query }]
          : [],
        sort: [],
        rowGroups: [],
      },
      totalKind: "exact",
    }),
  });

  if (!response.ok) throw new Error("Search service unavailable");

  const body = (await response.json()) as {
    rows: Product[];
    total: { kind: string; count?: number };
  };

  return { rows: body.rows, total: body.total.count ?? body.rows.length };
}
```

The endpoint's rows are orders, not products. Either update `data.ts` / `columns.ts` in that example to the order shape, or keep the example's own dataset and give the endpoint a `dataset` switch. **Pick the first** — one dataset across the section is the point — and update `columns.ts` to the order columns from Task 2, deleting `data.ts` if nothing else imports it.

- [ ] **Step 2: Write the page**

Required headings:

1. Intro, then `<Example id="data-state-lifecycle" />`.
2. `## The six phases` — a table whose first header is `phase`. **This is auto-detected as a discriminant table** for `PretableDataState`, so it must have one row per union alternative and needs a `DISCRIMINANT_TABLES` entry in Task 8. Rows: `idle`, `loading`, `stale`, `refreshing`, `loading-more`, `error`.
3. `## No default, and why` — the prop absent means the entire lifecycle presentation is off; remote consumers must supply it from the first render, starting at `loading`. Take this from the TSDoc on `packages/react/src/data-state.ts`.
4. `## Errors never discard rows` — the error-strip rule; the header stays sortable.
5. `## Replacing the built-in blocks` — `renderBodyState` and the four `PretableBodyStateKind` values.
6. `## datasetKey` — the identity fence: change it when the result set changes so focus, selection, expansion, and edits cannot attach to a different dataset; keep it stable while paging within one result.

- [ ] **Step 3: Remove the example from its old home**

In `apps/website/content/docs/grid/pretable-surface.mdx`, delete the `<Example id="data-state-lifecycle" />` line and the paragraph introducing it. The rest of that page's server section is rewritten in Task 6.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @pretable/website exec next build
```

Expected: build succeeds. An example may be referenced by exactly one page — if the build or the docs tests complain about a duplicate or missing reference, that is the check working.

- [ ] **Step 5: Commit**

```bash
git add apps/website/content/docs/server-data/lifecycle.mdx apps/website/content/examples/data-state-lifecycle apps/website/content/docs/grid/pretable-surface.mdx
git commit -m "docs(server-data): the dataState lifecycle, over the real endpoint"
```

---

## Task 5: Totals and honesty page

**Files:**
- Create: `apps/website/content/docs/server-data/totals.mdx`
- Create: `apps/website/content/examples/server-totals/{example.ts,demo.tsx,TotalsGrid.tsx,columns.ts,fetch-rows.ts}`

- [ ] **Step 1: Write the example**

A radio group switching `totalKind`, so one grid shows all three shapes and their consequences.

```tsx
// apps/website/content/examples/server-totals/TotalsGrid.tsx
"use client";

import { useEffect, useState } from "react";

import {
  PretableSurface,
  resolveDataScope,
  type PretableMatchingTotal,
} from "@pretable/react";

import { columns } from "./columns";
import { fetchRows, type Order } from "./fetch-rows";

const KINDS = ["exact", "estimate", "unknown"] as const;

export function TotalsGrid() {
  const [totalKind, setTotalKind] =
    useState<(typeof KINDS)[number]>("exact");
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState<PretableMatchingTotal>({
    kind: "unknown",
  });

  useEffect(() => {
    let cancelled = false;

    fetchRows({ filters: [], sort: [], rowGroups: [] }, { totalKind }).then(
      (result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
      },
      () => undefined,
    );

    return () => {
      cancelled = true;
    };
  }, [totalKind]);

  const scope = resolveDataScope(
    { loadedRowCount: rows.length, matchingTotal: total },
    { filter: "external", sort: "external" },
  );

  return (
    <div>
      <fieldset style={{ border: 0, margin: "0 0 8px", padding: 0 }}>
        <legend style={{ fontSize: 13 }}>Total kind</legend>
        {KINDS.map((kind) => (
          <label key={kind} style={{ marginRight: 12, fontSize: 13 }}>
            <input
              checked={totalKind === kind}
              name="total-kind"
              onChange={() => setTotalKind(kind)}
              type="radio"
              value={kind}
            />{" "}
            {kind}
          </label>
        ))}
      </fieldset>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Reported: <code data-testid="reported-total">{JSON.stringify(total)}</code>{" "}
        — an export of this grid would be scoped{" "}
        <code data-testid="export-scope">{scope}</code>.
      </p>
      <PretableSurface
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        processing={{ filter: "external", sort: "external" }}
        resultMeta={{ total }}
        rows={rows}
        viewportHeight={320}
      />
    </div>
  );
}
```

Copy `columns.ts` and `fetch-rows.ts` from `server-data-overview`. `demo.tsx` and `example.ts` follow Task 2 Step 5, id `server-totals`.

**Before writing the page, run the example and read the actual `scope` values.** If `exact` and `unknown` resolve to the same scope, the example proves nothing and needs a limit/offset so `loadedRowCount < count`. Verify by reading `resolveDataScope`'s implementation in `packages/react/src`, then confirm in the browser.

- [ ] **Step 2: Write the page**

Required headings:

1. Intro, then `<Example id="server-totals" />`.
2. `## The three shapes` — a table whose first header is `kind`. **Auto-detected as a discriminant table** for `PretableMatchingTotal`; one row per alternative, `DISCRIMINANT_TABLES` entry in Task 8. Say what each does to announced counts and scroll extent, and that `unknown` carries `atLeast` only when the response proves it.
3. `## What a total is allowed to claim` — a server that does not know the count must say `unknown`, not guess an `exact`. This is the honesty rule the type exists to enforce.
4. `## Exporting under external authority` — `resolveDataScope` and `DataHonestyInput`; why an export says `loaded` rather than `all` when the grid holds a page of a larger result. Link to `/docs/grid/export`.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @pretable/website exec next build
```

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs/server-data/totals.mdx apps/website/content/examples/server-totals
git commit -m "docs(server-data): matching totals and export honesty"
```

---

## Task 6: Existing page edits

**Files:**
- Modify: `apps/website/content/docs/grid/api-reference.mdx:72`
- Modify: `apps/website/content/docs/grid/pretable-surface.mdx`
- Modify: `apps/website/content/docs/grid/export.mdx`
- Modify: `apps/website/content/docs/grid/pretable-component.mdx`

- [ ] **Step 1: Drop the hedge in the API reference**

Replace the sentence at `grid/api-reference.mdx:72` — currently beginning "The experimental `processing`, `resultMeta`, `dataState`, and `renderBodyState` props…" — with one that drops "experimental" and links to `/docs/server-data`. Keep the true clause: they do not move row or query ownership into the UI grid.

- [ ] **Step 2: Shrink the surface page's server section**

In `grid/pretable-surface.mdx`, the `## Server-applied filtering and sorting` section becomes two sentences and a link to `/docs/server-data`. Delete the `processing`/`resultMeta`/`datasetKey`/`dataState` explanations — they now live on the new pages, and two copies drift.

- [ ] **Step 3: Replace the stale telemetry fence with a bound table**

The fence under `## Telemetry` is wrong today: it omits `loadedRowCount` and `windowGap`, and types `focusedRowId` as `string | null`. Replace the fence with a member table whose first header is `Field`, so the guard's member-table detector picks it up:

| Field | Type | Notes |
| --- | --- | --- |
| `focusedRowId` | `TRowId \| PretableGroupId \| null` | |
| `loadedRowCount` | `number` | |
| `renderedRowCount` | `number` | |
| `rowModelRowCount` | `number` | |
| `selectedRowId` | `TRowId \| null` | |
| `totalHeight` | `number` | |
| `totalRowCount` | `number` | |
| `visibleRowCount` | `number` | |
| `visibleRowRange` | `{ start: number; end: number }` | |
| `windowGap` | `{ direction: "before" \| "after"; rowCount: number }` | optional; used by windowed datasets |

Read the member list and every type off `packages/react/react.api.md`'s `PretableTelemetry` — do not copy the table above without checking it, because the report is the authority and it moves. The `windowGap` note says exactly that and nothing more: this section documents no windowing behavior.

Keep the surrounding prose about keeping `onTelemetryChange` stable with `useCallback`.

- [ ] **Step 4: Explain `resolveDataScope` on the export page**

`grid/export.mdx:36` uses `resolveDataScope(dataHonesty, processing)` inside a fence with no prose anywhere. Add a short paragraph after that fence: what it returns (`"all"` or `"loaded"`), why an export over externally-filtered data cannot honestly claim `all`, and a link to `/docs/server-data/totals`.

- [ ] **Step 5: Add the server props to the `<Pretable>` page**

`grid/pretable-component.mdx` has zero mentions of any of this despite #374. Add a section naming the four server props `<Pretable>` accepts — `processing`, `resultMeta`, `dataState`, `onQueryChange` — noting `renderBodyState` is surface-only, and linking to `/docs/server-data`. Confirm the list against `PretableBaseProps` in `packages/react/react.api.md` before writing.

- [ ] **Step 6: Verify no page still calls it experimental**

```bash
grep -rn "experimental" apps/website/content/docs
```

Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add apps/website/content/docs/grid
git commit -m "docs(grid): point at the server-side data section, and correct the telemetry table"
```

---

## Task 7: Remove the `@experimental` tags

**Files:**
- Modify: `packages/grid-core/src/types.ts` (4 occurrences, near lines 188–203)
- Modify: `packages/react/src/data-state.ts` (lines 10, 29)
- Modify: `packages/react/src/pretable-surface.tsx` (line 760)
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Find every tag**

```bash
grep -rn "@experimental" packages/*/src
```

Expected: exactly 7 matches across the three files.

- [ ] **Step 2: Remove them**

Delete only the `@experimental` tag, keeping `@public` and every other line of each TSDoc block intact.

- [ ] **Step 3: Prove the reports did not move**

```bash
pnpm build && pnpm api:check
```

Expected: PASS with no report diff — `@experimental` is not rendered into the `.api.md` files. **Run `pnpm build` first**; a stale `dist/` silently strips exports and `api:check` will not catch it.

- [ ] **Step 4: Add a changeset**

```bash
pnpm changeset
```

Patch bump for `@pretable/core`, `@pretable/react`, and `@pretable/grid-core` if it is published. Summary: the server-controlled data surface is no longer marked experimental.

- [ ] **Step 5: Commit**

```bash
git add packages .changeset
git commit -m "docs(react,grid-core): the server-controlled data surface is not experimental"
```

---

## Task 8: Register everything with the docs guard

**Files:**
- Modify: `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`
- Create: `apps/website/app/docs/__tests__/server-data.types.tsx`

The guard is fail-closed and partly self-registering: a new member table, a new discriminant table, and a newly-named string union each **make the suite fail until registered**. Let the suite tell you what it wants rather than guessing.

- [ ] **Step 1: Run the guard and read its demands**

```bash
pnpm --filter @pretable/website exec vitest run lib/docs/__tests__/docs-api-surface.test.ts
```

Expected: FAIL. Capture every failure message — each names a key that needs a registry entry.

- [ ] **Step 2: Register the tables**

In `TABLES`, add `complete: true` bindings for the tables that document one exported type's members:

```ts
  "grid/pretable-surface.mdx#Telemetry": {
    types: [{ pkg: "react", name: "PretableTelemetry" }],
    complete: true,
  },
```

Any table on the new pages that documents no single exported type — the ownership table, the three-ways-to-own table — takes an `unbound` entry with a written reason, not a binding to an unrelated type.

- [ ] **Step 3: Register the discriminant tables**

```ts
  "server-data/lifecycle.mdx#The six phases": {
    pkg: "react",
    type: "PretableDataState",
    carries: true,
  },
  "server-data/totals.mdx#The three shapes": {
    pkg: "react",
    type: "PretableMatchingTotal",
    carries: true,
  },
```

Set `carries` to match what the tables actually do with each alternative's payload; read the existing entries and the `CARRIED_LIST_RE` handling before choosing.

- [ ] **Step 4: Register the string unions**

`namedStringUnions()` computes its roster from every union any page names, so `PretableProcessingAuthority` and `PretableBodyStateKind` become required the moment a page mentions them. Add `STRING_UNIONS` entries — enumerated with `{ page: "server-data/…" }` if a page spells the members out, or `unenumerated` with a reason if a page only names the type.

- [ ] **Step 5: Write the compile fixture**

Create `apps/website/app/docs/__tests__/server-data.types.tsx`, with one `// docs-fence: <key>` marker per fence on the four new pages, transcribing each fence so `tsc --noEmit` proves it compiles. Model it on an existing fixture — read `csv-export.types.tsx` first.

Register the filename:

```ts
const FIXTURE_FILES = [
  "cell-presentations.types.tsx",
  "csv-export.types.tsx",
  "headless-getting-started.types.tsx",
  "server-data.types.tsx",
];
```

Once a fixture names any fence on a page, **every** fence on that page must be transcribed or excused in `UNTRANSCRIBED_FENCES` with a reason. The endpoint's request/response fence on the overview page is JSON-shaped pseudo-code, not TypeScript — that is a legitimate `UNTRANSCRIBED_FENCES` entry, and it needs the reason written out.

- [ ] **Step 6: Run the guard until green**

```bash
pnpm --filter @pretable/website exec vitest run lib/docs/__tests__/docs-api-surface.test.ts
pnpm --filter @pretable/website exec tsc --noEmit
```

Expected: both PASS.

- [ ] **Step 7: Mutation-test every new registration**

This is the point of the task. For **each** newly-registered type, make the guard fail on purpose, then revert:

1. In `packages/react/react.api.md`, delete the `windowGap` member from `PretableTelemetry`. Run the guard. Expected: FAIL naming `grid/pretable-surface.mdx#Telemetry`. Revert.
2. In the report, add a seventh alternative `{ phase: "paused" }` to `PretableDataState`. Run the guard. Expected: FAIL naming `server-data/lifecycle.mdx#The six phases`. Revert.
3. In the report, rename `PretableMatchingTotal`'s `estimate` to `approximate`. Run the guard. Expected: FAIL naming `server-data/totals.mdx#The three shapes`. Revert.
4. Add a member to `PretableProcessingOptions` in the report. Run the guard. Expected: FAIL. Revert.
5. Delete `server-data.types.tsx`. Run the guard. Expected: FAIL — the `FIXTURE_FILES` roster asserts both ways. Restore.

Record each observed failure message in the commit body. **A registration whose mutation does not fail is not coverage** — if any mutation passes, the binding is wrong; fix it before continuing.

- [ ] **Step 8: Verify the report is clean**

```bash
git diff --stat packages/react/react.api.md
```

Expected: no output. Every mutation was reverted.

- [ ] **Step 9: Commit**

```bash
git add apps/website/lib/docs/__tests__ apps/website/app/docs/__tests__
git commit -m "test(website): pin the server-side data pages to the API reports"
```

---

## Task 9: Probative e2e coverage

**Files:**
- Create: `apps/website/e2e/server-data.spec.ts`

Read `apps/website/e2e/helpers.ts` first and use the shared interaction helpers. Gate every interaction on `data-pretable-hydrated` — SSR'd controls are painted but inert, and an early click is silently dropped.

- [ ] **Step 1: Write the request-count test**

```ts
test("a query change sends exactly one request", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/docs/rows", async (route) => {
    requests += 1;
    await route.continue();
  });

  await page.goto("/docs/server-data");
  await waitForHydration(page);
  await expect.poll(() => requests).toBe(1);

  await sortByHeader(page, "Total");
  await expect.poll(() => requests).toBe(2);
});
```

The assertion is the **count**, not the presence of rows. Rows appear whether or not the server was asked.

- [ ] **Step 2: Write the error-preserves-rows test**

```ts
test("an error keeps the same rows and a sortable header", async ({ page }) => {
  await page.goto("/docs/server-data/lifecycle");
  await waitForHydration(page);

  const before = await visibleRowIds(page);
  expect(before.length).toBeGreaterThan(0);

  await searchFor(page, "fail");
  await expect(page.getByRole("status")).toContainText("error");

  expect(await visibleRowIds(page)).toEqual(before);
  await expect(page.getByRole("columnheader", { name: /Total/ })).toHaveAttribute(
    "aria-sort",
    /.*/,
  );
});
```

Asserting the **same ids**, not a row count — a count survives a wholesale replacement.

- [ ] **Step 3: Write the total-kind test**

```ts
test("the total kind changes the reported total and the export scope", async ({
  page,
}) => {
  await page.goto("/docs/server-data/totals");
  await waitForHydration(page);

  await page.getByRole("radio", { name: "exact" }).check();
  const exactTotal = await page.getByTestId("reported-total").textContent();
  const exactScope = await page.getByTestId("export-scope").textContent();

  await page.getByRole("radio", { name: "unknown" }).check();
  await expect(page.getByTestId("reported-total")).not.toHaveText(
    exactTotal ?? "",
  );
  await expect(page.getByTestId("export-scope")).not.toHaveText(
    exactScope ?? "",
  );
});
```

If the two scopes are in fact equal, **the example is wrong, not the test** — go back to Task 5 Step 1 and give the fixture a limit so `loadedRowCount < count`. Do not weaken this assertion to make it pass.

- [ ] **Step 4: Write the notify-only test**

Assert that on `/docs/server-data/query-ownership`, sorting a header increments `[data-testid="request-count"]` — the proof that `<Pretable>` reports query changes without owning the query.

- [ ] **Step 5: Run the suite**

```bash
pnpm --filter @pretable/website exec next build
pnpm --filter @pretable/website exec next start &
pnpm --filter @pretable/website exec playwright test e2e/server-data.spec.ts --workers=1
```

Expected: all PASS. The dev server does not work for this suite, and `--workers=1` is required locally.

- [ ] **Step 6: Prove each test can fail**

Delete the behavior each test names, one at a time, and watch that test fail:

1. Remove `onQueryChange` from the overview grid → the request-count test fails.
2. Make the lifecycle example clear `rows` on error → the error test fails.
3. Hard-code `totalKind: "exact"` in `fetch-rows.ts` → the total-kind test fails.

Revert each. Record the observed failures in the commit body.

- [ ] **Step 7: Commit**

```bash
git add apps/website/e2e/server-data.spec.ts
git commit -m "test(website): prove the server-data pages do what they claim"
```

---

## Task 10: Full verification, PR, merge, production check

- [ ] **Step 1: Re-check `origin/main`**

```bash
git fetch origin && git log --oneline HEAD..origin/main
```

If anything landed, rebase onto it before opening the PR. Parallel sessions are running in this repo.

- [ ] **Step 2: Run everything**

```bash
pnpm build && pnpm api:check && pnpm test && pnpm lint
```

`pnpm build` before `pnpm api:check`, always. The react vitest suite times out 1–2 random tests per full run under load — re-run before believing a failure, and check whether other worktrees are saturating the machine.

- [ ] **Step 3: Run the website e2e suite**

```bash
pnpm --filter @pretable/website exec playwright test --workers=1
```

Expected: all PASS. Roughly 37–46 "destination stream closed early" log lines are Next's bug (vercel/next.js#96704), not ours.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin blove/server-side-model-windowing-docs-d22c87
```

Then `gh pr create`. The body must state what is out of scope and why — windowing and eviction, blocked on the window-coordinates defect — so a reviewer does not read the omission as an oversight.

- [ ] **Step 5: Merge on green**

Wait for every required check, including the Vercel preview smoke test and `API Extractor — report freshness`. A daily Vercel build-quota exhaustion blocks merges outright; if that happens, wait rather than working around it.

- [ ] **Step 6: Verify in production**

After the deploy completes, open the production site in a **clean browser session** — not a long-instrumented tab, which reports itself and has faked results before. Check:

1. `/docs/server-data` and all three sub-pages render, and appear in the sidebar.
2. Each example loads rows over the network — confirm in the network tab that `POST /api/docs/rows` fires.
3. Searching `fail` on the lifecycle page shows the error strip with rows intact.
4. The totals page's three radio options change both readouts.

Report what was observed, not what should have happened.

---

## Self-review

**Spec coverage:** § 1 the section → Tasks 2–5. § 2 the endpoint → Task 1. § 3 existing pages → Task 6. § 4 dropping experimental → Task 7. § 5 drift and the guard → Tasks 6 (step 3) and 8. § Verification → Tasks 8 (step 7), 9, 10. § What must be true afterwards → Task 10 step 6.

**Known soft spots, called out rather than hidden:**

- Task 2 Step 3 cannot state the column-definition idiom with certainty from the report alone, so it instructs the implementer to match an existing example rather than invent one.
- Task 5 Step 1 depends on `resolveDataScope` returning different values for the three total kinds. If it does not, the example needs a limit — the step says so, and Task 9 Step 3 refuses to weaken the assertion instead.
- Task 8 lets the fail-closed guard enumerate its own demands rather than predicting every key, because the keys depend on headings that do not exist until Tasks 2–5 land.
