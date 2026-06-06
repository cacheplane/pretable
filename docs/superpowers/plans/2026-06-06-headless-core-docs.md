# Headless engine docs (`@pretable/core`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document `@pretable/core` as a headless state/row-model engine — a new "Headless engine" docs section (5 MDX pages) plus one runnable React custom-renderer example embedded live in the docs.

**Architecture:** The example is a `defineExample` ExampleDef (like `streaming-chat-grid`) whose live `Demo` is a hand-rolled table built on `createGrid` + `useSyncExternalStore` (no `<Pretable>`). A prop-less wrapper component renders it via the existing `<Example>` MDX component and is registered in `docsMdxComponents`, because `compileMDX` (next-mdx-remote/rsc) cannot resolve MDX `import`s — live demos must be prop-less registered components. Docs prose frames core as an engine, not a renderer: `getSnapshot().visibleRows` is the filtered+sorted set, not a viewport window (the engine does not virtualize).

**Tech Stack:** Next 16 + next-mdx-remote/rsc, MDX, React 19 (`useSyncExternalStore`), shiki, `@pretable/core`, vitest + `@testing-library/react` (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-06-headless-core-docs-design.md`

**Branch:** `claude/headless-core-docs` (already created off `origin/main`).

---

## File structure

Create:

- `apps/website/content/examples/headless-custom-renderer/data.ts` — deterministic ~75-row dataset.
- `apps/website/content/examples/headless-custom-renderer/columns.ts` — column defs (`PretableColumn<Service>[]`).
- `apps/website/content/examples/headless-custom-renderer/HeadlessTable.tsx` — the live demo component (createGrid + useSyncExternalStore custom renderer).
- `apps/website/content/examples/headless-custom-renderer/page.tsx` — illustrative "how you'd wire it" source (display-only, like streaming `page.tsx`).
- `apps/website/content/examples/headless-custom-renderer/index.tsx` — `defineExample(...)` exporting `headlessCustomRenderer`.
- `apps/website/content/examples/headless-custom-renderer/__tests__/HeadlessTable.test.tsx` — RTL test.
- `apps/website/app/components/docs/mdx/HeadlessExample.tsx` — prop-less wrapper rendering `<Example example={headlessCustomRenderer} … />`.
- `apps/website/content/docs/headless/index.mdx` — Overview.
- `apps/website/content/docs/headless/getting-started.mdx` — First headless grid (embeds `<HeadlessExample />`).
- `apps/website/content/docs/headless/state-model.mdx` — Snapshot & subscribe.
- `apps/website/content/docs/headless/mutations.mdx` — Actions.
- `apps/website/content/docs/headless/api-reference.mdx` — API reference.

Modify:

- `apps/website/package.json` — add `"@pretable/core": "workspace:*"`.
- `apps/website/app/components/docs/MdxRenderer.tsx` — register `HeadlessExample` in `docsMdxComponents`.
- `apps/website/app/docs/_nav.ts` — add "Headless engine" section after "Grid".
- `apps/website/content/docs/grid/index.mdx` and `apps/website/content/docs/streaming/index.mdx` — add a cross-link to the headless section.

---

## Task 1: Add `@pretable/core` as a website dependency

**Files:**

- Modify: `apps/website/package.json`

- [ ] **Step 1: Add the dependency** — insert `"@pretable/core": "workspace:*",` into `dependencies`, alphabetically near the other `@pretable/*` entries.

- [ ] **Step 2: Install + build core**

Run:

```bash
pnpm install --no-frozen-lockfile && pnpm --filter @pretable/core build
```

Expected: install completes; core emits `packages/core/dist/index.mjs` + `index.d.ts`.
Note: if `vite`/tests later fail to start with an esbuild error, the worktree's `node_modules/esbuild` top-level symlink was dropped by the install — relink: `ESB=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild | head -1); rm -rf node_modules/esbuild; ln -s "${ESB#node_modules/}" node_modules/esbuild`.

- [ ] **Step 3: Verify resolution**

Run:

```bash
cd apps/website && node -e "import('@pretable/core').then(m=>console.log('createGrid:', typeof m.createGrid))"
```

Expected: `createGrid: function`

- [ ] **Step 4: Commit**

```bash
git add apps/website/package.json pnpm-lock.yaml
git commit -m "chore(website): depend on @pretable/core for headless docs example"
```

---

## Task 2: Example dataset + columns

**Files:**

- Create: `apps/website/content/examples/headless-custom-renderer/data.ts`
- Create: `apps/website/content/examples/headless-custom-renderer/columns.ts`

- [ ] **Step 1: Write `data.ts`** (deterministic, ~75 rows — no `Math.random`)

```ts
export interface Service {
  id: string;
  name: string;
  team: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
}

const TEAMS = ["payments", "search", "identity", "growth", "core"];
const STATUSES = ["healthy", "degraded", "down"] as const;

// Deterministic 75-row fixture: stable across renders/SSR (no Math.random).
export const services: Service[] = Array.from({ length: 75 }, (_, i) => ({
  id: `svc-${i}`,
  name: `service-${String(i).padStart(2, "0")}`,
  team: TEAMS[i % TEAMS.length],
  status: STATUSES[i % STATUSES.length],
  latencyMs: 20 + ((i * 37) % 480),
}));
```

- [ ] **Step 2: Write `columns.ts`**

```ts
import type { PretableColumn } from "@pretable/core";

import type { Service } from "./data";

export const columns: PretableColumn<Service>[] = [
  { id: "name", header: "Service", sortable: true },
  { id: "team", header: "Team", sortable: true, filterable: true },
  { id: "status", header: "Status", sortable: true },
  { id: "latencyMs", header: "Latency (ms)", sortable: true },
];
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pretable/app-website typecheck`
Expected: PASS (no errors for the new files).

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/examples/headless-custom-renderer/data.ts apps/website/content/examples/headless-custom-renderer/columns.ts
git commit -m "feat(website): headless example fixture data + columns"
```

---

## Task 3: `HeadlessTable` component (TDD)

The live demo: `createGrid` + `useSyncExternalStore` rendering a custom table with sortable headers, a team filter input, and click-to-toggle row selection. Selection read-back uses the single-row-toggle invariant (each `toggleRowSelection` range has `startRowId === endRowId`).

**Files:**

- Create: `apps/website/content/examples/headless-custom-renderer/HeadlessTable.tsx`
- Test: `apps/website/content/examples/headless-custom-renderer/__tests__/HeadlessTable.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeadlessTable } from "../HeadlessTable";

function dataRowNames(): string[] {
  // First column cell text of each body row (excludes the header row).
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("HeadlessTable", () => {
  it("renders the header plus all 75 rows", () => {
    render(<HeadlessTable />);
    expect(screen.getAllByRole("row")).toHaveLength(76); // 1 header + 75
  });

  it("sorts by latency ascending when the Latency header is clicked", () => {
    render(<HeadlessTable />);
    fireEvent.click(screen.getByRole("button", { name: /latency/i }));
    const names = dataRowNames();
    // svc-0 has the lowest latency (20ms) so it sorts to the top.
    expect(names[0]).toBe("service-00");
  });

  it("filters rows by team", () => {
    render(<HeadlessTable />);
    fireEvent.change(screen.getByLabelText(/filter by team/i), {
      target: { value: "payments" },
    });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBe(15); // 75 / 5 teams
    expect(rows.length).toBeGreaterThan(0);
  });

  it("marks a row selected when clicked", () => {
    render(<HeadlessTable />);
    const firstBodyRow = screen.getAllByRole("row")[1];
    fireEvent.click(firstBodyRow);
    expect(firstBodyRow).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @pretable/app-website test -- HeadlessTable`
Expected: FAIL — `Cannot find module '../HeadlessTable'`.

- [ ] **Step 3: Implement `HeadlessTable.tsx`**

```tsx
"use client";

import { useState, useSyncExternalStore } from "react";

import { createGrid, type PretableSortDirection } from "@pretable/core";

import { columns } from "./columns";
import { services } from "./data";

export function HeadlessTable() {
  // The engine is created once and owns all grid state.
  const [grid] = useState(() =>
    createGrid({ columns, rows: services, getRowId: (r) => r.id }),
  );

  // Subscribe the component to engine changes. getSnapshot is memoized by the
  // engine until the next mutation, so it is safe as the store snapshot.
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  // Each toggleRowSelection range is a single full-width row
  // (startRowId === endRowId), so selected ids read back directly.
  const selectedIds = new Set(
    snapshot.selection.ranges
      .filter((r) => r.startRowId === r.endRowId)
      .map((r) => r.startRowId),
  );

  const toggleSort = (columnId: string) => {
    const current = snapshot.sort;
    const next: PretableSortDirection =
      current.columnId !== columnId
        ? "asc"
        : current.direction === "asc"
          ? "desc"
          : current.direction === "desc"
            ? null
            : "asc";
    grid.setSort(next ? columnId : null, next);
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
        Filter by team{" "}
        <input
          aria-label="Filter by team"
          defaultValue=""
          onChange={(e) => grid.setFilter("team", e.target.value)}
        />
      </label>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col">
                {c.sortable ? (
                  <button type="button" onClick={() => toggleSort(c.id)}>
                    {c.header ?? c.id}
                    {snapshot.sort.columnId === c.id
                      ? snapshot.sort.direction === "asc"
                        ? " ▲"
                        : snapshot.sort.direction === "desc"
                          ? " ▼"
                          : ""
                      : ""}
                  </button>
                ) : (
                  (c.header ?? c.id)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.visibleRows.map(({ id, row }) => (
            <tr
              key={id}
              aria-selected={selectedIds.has(id)}
              onClick={() => grid.toggleRowSelection(id)}
            >
              {columns.map((c) => (
                <td key={c.id}>{String(row[c.id as keyof typeof row])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @pretable/app-website test -- HeadlessTable`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/website/content/examples/headless-custom-renderer/HeadlessTable.tsx apps/website/content/examples/headless-custom-renderer/__tests__/HeadlessTable.test.tsx
git commit -m "feat(website): headless custom-renderer demo component + test"
```

---

## Task 4: Example `page.tsx` (display source) + `index.tsx` (defineExample)

`page.tsx` is shown as source in the example's file tabs (not a route) — it shows the idiomatic wiring a reader would copy. `index.tsx` shiki-highlights the files and pairs them with the live `<HeadlessTable />` Demo, mirroring `streaming-chat-grid/index.tsx`.

**Files:**

- Create: `apps/website/content/examples/headless-custom-renderer/page.tsx`
- Create: `apps/website/content/examples/headless-custom-renderer/index.tsx`

- [ ] **Step 1: Write `page.tsx`** (display-only source; concise wiring)

```tsx
import { useSyncExternalStore, useState } from "react";

import { createGrid } from "@pretable/core";

import { columns } from "./columns";
import { services } from "./data";

// A headless grid: @pretable/core owns sort/filter/selection state; you own
// every pixel of the render. snapshot.visibleRows is the filtered + sorted set.
export function ServicesTable() {
  const [grid] = useState(() =>
    createGrid({ columns, rows: services, getRowId: (r) => r.id }),
  );
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.id} onClick={() => grid.setSort(c.id, "asc")}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {snapshot.visibleRows.map(({ id, row }) => (
          <tr key={id} onClick={() => grid.toggleRowSelection(id)}>
            {columns.map((c) => (
              <td key={c.id}>{String(row[c.id as keyof typeof row])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Write `index.tsx`** (mirror `streaming-chat-grid/index.tsx`)

```tsx
import fs from "node:fs";
import path from "node:path";

import { codeToHtml } from "shiki";

import { defineExample } from "../../../lib/docs/define-example";
import type { ExampleLang } from "../../../lib/docs/define-example";

const DIR = path.join(
  process.cwd(),
  "content/examples/headless-custom-renderer",
);
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

interface FileSpec {
  path: string;
  lang: ExampleLang;
}

const SPEC: readonly FileSpec[] = [
  { path: "page.tsx", lang: "tsx" },
  { path: "columns.ts", lang: "ts" },
  { path: "data.ts", lang: "ts" },
];

const SHIKI_LANG: Record<ExampleLang, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  css: "css",
  json: "json",
  bash: "bash",
};

const files = await Promise.all(
  SPEC.map(async (s) => {
    const source = read(s.path).trimEnd();
    const htmlSource = await codeToHtml(source, {
      lang: SHIKI_LANG[s.lang],
      theme: "github-light",
    });
    return { path: s.path, lang: s.lang, source, htmlSource };
  }),
);

import { HeadlessTable } from "./HeadlessTable";

export const headlessCustomRenderer = defineExample({
  title: "Headless custom renderer",
  Demo: <HeadlessTable />,
  files,
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pretable/app-website typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/examples/headless-custom-renderer/page.tsx apps/website/content/examples/headless-custom-renderer/index.tsx
git commit -m "feat(website): headless example defineExample + display source"
```

---

## Task 5: `HeadlessExample` MDX wrapper + register it

**Files:**

- Create: `apps/website/app/components/docs/mdx/HeadlessExample.tsx`
- Modify: `apps/website/app/components/docs/MdxRenderer.tsx`

- [ ] **Step 1: Write the wrapper** (prop-less, so MDX can use `<HeadlessExample />`)

```tsx
import { headlessCustomRenderer } from "../../../../content/examples/headless-custom-renderer";
import { Example } from "./Example";

export function HeadlessExample() {
  return <Example example={headlessCustomRenderer} showLive defaultOpen />;
}
```

- [ ] **Step 2: Register it** — in `MdxRenderer.tsx`, add the import and the map entry.

Add import (with the other mdx imports):

```tsx
import { HeadlessExample } from "./mdx/HeadlessExample";
```

Add to the `docsMdxComponents` object:

```tsx
  HeadlessExample,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pretable/app-website typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/components/docs/mdx/HeadlessExample.tsx apps/website/app/components/docs/MdxRenderer.tsx
git commit -m "feat(website): register HeadlessExample MDX component"
```

---

## Task 6: Overview page — `docs/headless/index.mdx`

**Files:**

- Create: `apps/website/content/docs/headless/index.mdx`

- [ ] **Step 1: Write the page.** Frontmatter then content. Required content (prose phrasing is the author's; the technical claims below are mandatory and must stay accurate):

Frontmatter:

```mdx
---
title: Headless engine
description: "@pretable/core is the framework-agnostic state + row-model engine beneath <Pretable>. Bring your own rendering."
nav: Headless engine
order: 1
---
```

Sections + mandatory points:

- **Lead:** `@pretable/core` is the engine beneath `<Pretable>` — filtering, sorting, selection, focus, column layout, and data transactions — exposed as a `useSyncExternalStore`-ready store (`subscribe` + `getSnapshot`). It is framework-agnostic and has no React peer requirement.
- **Engine vs renderer** (`<Callout>`): the engine owns _state and the row model_; it does **not** render, measure, or virtualize. `getSnapshot().visibleRows` is "rows passing the current filter, in sort order" — the full logical set, **not** a viewport window. Windowing/virtualization/DOM is what `@pretable/react` adds on top.
- **When to reach for it:** custom/non-table layouts, a non-React renderer, or embedding grid logic in your own component system. Otherwise use `<Pretable>` / `<PretableSurface>` (link both: `/docs/grid/pretable-component`, `/docs/grid/pretable-surface`).
- **Install:** ` ```bash\nnpm i @pretable/core\n``` `
- **Next:** link to `/docs/headless/getting-started`.

- [ ] **Step 2: Commit**

```bash
git add apps/website/content/docs/headless/index.mdx
git commit -m "docs(website): headless engine overview page"
```

---

## Task 7: Getting-started page — `docs/headless/getting-started.mdx`

**Files:**

- Create: `apps/website/content/docs/headless/getting-started.mdx`

- [ ] **Step 1: Write the page.**

Frontmatter:

```mdx
---
title: First headless grid
description: "createGrid + useSyncExternalStore — render your own table from the engine's snapshot."
nav: Headless engine
order: 2
---
```

Required content:

- **Create the engine:** show `createGrid({ columns, rows, getRowId })`. Note `columns` are `PretableColumn<TRow>[]` (`id`, optional `header`, `sortable`, `filterable`, `value`, `format`, …) and link the API reference.
- **Subscribe in React:** the exact snippet —
  ```tsx
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot, // server snapshot — engine snapshot is deterministic
  );
  ```
  State the contract: `subscribe(listener)` returns an unsubscribe fn and fires after every mutation; `getSnapshot()` returns a cached object identity until the next mutation (so it is `useSyncExternalStore`-safe).
- **Render `snapshot.visibleRows`:** reiterate it is the filtered+sorted set; you map it to your own markup.
- **Drive it:** `grid.setSort(id, "asc")`, `grid.setFilter("team", value)`, `grid.toggleRowSelection(id)`.
- **Live example:** embed with `<HeadlessExample />` on its own line (component is registered; no import in MDX).
- **Next:** link to `state-model` and `mutations`.

- [ ] **Step 2: Commit**

```bash
git add apps/website/content/docs/headless/getting-started.mdx
git commit -m "docs(website): headless getting-started page with live example"
```

---

## Task 8: State-model page — `docs/headless/state-model.mdx`

**Files:**

- Create: `apps/website/content/docs/headless/state-model.mdx`

- [ ] **Step 1: Write the page.**

Frontmatter:

```mdx
---
title: Snapshot & subscribe
description: "The getSnapshot shape, the subscribe contract, and useSyncExternalStore integration."
nav: Headless engine
order: 3
---
```

Required content — document every `PretableGridSnapshot` field accurately:

- `visibleRows: PretableVisibleRow<TRow>[]` — filtered + sorted set; each entry `{ id, row, sourceIndex }`. **Not** viewport-windowed.
- `visibleRange: { start, end }` — currently the full range `{ start: 0, end: visibleRows.length }`; reserved for future windowing. Do not rely on it to be a viewport slice.
- `totalRowCount` — count of source rows (pre-filter).
- `sort: { columnId, direction }`, `filters: Record<string,string>`, `selection: { anchor, ranges }`, `focus: { rowId, columnId }`, `viewport: { scrollTop, scrollLeft, width, height }` (note viewport feeds PageUp/PageDown focus math, not row windowing).
- **subscribe contract:** returns unsubscribe; fires on every state change; pair with `getSnapshot`.
- **Caching/identity:** snapshot identity is stable between mutations (engine memoizes), which is what makes `useSyncExternalStore` safe and avoids render loops.
- **SSR:** pass `getSnapshot` as the third `useSyncExternalStore` arg; the engine snapshot is deterministic from `options`.

- [ ] **Step 2: Commit**

```bash
git add apps/website/content/docs/headless/state-model.mdx
git commit -m "docs(website): headless snapshot & subscribe page"
```

---

## Task 9: Mutations page — `docs/headless/mutations.mdx`

**Files:**

- Create: `apps/website/content/docs/headless/mutations.mdx`

- [ ] **Step 1: Write the page.** Group the action methods; each group gets a short paragraph + a focused snippet. Use only methods that exist on `PretableGrid` (see api-reference). Frontmatter:

```mdx
---
title: Actions
description: "Sort, filter, select, focus, lay out columns, and apply data transactions on the engine."
nav: Headless engine
order: 4
---
```

Required groups (method names must match exactly):

- **Sort / filter:** `setSort(columnId | null, "asc"|"desc"|null)`, `setFilter(columnId, value)`, `replaceFilters(record)`, `clearFilters()`.
- **Selection & ranges:** `toggleRowSelection(rowId)`, `selectAll()`, `clearSelection()`, `setSelection(state)`, `addRange(range)`, `extendRangeFromAnchor(addr)`, `setSelectAllVisible(checked)`. Note ranges are `{ startRowId, endRowId, startColumnId, endColumnId }`; a single toggled row is a full-width single-row range.
- **Focus & movement:** `setFocus(addr | null)`, `moveFocus(direction, options?)` with `PretableMoveFocusOptions` (`byPage`, `extend`, `jumpToEdge`).
- **Column layout:** `setColumnWidth`, `setColumnPinned(id, "left"|null)`, `moveColumn(id, toIndex)`, `autosizeColumn(id, opts?)`, `autosizeColumns(opts?)`, `resetColumnLayout()`, `mergeColumnsFromProps(cols)`.
- **Data transactions:** `applyTransaction({ add?, update?, remove? })` — `add`/`update` are rows/partials, `remove` is rowIds. Cross-link the Streaming section (which drives the grid via `applyTransaction`).
- **Viewport:** `setViewport({ scrollTop, scrollLeft, width, height })` — only affects PageUp/PageDown paging in `moveFocus`, not which rows are returned.

- [ ] **Step 2: Commit**

```bash
git add apps/website/content/docs/headless/mutations.mdx
git commit -m "docs(website): headless actions/mutations page"
```

---

## Task 10: API reference page — `docs/headless/api-reference.mdx`

**Files:**

- Create: `apps/website/content/docs/headless/api-reference.mdx`

- [ ] **Step 1: Write the page** mirroring the structure of `apps/website/content/docs/streaming/api-reference.mdx` and `grid/api-reference.mdx`. Frontmatter:

```mdx
---
title: API reference
description: "Every public export of @pretable/core: createGrid, the PretableGrid handle, and the supporting types."
nav: Headless engine
order: 5
---
```

Required: document the surface from `packages/core/core.api.md` — `createGrid` signature; `PretableGridOptions` fields; the full `PretableGrid` method list (signatures + one line each, grouped as in Task 9); and the supporting types (`PretableColumn`, `PretableRow`, `PretableGridSnapshot`, `PretableVisibleRow`, `PretableRowRange`, `PretableSortState`/`Direction`, `PretableSelectionState`, `PretableCellRange`/`Address`, `PretableFocusState`/`Direction`, `PretableMoveFocusOptions`, `PretableViewportState`, `PretableTransaction`, `PretableFormatInput`, `AutosizeOptions`, `PretableRowSelectionTriState`). Open `packages/core/core.api.md` while writing to keep signatures exact.

- [ ] **Step 2: Commit**

```bash
git add apps/website/content/docs/headless/api-reference.mdx
git commit -m "docs(website): headless API reference page"
```

---

## Task 11: Nav wiring + cross-links

**Files:**

- Modify: `apps/website/app/docs/_nav.ts`
- Modify: `apps/website/content/docs/grid/index.mdx`
- Modify: `apps/website/content/docs/streaming/index.mdx`

- [ ] **Step 1: Add the nav section** — in `_nav.ts`, insert after the "Grid" section object and before "Streaming":

```ts
  {
    title: "Headless engine",
    items: [
      { title: "Overview", href: "/docs/headless" },
      { title: "First headless grid", href: "/docs/headless/getting-started" },
      { title: "Snapshot & subscribe", href: "/docs/headless/state-model" },
      { title: "Actions", href: "/docs/headless/mutations" },
      { title: "API reference", href: "/docs/headless/api-reference" },
    ],
  },
```

- [ ] **Step 2: Add cross-links** — add one sentence linking to `/docs/headless` in `grid/index.mdx` (e.g. "Need to render your own UI? See the [headless engine](/docs/headless).") and in `streaming/index.mdx` (near the `grid.applyTransaction` usage: "`grid` here is a [`@pretable/core`](/docs/headless) engine instance."). Keep edits minimal and in-voice.

- [ ] **Step 3: Verify nav renders** — Run the build (Task 12) or a quick dev check; the "Headless engine" section appears between Grid and Streaming with five items.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/docs/_nav.ts apps/website/content/docs/grid/index.mdx apps/website/content/docs/streaming/index.mdx
git commit -m "docs(website): wire headless nav section + cross-links"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Test** — Run: `pnpm --filter @pretable/app-website test`
      Expected: PASS, including the 4 `HeadlessTable` tests.

- [ ] **Step 2: Typecheck** — Run: `pnpm --filter @pretable/app-website typecheck`
      Expected: PASS.

- [ ] **Step 3: Lint** — Run: `pnpm --filter @pretable/app-website lint`
      Expected: PASS.

- [ ] **Step 4: Build** — Run: `pnpm --filter @pretable/app-website build`
      Expected: PASS; the five `/docs/headless/*` routes are generated and the example compiles (shiki highlight + live Demo).

- [ ] **Step 5: Manual smoke** — Run `pnpm --filter @pretable/app-website dev`, open `/docs/headless`, confirm: nav section present (Grid → Headless engine → Streaming), all five pages render, getting-started shows the live interactive table (sort headers reorder, team filter shrinks rows, clicking a row highlights it), cross-links resolve.

- [ ] **Step 6: Final commit (if any uncommitted verification fixups)**

```bash
git add -A && git commit -m "docs(website): headless engine docs — verification fixups"
```

---

## Notes for the executor

- Prose phrasing in the MDX pages is yours; the **technical claims** marked "mandatory"/"required" must stay accurate to the verified engine behavior. The single most important one: **the engine does not virtualize; `visibleRows` is the filtered+sorted set, not a viewport window.** Never imply otherwise.
- Match existing MDX voice (see `streaming/index.mdx`, `grid/clipboard.mdx`): terse, concrete, code-forward. Reuse `<Callout>`, `<Tabs>`/`<Tab>`, `<Card>` where they help.
- Keep all code blocks copy-pasteable and type-correct against the real `@pretable/core` surface (`packages/core/core.api.md`).
- If state-model and mutations read thin while writing, they may be merged into one "Engine API" page (4 pages total) — update `_nav.ts` accordingly. This is permitted without re-approval per the spec.
