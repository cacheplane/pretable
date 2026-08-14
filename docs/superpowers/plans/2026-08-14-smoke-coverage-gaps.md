# Smoke Coverage Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps a manual Chrome smoke on 2026-08-14 could not verify — controlled filtering through a checklist funnel, group collapse/expand on a controlled grid, and sort/filter/group against row data fetched from a server per query.

**Architecture:** Two of the three are e2e tests against surfaces that already exist (`/docs/grid/filtering`, `/docs/grid/grouping`). The third has no surface to test: nothing on the site fetches rows in response to `onQueryChange`, so Task 3 builds one — a Next route handler that owns sorting/filtering/grouping, plus a fixture page that renders `PretableSurface` in controlled mode and refetches on every query change. That fixture is the artifact the test drives, and it doubles as the reference for consumers wiring a real backend.

**Tech Stack:** Next 16 App Router (route handlers, client components), `@pretable/react` controlled-query mode (`query` + `onQueryChange`), Playwright, existing `apps/website/e2e/helpers.ts`.

---

## Background the engineer needs

- **Two query modes.** Uncontrolled: the grid owns the query and applies it. Controlled (`query` + `onQueryChange` both passed): the consumer owns it, the grid reports intent and does **not** apply the transition itself — the consumer supplies the next `query` (and, in Task 3, the next rows). The internal note explaining this is `packages/react/src/pretable-model.ts` around the `notify-only` comment.
- **Never assert on rendered row counts to prove collapse.** The grid virtualizes: collapsing a 6-row group pulls 5 rows in from below, so `[data-pretable-row]` count moves by 1. That exact mistake produced a false "collapse does nothing" reading during the manual smoke. Assert `aria-expanded` on the group row plus the disappearance of a **named** child (`[data-pretable-row-id="…"]` → `toHaveCount(0)`), which is what `e2e/grouping.spec.ts:270-292` already does.
- **Funnels are opacity-0 until the header row is hovered.** Use the existing `openFilterMenu(page, "Status")` helper (`e2e/helpers.ts:92`); it hovers, clicks, and returns the dialog.
- **Fixture data, exact values:**
  - `content/examples/column-filters/data.ts` — 7 orders; `status` ∈ {`open`, `shipped`, `cancelled`}; the example mounts with `status isAnyOf ["open"]` already applied.
  - `content/examples/grouping-panel/data.ts` — 12 positions, ids `p1`…`p12`; `desk` ∈ {`Equities`, `Credit`, `Macro`}.
- **Fixture pages** live at `apps/website/app/fixtures/<name>/page.tsx` and are plain routes (see `app/fixtures/grouping/page.tsx`). They are not linked from the site.
- **Running the website e2e:** specs need a server. Production: `pnpm --filter @pretable/app-website exec next build` then `next start -p 3100`. For these tests a dev server is fine and faster: `pnpm --filter @pretable/app-website exec next dev -p 3100`. Then `BASE_URL=http://localhost:3100 pnpm --filter @pretable/app-website exec playwright test <spec> --project=chromium --workers=1`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/website/e2e/controlled-query.spec.ts` (create) | Tasks 1–2: checklist filtering and collapse/expand on the controlled docs examples |
| `apps/website/app/api/rows/route.ts` (create) | Task 3: the "server" — owns sort/filter/group, returns rows for a query |
| `apps/website/app/api/rows/dataset.ts` (create) | Task 3: the row set and the query application, importable by both route and test |
| `apps/website/app/fixtures/server-query/page.tsx` (create) | Task 3: fixture route shell |
| `apps/website/app/fixtures/server-query/ServerQueryGrid.tsx` (create) | Task 3: controlled `PretableSurface` that refetches per query change |
| `apps/website/e2e/server-query.spec.ts` (create) | Task 3: drives the fixture, asserts the round-trip and server-applied results |

---

## Task 1: Controlled filtering through a checklist funnel

The manual smoke opened the first funnel it found, which was a text filter, toggled nothing, and proved nothing. This drives the `Status` funnel specifically — an `enum` column with **no** `options`, so the checklist loads distinct values from the rows, which is the path most likely to break silently.

**Files:**
- Create: `apps/website/e2e/controlled-query.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "@playwright/test";

import { openFilterMenu, waitForGridReady } from "./helpers";

/**
 * The controlled-query surfaces on the docs pages: `query` + `onQueryChange`,
 * where the consumer owns the query and the grid reports intent rather than
 * applying it itself. This is the shape a server integration uses, and a manual
 * smoke on 2026-08-14 could not verify either flow here — the filter check
 * opened a non-checklist funnel and toggled nothing, and the collapse check
 * counted rendered rows, which virtualization makes meaningless.
 */
test("checklist funnel filters a controlled grid, and the page sees the query", async ({
  page,
}) => {
  await page.goto("/docs/grid/filtering", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  // The example mounts with `status isAnyOf ["open"]` already applied, and
  // echoes the live query beneath the grid — so the page itself tells us
  // whether `onQueryChange` reached the consumer.
  const echo = page.getByText(/Active filters:/);
  await expect(echo).toContainText("status");
  const openRows = await page.locator("[data-pretable-row]").count();
  expect(openRows).toBeGreaterThan(0);

  // `status` is an enum column that declares no `options`, so this checklist is
  // built from the rows' distinct values. All three must be offered.
  const dialog = await openFilterMenu(page, "Status");
  for (const value of ["open", "shipped", "cancelled"]) {
    await expect(dialog.getByRole("checkbox", { name: value })).toBeVisible();
  }

  // Add `shipped` to the selection: strictly more rows, and both values present.
  await dialog.getByRole("checkbox", { name: "shipped" }).check();
  await page.keyboard.press("Escape");

  await expect
    .poll(() => page.locator("[data-pretable-row]").count())
    .toBeGreaterThan(openRows);

  const statuses = await page.$$eval(
    '[data-pretable-row] [data-pretable-column-id="status"]',
    (cells) => [...new Set(cells.map((cell) => cell.textContent?.trim()))],
  );
  expect([...statuses].sort()).toEqual(["open", "shipped"]);
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Start a dev server in one terminal:

```bash
pnpm --filter @pretable/app-website exec next dev -p 3100
```

Then:

```bash
BASE_URL=http://localhost:3100 pnpm --filter @pretable/app-website exec playwright test e2e/controlled-query.spec.ts --project=chromium --workers=1
```

Expected: **PASS** if the feature works. This is a coverage task, not a bug fix — the test is the deliverable. If it fails, you have found a real defect: capture the failure, stop, and report it rather than weakening the assertion. The two failures to distinguish:
- `Filter Status` button not found → the funnel label differs from the column header; read the header text and fix the selector.
- checklist empty → distinct-value loading for an `options`-less enum is broken; that is a product bug worth its own issue.

- [ ] **Step 3: Prove the assertion can fail**

Temporarily change `["open", "shipped"]` to `["open"]` in the last assertion and re-run. Expected: FAIL with a diff showing `shipped` present. Restore it.

This matters because the whole point is catching a filter that silently does nothing; an assertion that passes either way is worse than none.

- [ ] **Step 4: Commit**

```bash
git add apps/website/e2e/controlled-query.spec.ts
git commit -m "test(website): pin controlled checklist filtering on the docs grid"
```

---

## Task 2: Collapse and expand on a controlled grouped grid

**Files:**
- Modify: `apps/website/e2e/controlled-query.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/website/e2e/controlled-query.spec.ts`:

```ts
test("collapsing a group hides its children, and expanding brings them back", async ({
  page,
}) => {
  await page.goto("/docs/grid/grouping", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const firstGroup = page.locator("[data-pretable-group-row]").first();
  await expect(firstGroup).toBeVisible();
  await expect(firstGroup).toHaveAttribute("aria-expanded", "true");

  // A NAMED child, not a row count. The grid virtualizes: collapsing a group
  // pulls rows in from below, so `[data-pretable-row]` barely moves and a
  // count-based assertion reports "collapse does nothing" — which is exactly
  // what the 2026-08-14 manual smoke concluded, wrongly.
  const childIds = await page.$$eval(
    "[data-pretable-row]:not([data-pretable-group-row])",
    (rows) =>
      rows
        .map((row) => row.getAttribute("data-pretable-row-id"))
        .filter((id): id is string => id !== null),
  );
  expect(childIds.length).toBeGreaterThan(0);
  const child = page.locator(`[data-pretable-row-id="${childIds[0]}"]`);
  await expect(child).toHaveCount(1);

  await firstGroup.getByRole("button", { name: /^Collapse / }).click();
  await expect(firstGroup).toHaveAttribute("aria-expanded", "false");
  await expect(child).toHaveCount(0);

  await firstGroup.getByRole("button", { name: /^Expand / }).click();
  await expect(firstGroup).toHaveAttribute("aria-expanded", "true");
  await expect(child).toHaveCount(1);
});
```

- [ ] **Step 2: Run it**

```bash
BASE_URL=http://localhost:3100 pnpm --filter @pretable/app-website exec playwright test e2e/controlled-query.spec.ts --project=chromium --workers=1
```

Expected: 2 passed. If the twisty button is not found, read the group row's markup with `await firstGroup.innerHTML()` and fix the selector — `grouping.spec.ts:1213` uses the same `/^Expand /` name and is the reference.

- [ ] **Step 3: Prove the assertion can fail**

Temporarily comment out the `Collapse` click. Expected: FAIL at `aria-expanded` still `"true"`. Restore.

- [ ] **Step 4: Commit**

```bash
git add apps/website/e2e/controlled-query.spec.ts
git commit -m "test(website): pin group collapse/expand by child identity, not row count"
```

---

## Task 3: A real server-fetching surface, and its test

Nothing on the site fetches rows in response to a query, so "server-side row data" has never been exercised end to end. This builds the missing surface: the route handler applies sort, filter and grouping; the client sends the query and renders whatever comes back.

### Task 3a: The dataset and the query application

**Files:**
- Create: `apps/website/app/api/rows/dataset.ts`

- [ ] **Step 1: Write the module**

```ts
export interface ServerRow extends Record<string, unknown> {
  id: string;
  region: string;
  rep: string;
  amount: number;
}

/** Deliberately small and low-cardinality: three regions, four reps. */
export const SERVER_ROWS: ServerRow[] = [
  { id: "s1", region: "East", rep: "Ada", amount: 120 },
  { id: "s2", region: "East", rep: "Brin", amount: 340 },
  { id: "s3", region: "East", rep: "Cyd", amount: 55 },
  { id: "s4", region: "North", rep: "Ada", amount: 900 },
  { id: "s5", region: "North", rep: "Dara", amount: 210 },
  { id: "s6", region: "West", rep: "Brin", amount: 75 },
  { id: "s7", region: "West", rep: "Cyd", amount: 480 },
  { id: "s8", region: "West", rep: "Dara", amount: 260 },
];

export interface ServerQuery {
  filters: { columnId: string; operator: string; value: unknown }[];
  sort: { columnId: string; direction: "asc" | "desc" }[];
  rowGroups: { columnId: string }[];
}

/**
 * The "server". Applies the query itself — the grid is in controlled mode and
 * applies nothing, so whatever this returns is what the user sees. That is the
 * property the e2e leans on: if sorting silently happened client-side too, this
 * function could return garbage and the screen would still look right.
 */
export function applyServerQuery(
  rows: readonly ServerRow[],
  query: ServerQuery,
): ServerRow[] {
  let out = [...rows];

  for (const filter of query.filters) {
    const { columnId, operator, value } = filter;
    if (operator === "isAnyOf" && Array.isArray(value)) {
      out = out.filter((row) => value.includes(row[columnId]));
    } else if (operator === "contains" && typeof value === "string") {
      out = out.filter((row) =>
        String(row[columnId]).toLowerCase().includes(value.toLowerCase()),
      );
    } else if (operator === "gte" && typeof value === "number") {
      out = out.filter((row) => Number(row[columnId]) >= value);
    }
  }

  for (const entry of [...query.sort].reverse()) {
    const { columnId, direction } = entry;
    out.sort((left, right) => {
      const a = left[columnId];
      const b = right[columnId];
      const cmp =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
      return direction === "desc" ? -cmp : cmp;
    });
  }

  // Grouping is expressed as ordering here: rows arrive already clustered by
  // the group key, which is what a server that cannot send tree structure does.
  for (const group of [...query.rowGroups].reverse()) {
    out.sort((left, right) =>
      String(left[group.columnId]).localeCompare(String(right[group.columnId])),
    );
  }

  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/api/rows/dataset.ts
git commit -m "feat(website): a server-side dataset and query application for the fixture"
```

### Task 3b: The route handler

**Files:**
- Create: `apps/website/app/api/rows/route.ts`

- [ ] **Step 1: Write the handler**

```ts
import { NextResponse } from "next/server";

import { applyServerQuery, SERVER_ROWS, type ServerQuery } from "./dataset";

/**
 * Rows for a query. POST rather than GET so the query travels as JSON instead
 * of a hand-rolled encoding, and so responses are never cached — the test
 * asserts one request per query change and a cache hit would swallow them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const query = (await request.json()) as ServerQuery;
  const rows = applyServerQuery(SERVER_ROWS, {
    filters: query.filters ?? [],
    sort: query.sort ?? [],
    rowGroups: query.rowGroups ?? [],
  });

  return NextResponse.json(
    { rows, total: rows.length },
    { headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 2: Verify the endpoint by hand**

With a dev server running:

```bash
curl -s -X POST http://localhost:3100/api/rows \
  -H 'content-type: application/json' \
  -d '{"filters":[],"sort":[{"columnId":"amount","direction":"desc"}],"rowGroups":[]}' \
  | head -c 200
```

Expected: JSON whose first row is `s4` (amount 900).

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/api/rows/route.ts
git commit -m "feat(website): POST /api/rows returns rows for a query"
```

### Task 3c: The fixture page

**Files:**
- Create: `apps/website/app/fixtures/server-query/ServerQueryGrid.tsx`
- Create: `apps/website/app/fixtures/server-query/page.tsx`

- [ ] **Step 1: Write the client component**

```tsx
"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ServerQuery, ServerRow } from "../../api/rows/dataset";

const columns: PretableColumn<ServerRow>[] = [
  { id: "region", header: "Region", type: "enum", widthPx: 120 },
  { id: "rep", header: "Rep", widthPx: 120 },
  { id: "amount", header: "Amount", type: "number", widthPx: 120 },
];

const EMPTY_QUERY: ServerQuery = { filters: [], sort: [], rowGroups: [] };

/**
 * Controlled mode against a real endpoint: the grid reports the query the user
 * asked for, this component fetches rows for it, and the grid renders what
 * comes back. Nothing is sorted or filtered on the client — that is the point,
 * and `data-fetch-count` is how the test proves the round-trip happened.
 */
export function ServerQueryGrid() {
  const [query, setQuery] = useState<ServerQuery>(EMPTY_QUERY);
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [fetchCount, setFetchCount] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    void (async () => {
      const response = await fetch("/api/rows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(query),
      });
      const payload = (await response.json()) as { rows: ServerRow[] };
      // A slower earlier request must not overwrite a newer answer.
      if (mine !== generation.current) return;
      setRows(payload.rows);
      setFetchCount((count) => count + 1);
    })();
  }, [query]);

  const handleQueryChange = useCallback((next: ServerQuery) => {
    setQuery(next);
  }, []);

  return (
    <div data-testid="server-query-fixture" data-fetch-count={fetchCount}>
      <PretableSurface<ServerRow>
        ariaLabel="Server query grid"
        columns={columns}
        getRowId={(row) => row.id}
        onQueryChange={handleQueryChange as never}
        query={query as never}
        rows={rows}
        viewportHeight={320}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

```tsx
import { ServerQueryGrid } from "./ServerQueryGrid";

export default function ServerQueryFixturePage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Server query fixture</h1>
      <ServerQueryGrid />
    </main>
  );
}
```

- [ ] **Step 3: Look at it**

Open http://localhost:3100/fixtures/server-query. Expected: 8 rows, three columns. Click the `Amount` header: the rows reorder and `data-fetch-count` increments — check in devtools with `document.querySelector('[data-testid=server-query-fixture]').dataset.fetchCount`.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/fixtures/server-query
git commit -m "feat(website): a fixture that fetches rows per query change"
```

### Task 3d: The end-to-end test

**Files:**
- Create: `apps/website/e2e/server-query.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * Sort, filter and group against rows the SERVER produced.
 *
 * Every other e2e on this site hands the grid its rows and lets the engine
 * apply the query. This one never does: the fixture is in controlled mode, so
 * the grid applies nothing, and every row on screen came back from
 * `POST /api/rows`. If the client quietly sorted too, these assertions would
 * still pass — so the test also counts the requests, which is the only evidence
 * that the round-trip is real.
 */
const FIXTURE = "/fixtures/server-query";

async function fetchCount(page: import("@playwright/test").Page) {
  return Number(
    await page.getAttribute("[data-testid=server-query-fixture]", "data-fetch-count"),
  );
}

const amounts = async (page: import("@playwright/test").Page) =>
  (
    await page.$$eval('[data-pretable-row] [data-pretable-column-id="amount"]', (cells) =>
      cells.map((cell) => cell.textContent?.trim() ?? ""),
    )
  ).map(Number);

test("the server sorts", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/rows")) requests.push(request.postData() ?? "");
  });

  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await expect.poll(() => page.locator("[data-pretable-row]").count()).toBe(8);

  const before = await fetchCount(page);
  await page.locator('[data-pretable-header-cell][data-pretable-column-id="amount"]').click();

  await expect.poll(() => fetchCount(page)).toBeGreaterThan(before);
  await expect.poll(async () => (await amounts(page))[0]).toBe(55);
  expect(requests.at(-1)).toContain('"columnId":"amount"');

  // Descending on the second click, still server-applied.
  await page.locator('[data-pretable-header-cell][data-pretable-column-id="amount"]').click();
  await expect.poll(async () => (await amounts(page))[0]).toBe(900);
});

test("the server filters", async ({ page }) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await expect.poll(() => page.locator("[data-pretable-row]").count()).toBe(8);

  await page.locator("[data-pretable-header-row]").first().hover();
  await page.getByRole("button", { name: "Filter Region" }).click();
  const dialog = page.getByRole("dialog", { name: "Filter Region" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "East" }).check();
  await page.keyboard.press("Escape");

  await expect.poll(() => page.locator("[data-pretable-row]").count()).toBe(3);
  const regions = await page.$$eval(
    '[data-pretable-row] [data-pretable-column-id="region"]',
    (cells) => [...new Set(cells.map((cell) => cell.textContent?.trim()))],
  );
  expect(regions).toEqual(["East"]);
});

test("the server groups", async ({ page }) => {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);
  await expect.poll(() => page.locator("[data-pretable-row]").count()).toBe(8);

  const before = await fetchCount(page);
  await page.getByRole("button", { name: "Column menu for Region" }).click();
  await page.getByRole("menuitem", { name: "Group by this column" }).click();

  await expect.poll(() => fetchCount(page)).toBeGreaterThan(before);
  // The server returns rows clustered by region; assert the clustering rather
  // than group headers, which only exist when the ENGINE groups.
  const regions = await page.$$eval(
    '[data-pretable-row] [data-pretable-column-id="region"]',
    (cells) => cells.map((cell) => cell.textContent?.trim() ?? ""),
  );
  expect(regions).toEqual([...regions].sort());
});
```

- [ ] **Step 2: Run it**

```bash
BASE_URL=http://localhost:3100 pnpm --filter @pretable/app-website exec playwright test e2e/server-query.spec.ts --project=chromium --workers=1
```

Expected: 3 passed.

Two failures worth telling apart:
- **Row count stays 8 after filtering** → the grid is applying the query itself despite controlled mode, or `onQueryChange` never fired. Check `data-fetch-count`: unchanged means the callback never fired; incremented means the server did not filter, and the bug is in `applyServerQuery`.
- **`Filter Region` not found** → an `enum` column with no `options` needs distinct values, which the grid derives from `rows`; confirm rows arrived before opening the funnel.

- [ ] **Step 3: Prove the round-trip assertion can fail**

In `ServerQueryGrid.tsx`, temporarily change the effect's dependency from `[query]` to `[]` so it fetches once and never again. Re-run. Expected: FAIL — `fetchCount` never increases and the sort assertion times out. Restore `[query]`.

This is the assertion that separates "the server did it" from "the client did it and we never noticed".

- [ ] **Step 4: Commit**

```bash
git add apps/website/e2e/server-query.spec.ts
git commit -m "test(website): sort, filter and group against server-fetched rows"
```

---

## Task 4: Wire the new specs into the suite and verify nothing else moved

**Files:**
- Modify: none expected — `playwright.config.ts` has `testDir: "./e2e"`, so new specs are picked up automatically.

- [ ] **Step 1: Run the whole website suite in both engines**

Build and start a production server (the suite's normal target):

```bash
pnpm build
pnpm --filter @pretable/app-website exec next build
pnpm --filter @pretable/app-website exec next start -p 3100
```

Then:

```bash
BASE_URL=http://localhost:3100 pnpm --filter @pretable/app-website exec playwright test --workers=1
```

Expected: every spec passes, including the three new ones in both chromium and webkit. `--workers=1` matters: this machine saturates and parallel workers produce false flakes.

- [ ] **Step 2: Run the unit gates**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format
```

Expected: all clean. The new route handler and fixture are compiled by `next build` in Step 1, so a type error there surfaces before this.

- [ ] **Step 3: Commit any formatting the gates applied**

```bash
pnpm format:write
git add -A
git commit -m "chore: formatting for the new smoke coverage"
```

---

## Definition of done

- Controlled checklist filtering is pinned by a test that fails when the filter stops applying.
- Group collapse/expand is pinned by child identity, not row counts, so virtualization cannot fake a pass.
- A surface exists where sort, filter and grouping are applied by a server, and the test proves the round-trip happened rather than inferring it from the screen.
- The full website suite passes in both engines against a production build.

## Out of scope

- Making the server fixture paginate or window rows. Row windowing has its own design in flight (#375); this fixture returns the whole result set on purpose so the tests are about query ownership, not transport.
- Group *headers* from a server. The engine builds group rows; a server that only clusters rows cannot produce them, which is why Task 3d asserts clustering instead. Server-produced tree structure belongs with the remote row model on the roadmap.
- Adding these specs to the CI dev-smoke job. They run against either server; which lane owns them is a CI decision, not a coverage one.
