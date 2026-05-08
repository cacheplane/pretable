# Tier 1 B2 Comparative Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three identical `BaselineAdapter` stubs (`gridalpha`/`gridbeta`/`gridgamma`) with real AG Grid Community, TanStack Table v8, and MUI X DataGrid Community adapters across four sequential PRs; re-evaluate H1–H15 against the resulting comparative evidence and refresh the `/bench` page.

**Architecture:** Four sequential PRs in a `b2-comparative-bench` worktree. PR 1 carries the cross-cutting `BenchAdapterId` rename (`gridalpha→ag-grid`, `gridbeta→tanstack`, `gridgamma→mui`) and ships the real AG Grid adapter. PRs 2 and 3 swap in real TanStack and MUI adapters. PR 4 runs the matrix, re-evaluates hypotheses, and rewrites the website's `/bench` page from real evidence. Each comparator uses idiomatic out-of-the-box config; scripts the library doesn't natively support return `unsupported` with a documented reason.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom), Playwright (Chromium), pnpm workspaces. New deps in `apps/bench` only: `ag-grid-react@33`, `ag-grid-community@33`, `@tanstack/react-table@8`, `@tanstack/react-virtual@3`, `@mui/x-data-grid@7`, `@mui/material@5`, `@emotion/react@11`, `@emotion/styled@11`. None of these enter `@pretable/*` package surface.

**Spec:** [`docs/superpowers/specs/2026-05-08-tier1-b2-comparative-bench-design.md`](../specs/2026-05-08-tier1-b2-comparative-bench-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/b2-comparative-bench`. Create via `superpowers:using-git-worktrees` before starting Phase 1.

---

## Phase Map

| Phase | PR Title | Branch |
|---|---|---|
| 1 | feat(bench): replace gridalpha stub with real AG Grid Community adapter | `b2-ag-grid` |
| 2 | feat(bench): real TanStack Table comparator adapter | `b2-tanstack` |
| 3 | feat(bench): real MUI X DataGrid Community comparator adapter | `b2-mui` |
| 4 | feat(bench): comparative S2 runset + H1–H15 re-evaluation + /bench page refresh | `b2-runset` |

Each phase is a separate PR. **Do not begin Phase 2 until Phase 1 has merged**, because Phase 1 carries the cross-cutting type-union rename. Phases 2 and 3 may run in parallel after Phase 1 merges. Phase 4 requires both 2 and 3 merged.

---

## File Structure (cumulative across all phases)

```
packages/bench-runner/src/
└── index.ts                            (MODIFY P1: BenchAdapterId rename, family map)

apps/bench/src/
├── bench-types.ts                      (MODIFY P1: adapterId union rename)
├── bench-runtime.ts                    (MODIFY P1: scrollRuntimeProfiles keys + ag-grid selectors;
│                                          P2: tanstack selectors; P3: mui selectors)
├── bench-app.tsx                       (MODIFY P1: rename family map + ag-grid mount;
│                                          P2: tanstack mount; P3: mui mount)
├── query-state.ts                      (MODIFY P1: adapter param parser rename)
├── app.css                             (MODIFY P1: data-* selectors;
│                                          plus per-phase library CSS imports)
├── baseline-adapter.tsx                (DELETE P1)
├── gridalpha-adapter.tsx               (RENAME→ag-grid-adapter.tsx; full rewrite P1)
├── gridbeta-adapter.tsx                (RENAME→tanstack-adapter.tsx; full rewrite P2)
├── gridgamma-adapter.tsx               (RENAME→mui-adapter.tsx; full rewrite P3)
└── __tests__/
    ├── gridalpha-adapter.test.tsx      (RENAME→ag-grid-adapter.test.tsx; rewrite P1 — if exists)
    ├── gridbeta-adapter.test.tsx       (RENAME→tanstack-adapter.test.tsx; rewrite P2 — if exists)
    ├── gridgamma-adapter.test.tsx      (RENAME→mui-adapter.test.tsx; rewrite P3)
    └── bench-app.test.tsx              (MODIFY P1: query-string fixtures use new adapter ids)

apps/bench/
└── package.json                        (MODIFY P1, P2, P3: new dependencies per phase)

apps/website/app/bench/
└── page.tsx                            (MODIFY P1: ADAPTER_ORDER ids;
                                          P4: prose + data refresh)

scripts/
└── bench-matrix.mjs                    (MODIFY P1: adapter-id strings;
                                          P4: re-evaluate H1-H15, optional threshold notes)

status/runsets/<new-id>/                (NEW P4: comparative S2/hypothesis evidence)

docs/research/
└── repo-memory.md                      (MODIFY P4: B2 milestone entry)
```

---

# PHASE 1 — AG Grid Community adapter + cross-cutting rename

**Branch:** `b2-ag-grid`. **PR title:** `feat(bench): replace gridalpha stub with real AG Grid Community adapter`.

This phase is the largest because it carries the rename for all three new adapter IDs (so PRs 2 and 3 only add their adapter file + deps + selectors, not type plumbing). PRs 2/3 reference `tanstack` / `mui` adapter IDs that are valid in the type system but render a "coming soon" placeholder until their phase ships.

## Task 1.1 — Inventory current codename references

**Files:** read-only.

- [ ] **Step 1.1.1: Run the inventory grep**

```bash
grep -rn "gridalpha\|gridbeta\|gridgamma\|GridAlpha\|GridBeta\|GridGamma\|baseline-adapter\|BaselineAdapter" \
  apps/bench packages/bench-runner scripts apps/website 2>/dev/null \
  | grep -v node_modules | grep -v dist | grep -v worktrees \
  | grep -v "status/" \
  > /tmp/b2-rename-inventory.txt
wc -l /tmp/b2-rename-inventory.txt
```

Expected: roughly 60–80 lines. Read the file. Every line either gets renamed in this phase or is intentionally left alone (status filenames in `status/runsets/<old>/` are frozen evidence, do NOT rewrite).

- [ ] **Step 1.1.2: Confirm no production-package references**

```bash
grep -rn "gridalpha\|gridbeta\|gridgamma" packages 2>/dev/null | grep -v node_modules | grep -v dist
```

Expected: matches only in `packages/bench-runner/src/index.ts` (internal-private package). No `@pretable/core`, `@pretable/react`, `@pretable/ui`, or `@pretable/stream-adapter` references — those are public surface and must not change here.

## Task 1.2 — Rename `BenchAdapterId` union and family map

**Files:** Modify `packages/bench-runner/src/index.ts`.

- [ ] **Step 1.2.1: Edit the `BenchAdapterId` union**

Find (around line 10):

```ts
export type BenchAdapterId =
  | "pretable"
  | "gridalpha"
  | "gridbeta"
  | "gridgamma";
```

Replace with:

```ts
export type BenchAdapterId =
  | "pretable"
  | "ag-grid"
  | "tanstack"
  | "mui";
```

- [ ] **Step 1.2.2: Edit `benchAdapterFamilies`**

Find the `benchAdapterFamilies` Record (around line 184). Update keys to `ag-grid` / `tanstack` / `mui`. Update the `family` field on each entry to a real product name + license tier:

```ts
export const benchAdapterFamilies: Record<BenchAdapterId, BenchAdapterFamily> = {
  pretable: { id: "pretable", family: "pretable" },
  "ag-grid": { id: "ag-grid", family: "AG Grid Community" },
  tanstack: { id: "tanstack", family: "TanStack Table v8" },
  mui: { id: "mui", family: "MUI X DataGrid Community" },
};
```

(Inspect the existing entries — preserve any extra fields like `family`, `displayName`, `notes`. Update display strings to the real product names.)

- [ ] **Step 1.2.3: Update the runtime guard around line 243**

Find:

```ts
!["pretable", "gridalpha", "gridbeta", "gridgamma"].includes(...)
```

Replace the string list with `["pretable", "ag-grid", "tanstack", "mui"]`.

- [ ] **Step 1.2.4: Update the comment around line 306**

Find the comment referencing `apps/bench/src/{pretable,gridalpha,gridgamma,gridbeta}-adapter.tsx` and change to `{pretable,ag-grid,tanstack,mui}-adapter.tsx`.

- [ ] **Step 1.2.5: Typecheck the package**

```bash
pnpm --filter @pretable-internal/bench-runner typecheck
```

Expected: passes.

## Task 1.3 — Rename `bench-types.ts` adapter union

**Files:** Modify `apps/bench/src/bench-types.ts`.

- [ ] **Step 1.3.1: Edit the union**

Find:

```ts
adapterId: "pretable" | "gridalpha" | "gridbeta" | "gridgamma";
```

Replace with:

```ts
adapterId: "pretable" | "ag-grid" | "tanstack" | "mui";
```

(If the file imports `BenchAdapterId` from `@pretable-internal/bench-runner`, prefer using the imported type directly: `adapterId: BenchAdapterId;`. Check the surrounding context.)

## Task 1.4 — Rename `query-state.ts` adapter parser

**Files:** Modify `apps/bench/src/query-state.ts`.

- [ ] **Step 1.4.1: Read the parser block (around lines 28–34)**

```bash
sed -n '20,45p' apps/bench/src/query-state.ts
```

- [ ] **Step 1.4.2: Replace the chained ternary**

Replace the `adapter === "gridalpha" ? "gridalpha" : adapter === "gridbeta" ? ...` chain with:

```ts
const adapterId: BenchAdapterId =
  adapter === "ag-grid"
    ? "ag-grid"
    : adapter === "tanstack"
      ? "tanstack"
      : adapter === "mui"
        ? "mui"
        : "pretable";
```

(Import `BenchAdapterId` from `@pretable-internal/bench-runner` if not already imported.)

- [ ] **Step 1.4.3: Typecheck**

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: many errors in adapter files / bench-app / bench-runtime (we haven't migrated those yet). Note them — they're expected.

## Task 1.5 — Update `bench-runtime.ts` runtime profiles

**Files:** Modify `apps/bench/src/bench-runtime.ts`.

- [ ] **Step 1.5.1: Read the `scrollRuntimeProfiles` block (lines 135–210)**

- [ ] **Step 1.5.2: Replace `gridalpha` profile with `ag-grid`**

```ts
"ag-grid": {
  viewportSelector: ".ag-body-viewport",
  rowSelector: ".ag-row",
  cellSelector: ".ag-cell",
  // Preserve any other fields the existing profile carried (e.g., scroll
  // container variants). Read the existing gridalpha entry and adapt
  // field-by-field — do NOT just blank-replace.
},
```

(The object keys for the `Record` are quoted because `ag-grid` contains a hyphen. TypeScript handles this fine.)

- [ ] **Step 1.5.3: Replace `gridbeta` profile with `tanstack` (placeholder selectors)**

```ts
tanstack: {
  viewportSelector: "[data-pretable-bench-tanstack-viewport]",
  rowSelector: "[data-tanstack-row]",
  cellSelector: "[data-tanstack-cell]",
},
```

These data attrs will be set by the tanstack adapter we ship in Phase 2. For Phase 1, the selectors exist but resolve to nothing because the `tanstack-adapter.tsx` file is still a placeholder.

- [ ] **Step 1.5.4: Replace `gridgamma` profile with `mui`**

```ts
mui: {
  viewportSelector: ".MuiDataGrid-virtualScroller",
  rowSelector: ".MuiDataGrid-row",
  cellSelector: ".MuiDataGrid-cell",
},
```

- [ ] **Step 1.5.5: Update the four other selector references (lines 160, 188, 202, 211, 398, 617, 1167)**

```bash
grep -n "data-grid\(alpha\|beta\|gamma\)" apps/bench/src/bench-runtime.ts
```

For each match, the selector is being constructed against the now-removed adapter id. Decide per-match:

- If the selector is part of a profile-driven helper (uses `profile.cellSelector`), it should already be parameterized — verify and leave alone.
- If the selector is a hardcoded string fallback (e.g., a dev-mode debug log), update to the real product class name (`.ag-cell` / `[data-tanstack-cell]` / `.MuiDataGrid-cell`) or remove if the fallback is no longer meaningful.

When in doubt, prefer "remove the hardcoded fallback and rely on `profile`" — the profile lookup is the source of truth.

## Task 1.6 — Update `bench-app.tsx` adapter family map and imports

**Files:** Modify `apps/bench/src/bench-app.tsx`.

- [ ] **Step 1.6.1: Read the imports + family map block (lines 37–80)**

- [ ] **Step 1.6.2: Replace adapter imports**

Find:

```ts
import { GridAlphaAdapter } from "./gridalpha-adapter";
import { GridGammaAdapter } from "./gridgamma-adapter";
import { GridBetaAdapter } from "./gridbeta-adapter";
```

Replace with:

```ts
import { AgGridAdapter } from "./ag-grid-adapter";
import { TanstackAdapter } from "./tanstack-adapter";
import { MuiAdapter } from "./mui-adapter";
```

(The `tanstack-adapter.tsx` and `mui-adapter.tsx` files don't exist yet — they're placeholders we create in 1.7. The `ag-grid-adapter.tsx` is the real adapter we build in 1.8.)

- [ ] **Step 1.6.3: Replace the family map**

Find the `gridalpha: { ... }`, `gridbeta: { ... }`, `gridgamma: { ... }` entries (around lines 51–80). Replace with:

```ts
"ag-grid": {
  Component: AgGridAdapter,
  label: "AG Grid Community",
  // Preserve any other fields the existing entries carry — read first.
},
tanstack: {
  Component: TanstackAdapter,
  label: "TanStack Table v8",
},
mui: {
  Component: MuiAdapter,
  label: "MUI X DataGrid Community",
},
```

## Task 1.7 — Stub placeholder files for tanstack + mui

**Files:** Create `apps/bench/src/tanstack-adapter.tsx`, `apps/bench/src/mui-adapter.tsx`.

These are placeholders so Phase 1 typechecks. They render a "coming soon" notice. Phases 2 and 3 replace them with real implementations.

- [ ] **Step 1.7.1: Create `tanstack-adapter.tsx`**

```tsx
import type { ScenarioDataset } from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

export interface TanstackAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
}

export function TanstackAdapter(_props: TanstackAdapterProps) {
  return (
    <section
      aria-label="TanStack Table adapter"
      data-benchmark-adapter="tanstack"
      style={{ padding: 16 }}
    >
      <p style={{ margin: 0, fontWeight: 700 }}>TanStack Table v8</p>
      <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
        Real adapter ships in Phase 2 of B2. Currently a placeholder.
      </p>
    </section>
  );
}
```

- [ ] **Step 1.7.2: Create `mui-adapter.tsx`**

Same shape as 1.7.1, exporting `MuiAdapter` with label "MUI X DataGrid Community" and the appropriate `data-benchmark-adapter="mui"`.

## Task 1.8 — Add AG Grid dependencies

**Files:** Modify `apps/bench/package.json`.

- [ ] **Step 1.8.1: Add deps**

```bash
cd apps/bench
pnpm add ag-grid-react@^33 ag-grid-community@^33
cd ../..
```

Expected: `package.json` updated, `pnpm-lock.yaml` updated. Verify majors are pinned (caret on `^33` means same major, which is what we want).

- [ ] **Step 1.8.2: Confirm no transitive leakage to `@pretable/*` packages**

```bash
pnpm why ag-grid-community --filter "@pretable/core" --filter "@pretable/react" --filter "@pretable/ui" --filter "@pretable/stream-adapter" 2>&1 | head
```

Expected: no occurrences. The dep is `apps/bench`-only.

## Task 1.9 — Implement the real AG Grid adapter

**Files:** Delete `apps/bench/src/gridalpha-adapter.tsx`, create `apps/bench/src/ag-grid-adapter.tsx`.

- [ ] **Step 1.9.1: Delete the old file**

```bash
git rm apps/bench/src/gridalpha-adapter.tsx
```

- [ ] **Step 1.9.2: Create `ag-grid-adapter.tsx`**

```tsx
import { useEffect, useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
} from "ag-grid-community";

import type {
  ScenarioColumn,
  ScenarioDataset,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface AgGridAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
  scriptName?: string;
}

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;

function toColDef(column: ScenarioColumn, scriptName: string | undefined): ColDef {
  const def: ColDef = {
    field: column.id,
    headerName: column.label ?? column.id,
    width: column.widthPx ?? 140,
    sortable: true,
    filter: true,
    resizable: true,
  };

  if (scriptName === "scroll-with-format") {
    def.valueFormatter = (params) =>
      Array.isArray(params.value) ? params.value.join(", ") : String(params.value ?? "");
  } else if (scriptName === "scroll-with-render") {
    def.cellRenderer = (params: { value: unknown }) =>
      `<span data-bench-render="cheap">${String(params.value ?? "")}</span>`;
  } else if (scriptName === "scroll-with-heavy-render") {
    def.cellRenderer = (params: { value: unknown }) =>
      `<span data-bench-render="heavy" class="bench-status-badge">` +
      `<span class="bench-badge-dot" aria-hidden></span>` +
      `<span>${String(params.value ?? "")}</span>` +
      `</span>`;
  }

  return def;
}

export function AgGridAdapter({
  dataset,
  onUpdateApiReady,
  runKey,
  scriptName,
}: AgGridAdapterProps) {
  const apiRef = useRef<GridApi | null>(null);
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop
  onUpdateApiReadyRef.current = onUpdateApiReady;

  const columnDefs = useMemo(
    () => dataset.columns.map((c) => toColDef(c, scriptName)),
    [dataset.columns, scriptName],
  );

  const onGridReady = (event: GridReadyEvent) => {
    apiRef.current = event.api;
    const apply: ApplyBenchUpdates = (patches) => {
      const updates = patches.map((p) => ({ ...p }));
      event.api.applyTransaction({ update: updates });
    };
    onUpdateApiReadyRef.current?.(apply);

    if (scriptName === "autosize") {
      const colIds = event.api.getColumns()?.map((c) => c.getColId()) ?? [];
      event.api.autoSizeColumns(colIds, false);
    }
  };

  useEffect(() => {
    apiRef.current?.setGridOption("rowData", dataset.rows.slice());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on runKey
  }, [dataset.rows, runKey]);

  return (
    <section
      aria-label="AG Grid Community adapter"
      data-benchmark-adapter="ag-grid"
      data-bench-result-row-count={String(dataset.rows.length)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>AG Grid Community</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {dataset.rows.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div
        key={runKey}
        style={{ height: VIEWPORT_HEIGHT, minWidth: 720 }}
      >
        <AgGridReact
          theme={themeQuartz}
          rowData={dataset.rows.slice()}
          columnDefs={columnDefs}
          rowHeight={ROW_HEIGHT}
          onGridReady={onGridReady}
          getRowId={(params) => String(params.data.id)}
        />
      </div>
    </section>
  );
}
```

Notes on the implementation:
- `ModuleRegistry.registerModules([AllCommunityModule])` — required in AG Grid v33+ for tree-shakable module access. Idempotent across re-renders.
- `getRowId` is required for `applyTransaction({ update })` to find the right row by id.
- We thread `scriptName` from `bench-app` to drive the cell-renderer flavor (for `scroll-with-format/-render/-heavy-render`). If `bench-app.tsx` doesn't currently pass `scriptName` to adapters, add the prop in step 1.10.

- [ ] **Step 1.9.3: Wire `scriptName` from bench-app to adapters**

Open `apps/bench/src/bench-app.tsx`. Find where the adapter `Component` is rendered (likely something like `<Component dataset={...} runKey={...} onUpdateApiReady={...} />`). Add `scriptName={query.scriptName}` to the props.

Update the family-map entry types if `Component` has a typed prop signature that doesn't accept `scriptName`. The simplest fix: make `scriptName` an optional prop on every adapter (the placeholders ignore it).

- [ ] **Step 1.9.4: Add ag-grid CSS import to `app.css` (or main entry)**

AG Grid v33 with `themeQuartz` does not require external CSS imports — the theme is JS-driven. **However**, if your build still pulls a legacy `ag-grid.css` import from somewhere, remove it. Verify with:

```bash
grep -rn "ag-grid.css\|ag-theme" apps/bench/src
```

Expected: no matches if using `themeQuartz` correctly.

- [ ] **Step 1.9.5: Typecheck**

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: passes.

## Task 1.10 — Update `app.css` data-attribute selectors

**Files:** Modify `apps/bench/src/app.css`.

- [ ] **Step 1.10.1: Edit the `[data-grid*-scroll-viewport]` rule (around line 247)**

The current rule selects on the old codename data-attrs. Replace with the new selectors:

```css
[data-pretable-bench-tanstack-viewport],
.ag-body-viewport,
.MuiDataGrid-virtualScroller {
  /* Preserve existing properties — read the current rule first. */
}
```

(Read the existing rule body — the styling matters and must be preserved.)

## Task 1.11 — Rename adapter tests

**Files:**
- Modify `apps/bench/src/__tests__/bench-app.test.tsx`
- Delete (or rename + rewrite) `apps/bench/src/__tests__/gridalpha-adapter.test.tsx` if it exists; same for gridbeta/gridgamma test files.

- [ ] **Step 1.11.1: Update query-string fixtures in `bench-app.test.tsx`**

Find every occurrence of `?adapter=gridalpha`, `?adapter=gridbeta`, `?adapter=gridgamma` and the assertion strings tied to them. Replace with `ag-grid`, `tanstack`, `mui` respectively. Update label assertions to the new product strings (`"AG Grid Community"`, etc.).

- [ ] **Step 1.11.2: Delete the old adapter tests for gridbeta/gridgamma (Phase 2/3 will rewrite for tanstack/mui)**

```bash
git rm -f apps/bench/src/__tests__/gridbeta-adapter.test.tsx apps/bench/src/__tests__/gridgamma-adapter.test.tsx 2>/dev/null || true
```

(Some of these may not exist — that's fine.)

- [ ] **Step 1.11.3: Create `apps/bench/src/__tests__/ag-grid-adapter.test.tsx`**

```tsx
import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AgGridAdapter } from "../ag-grid-adapter";

const dataset = {
  columns: [
    { id: "id", label: "ID", widthPx: 80 },
    { id: "name", label: "Name", widthPx: 160 },
  ],
  rows: [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ],
};

describe("AgGridAdapter", () => {
  test("mounts and renders AG Grid public selectors", async () => {
    const { container } = render(
      <AgGridAdapter dataset={dataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".ag-body-viewport")).not.toBeNull();
      expect(container.querySelectorAll(".ag-row").length).toBeGreaterThan(0);
      expect(container.querySelectorAll(".ag-cell").length).toBeGreaterThan(0);
    });
  });
});
```

This is the smoke test that catches AG Grid selector drift on minor bumps.

## Task 1.12 — Update `bench-matrix.mjs` adapter strings

**Files:** Modify `scripts/bench-matrix.mjs`.

- [ ] **Step 1.12.1: Find every `gridalpha` / `gridbeta` / `gridgamma` literal**

```bash
grep -n "gridalpha\|gridbeta\|gridgamma" scripts/bench-matrix.mjs
```

- [ ] **Step 1.12.2: Replace each occurrence**

| Old | New |
|---|---|
| `gridalpha` | `ag-grid` |
| `gridbeta` | `tanstack` |
| `gridgamma` | `mui` |

(Hypothesis evaluator threshold values are NOT changed in this phase — only the adapter-id strings.)

- [ ] **Step 1.12.3: Run matrix-script tests**

```bash
node --test scripts/__tests__/bench-matrix.test.mjs
```

Expected: passes. If a fixture in the test file uses old codename strings, update those too.

## Task 1.13 — Update website `/bench` page adapter ids

**Files:** Modify `apps/website/app/bench/page.tsx`.

- [ ] **Step 1.13.1: Edit `ADAPTER_ORDER` (around line 34)**

Find:

```ts
const ADAPTER_ORDER = ["pretable", "gridalpha", "gridbeta"] as const;
```

Replace with:

```ts
const ADAPTER_ORDER = ["pretable", "ag-grid", "tanstack", "mui"] as const;
```

- [ ] **Step 1.13.2: Leave prose untouched**

Do NOT update the editorial copy (e.g., "gridalpha clips," "gridbeta needs DIY assembly") in this phase — that's Phase 4. The result-rendering code should fall back gracefully when an adapter has no data row in the current runset (it currently does — verify by reading lines ~140–200). If a hard reference to a literal codename exists in conditional rendering, keep the conditional but rename the literal.

- [ ] **Step 1.13.3: Build the website**

```bash
pnpm --filter @pretable/website build
```

Expected: build succeeds. Page renders pretable-only data plus empty rows for the three new adapters until Phase 4's runset lands.

## Task 1.14 — Repo-wide gates and PR

- [ ] **Step 1.14.1: Repo-wide typecheck**

```bash
pnpm -w typecheck
```

Expected: passes.

- [ ] **Step 1.14.2: Repo-wide tests**

```bash
pnpm -w test
```

Expected: passes. The new `ag-grid-adapter.test.tsx` runs under jsdom.

- [ ] **Step 1.14.3: Lint and format**

```bash
pnpm -w lint
pnpm format
```

Expected: 0 lint errors. Run `pnpm prettier --write .` if format reports issues.

- [ ] **Step 1.14.4: Commit and push**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(bench): replace gridalpha stub with real AG Grid Community adapter

Phase 1 of 4 for B2 comparative bench. Carries the BenchAdapterId rename
(gridalpha→ag-grid, gridbeta→tanstack, gridgamma→mui) for all four
adapters and ships the real AG Grid Community v33 adapter with idiomatic
out-of-the-box config (themeQuartz, applyTransaction updates, sortable +
filter columns, optional valueFormatter/cellRenderer for cell-renderer
scripts). Tanstack/mui adapters land as placeholder shells in this PR;
real implementations follow in PRs 2 and 3.

No changes to public @pretable/* package surface.
Spec: docs/superpowers/specs/2026-05-08-tier1-b2-comparative-bench-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push -u origin b2-ag-grid
```

- [ ] **Step 1.14.5: Open PR with auto-merge**

```bash
gh pr create --title "feat(bench): replace gridalpha stub with real AG Grid Community adapter" --body "$(cat <<'EOF'
## Summary

Phase 1 of 4 for [Tier 1 B2 comparative bench](../specs/2026-05-08-tier1-b2-comparative-bench-design.md).

- Renames `BenchAdapterId` from codenames to real product ids: `ag-grid`, `tanstack`, `mui`.
- Ships a real AG Grid Community v33 adapter using `themeQuartz`, `applyTransaction` updates, default sort/filter, and optional `valueFormatter` / `cellRenderer` for cell-renderer scripts.
- Tanstack and MUI adapters are placeholder shells until PRs 2 and 3.
- No changes to `@pretable/*` public-surface packages.

## What's NOT in this PR

- Real TanStack adapter (PR 2).
- Real MUI adapter (PR 3).
- Comparative matrix run, runset evidence, H1–H15 re-evaluation, /bench page prose refresh (PR 4).

## Test plan

- [x] `pnpm -w typecheck` passes
- [x] `pnpm -w test` passes (incl. new `ag-grid-adapter.test.tsx`)
- [x] `pnpm -w lint` 0 errors
- [x] `pnpm format` clean
- [x] Bench harness mounts AG Grid in dev mode (`pnpm --filter @pretable/app-bench dev`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

---

# PHASE 2 — Real TanStack Table comparator adapter

**Branch:** `b2-tanstack` (from `main` after Phase 1 merges). **PR title:** `feat(bench): real TanStack Table comparator adapter`.

## Task 2.1 — Add TanStack dependencies

**Files:** Modify `apps/bench/package.json`.

- [ ] **Step 2.1.1: Add deps**

```bash
cd apps/bench
pnpm add @tanstack/react-table@^8 @tanstack/react-virtual@^3
cd ../..
```

- [ ] **Step 2.1.2: Confirm no leakage**

```bash
pnpm why @tanstack/react-table --filter "@pretable/core" --filter "@pretable/react" --filter "@pretable/ui" --filter "@pretable/stream-adapter" 2>&1 | head
```

Expected: no occurrences.

## Task 2.2 — Implement real TanStack adapter

**Files:** Replace `apps/bench/src/tanstack-adapter.tsx` (currently a placeholder from Phase 1).

- [ ] **Step 2.2.1: Replace the placeholder file**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;
const OVERSCAN = 4;

export interface TanstackAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
  scriptName?: string;
}

function toColumnDef(
  column: ScenarioColumn,
  scriptName: string | undefined,
): ColumnDef<ScenarioRow> {
  const def: ColumnDef<ScenarioRow> = {
    id: column.id,
    accessorKey: column.id,
    header: column.label ?? column.id,
    size: column.widthPx ?? 140,
    enableSorting: true,
    enableColumnFilter: true,
  };

  if (scriptName === "scroll-with-format") {
    def.cell = (info) => {
      const value = info.getValue();
      return Array.isArray(value) ? value.join(", ") : String(value ?? "");
    };
  } else if (scriptName === "scroll-with-render") {
    def.cell = (info) => (
      <span data-bench-render="cheap">{String(info.getValue() ?? "")}</span>
    );
  } else if (scriptName === "scroll-with-heavy-render") {
    def.cell = (info) => (
      <span data-bench-render="heavy" className="bench-status-badge">
        <span className="bench-badge-dot" aria-hidden />
        <span>{String(info.getValue() ?? "")}</span>
      </span>
    );
  }

  return def;
}

export function TanstackAdapter({
  dataset,
  onUpdateApiReady,
  runKey,
  scriptName,
}: TanstackAdapterProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync to latest
  onUpdateApiReadyRef.current = onUpdateApiReady;

  const [data, setData] = useState<ScenarioRow[]>(() => dataset.rows.slice());
  const [sorting, setSorting] = useState<SortingState>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runKey reset
    setData(dataset.rows.slice());
    setSorting([]);
  }, [dataset.rows, runKey]);

  const columns = useMemo(
    () => dataset.columns.map((c) => toColumnDef(c, scriptName)),
    [dataset.columns, scriptName],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => String(row.id),
  });

  useEffect(() => {
    const apply: ApplyBenchUpdates = (patches) => {
      setData((prev) => {
        const map = new Map(prev.map((r) => [String(r.id), r] as const));
        for (const patch of patches) {
          const id = String(patch.id);
          const existing = map.get(id);
          if (existing) map.set(id, { ...existing, ...patch });
        }
        return Array.from(map.values());
      });
    };
    onUpdateApiReadyRef.current?.(apply);
  }, [runKey]);

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const totalSize = virtualizer.getTotalSize();
  const virtualRows = virtualizer.getVirtualItems();
  const totalWidth = dataset.columns.reduce(
    (sum, c) => sum + (c.widthPx ?? 140),
    0,
  );

  return (
    <section
      aria-label="TanStack Table adapter"
      data-benchmark-adapter="tanstack"
      data-bench-result-row-count={String(data.length)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>TanStack Table v8</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {data.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div
        key={runKey}
        ref={viewportRef}
        data-pretable-bench-tanstack-viewport=""
        className="adapter-surface"
        style={{
          height: VIEWPORT_HEIGHT,
          minWidth: 720,
          overflow: "auto",
          position: "relative",
        }}
      >
        <div
          style={{
            height: totalSize,
            minWidth: totalWidth,
            position: "relative",
          }}
        >
          {virtualRows.map((vr) => {
            const row = rows[vr.index];
            return (
              <div
                key={row.id}
                data-tanstack-row=""
                tabIndex={vr.index === 0 ? 0 : -1}
                style={{
                  position: "absolute",
                  top: vr.start,
                  left: 0,
                  width: totalWidth,
                  height: ROW_HEIGHT,
                  display: "grid",
                  gridTemplateColumns: dataset.columns
                    .map((c) => `${c.widthPx ?? 140}px`)
                    .join(" "),
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    data-tanstack-cell=""
                    style={{
                      padding: "8px 10px",
                      borderRight: "1px solid rgb(229 233 237)",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

Notes:
- `tabIndex={vr.index === 0 ? 0 : -1}` plumbs basic row tabbability so `keyboard-nav-row` is *provisional*-supported (per spec). If during implementation we discover the bench-runtime helper expects `tabindex="0"` on cells (not rows), revisit: either move tabIndex to cell divs or mark `keyboard-nav-row` as `unsupported` in `bench-app.tsx`'s dispatch. Document the decision in the PR body.
- Sort/filter is handled internally by TanStack. The `sort` script triggers via column-header click handlers — the bench script may need a tanstack-specific click target. Verify by running `pnpm --filter @pretable/app-bench dev` and exercising sort manually before the matrix.

## Task 2.3 — Smoke test for TanStack adapter

**Files:** Create `apps/bench/src/__tests__/tanstack-adapter.test.tsx`.

- [ ] **Step 2.3.1: Create the test**

```tsx
import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { TanstackAdapter } from "../tanstack-adapter";

const dataset = {
  columns: [
    { id: "id", label: "ID", widthPx: 80 },
    { id: "name", label: "Name", widthPx: 160 },
  ],
  rows: [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ],
};

describe("TanstackAdapter", () => {
  test("mounts and exposes selector data attributes", async () => {
    const { container } = render(
      <TanstackAdapter dataset={dataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector("[data-pretable-bench-tanstack-viewport]"),
      ).not.toBeNull();
      expect(
        container.querySelectorAll("[data-tanstack-row]").length,
      ).toBeGreaterThan(0);
      expect(
        container.querySelectorAll("[data-tanstack-cell]").length,
      ).toBeGreaterThan(0);
    });
  });
});
```

## Task 2.4 — Resolve `keyboard-nav-row` provisional status

**Files:** Possibly modify `apps/bench/src/bench-app.tsx`.

- [ ] **Step 2.4.1: Run the harness in dev mode**

```bash
pnpm --filter @pretable/app-bench dev
# Open http://localhost:5173 in a browser
# Select adapter=tanstack, scriptName=keyboard-nav-row, click Run
```

Outcome A: the script completes and `interaction_latency_ms` is reported. Provisional → **supported**. Move on.

Outcome B: the script returns `partial` because `[data-pretable-cell][tabindex="0"]` doesn't resolve (bench-runtime selector). Adjust either:
- The tanstack adapter to add `tabindex="0"` on the first cell of the first row instead of the row, or
- The `bench-runtime`'s `measureBenchKeySequenceRun` to fall back to a row-level tabbable when cell-level isn't found, or
- The `bench-app.tsx` dispatch to short-circuit `keyboard-nav-row` for tanstack and return `unsupported`.

Pick the cheapest option. Default if ambiguous: short-circuit to `unsupported` — accuracy matters more than coverage.

- [ ] **Step 2.4.2: Document the decision in the PR body section "Provisional resolution"**

## Task 2.5 — Repo-wide gates and PR

- [ ] **Step 2.5.1: Run typecheck/test/lint/format**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
```

Expected: all pass.

- [ ] **Step 2.5.2: Commit and PR**

Branch: `b2-tanstack`. PR body sections: Summary, Provisional resolution (from 2.4), What's NOT in this PR (matrix run, MUI adapter, /bench prose refresh), Test plan. Use auto-merge.

---

# PHASE 3 — Real MUI X DataGrid Community comparator adapter

**Branch:** `b2-mui` (from `main` after Phase 1 merges; can run in parallel with Phase 2). **PR title:** `feat(bench): real MUI X DataGrid Community comparator adapter`.

## Task 3.1 — Add MUI dependencies

**Files:** Modify `apps/bench/package.json`.

- [ ] **Step 3.1.1: Add deps**

```bash
cd apps/bench
pnpm add @mui/x-data-grid@^7 @mui/material@^5 @emotion/react@^11 @emotion/styled@^11
cd ../..
```

- [ ] **Step 3.1.2: Confirm no leakage**

```bash
pnpm why @mui/x-data-grid --filter "@pretable/core" --filter "@pretable/react" --filter "@pretable/ui" --filter "@pretable/stream-adapter" 2>&1 | head
```

Expected: no occurrences.

## Task 3.2 — Implement real MUI adapter

**Files:** Replace `apps/bench/src/mui-adapter.tsx`.

- [ ] **Step 3.2.1: Replace the placeholder file**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DataGrid,
  type GridColDef,
  type GridApiCommunity,
} from "@mui/x-data-grid";

import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;

export interface MuiAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
  scriptName?: string;
}

function toColDef(
  column: ScenarioColumn,
  scriptName: string | undefined,
): GridColDef {
  const def: GridColDef = {
    field: column.id,
    headerName: column.label ?? column.id,
    width: column.widthPx ?? 140,
    sortable: true,
    filterable: true,
    resizable: true,
  };

  if (scriptName === "scroll-with-format") {
    def.valueFormatter = (value) =>
      Array.isArray(value) ? value.join(", ") : String(value ?? "");
  } else if (scriptName === "scroll-with-render") {
    def.renderCell = (params) => (
      <span data-bench-render="cheap">{String(params.value ?? "")}</span>
    );
  } else if (scriptName === "scroll-with-heavy-render") {
    def.renderCell = (params) => (
      <span data-bench-render="heavy" className="bench-status-badge">
        <span className="bench-badge-dot" aria-hidden />
        <span>{String(params.value ?? "")}</span>
      </span>
    );
  }

  return def;
}

export function MuiAdapter({
  dataset,
  onUpdateApiReady,
  runKey,
  scriptName,
}: MuiAdapterProps) {
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  // eslint-disable-next-line react-hooks/refs -- sync to latest
  onUpdateApiReadyRef.current = onUpdateApiReady;

  const [rows, setRows] = useState<ScenarioRow[]>(() => dataset.rows.slice());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runKey reset
    setRows(dataset.rows.slice());
  }, [dataset.rows, runKey]);

  const columns = useMemo(
    () => dataset.columns.map((c) => toColDef(c, scriptName)),
    [dataset.columns, scriptName],
  );

  useEffect(() => {
    const apply: ApplyBenchUpdates = (patches) => {
      setRows((prev) => {
        const map = new Map(prev.map((r) => [String(r.id), r] as const));
        for (const patch of patches) {
          const id = String(patch.id);
          const existing = map.get(id);
          if (existing) map.set(id, { ...existing, ...patch });
        }
        return Array.from(map.values());
      });
    };
    onUpdateApiReadyRef.current?.(apply);
  }, [runKey]);

  return (
    <section
      aria-label="MUI X DataGrid adapter"
      data-benchmark-adapter="mui"
      data-bench-result-row-count={String(rows.length)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>MUI X DataGrid Community</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {rows.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div
        key={runKey}
        style={{ height: VIEWPORT_HEIGHT, minWidth: 720 }}
      >
        <DataGrid
          rows={rows}
          columns={columns}
          rowHeight={ROW_HEIGHT}
          hideFooter
          disableRowSelectionOnClick
          getRowId={(row) => String(row.id)}
        />
      </div>
    </section>
  );
}
```

## Task 3.3 — Smoke test for MUI adapter

**Files:** Create `apps/bench/src/__tests__/mui-adapter.test.tsx`.

- [ ] **Step 3.3.1: Create the test**

Same shape as `tanstack-adapter.test.tsx` but assert MUI selectors:

```tsx
await waitFor(() => {
  expect(container.querySelector(".MuiDataGrid-virtualScroller")).not.toBeNull();
  expect(container.querySelectorAll(".MuiDataGrid-row").length).toBeGreaterThan(0);
  expect(container.querySelectorAll(".MuiDataGrid-cell").length).toBeGreaterThan(0);
});
```

(MUI in jsdom may not fully virtualize — that's OK. The smoke test just confirms the public selectors render. If `.MuiDataGrid-virtualScroller` doesn't appear in jsdom, fall back to asserting on `.MuiDataGrid-root` and document the limitation.)

## Task 3.4 — Repo-wide gates and PR

- [ ] **Step 3.4.1: Run typecheck/test/lint/format**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
```

- [ ] **Step 3.4.2: Commit and PR**

Branch: `b2-mui`. Same PR shape as Phase 2 but covering MUI. Auto-merge.

---

# PHASE 4 — Comparative S2 runset + H1–H15 re-evaluation + /bench page refresh

**Branch:** `b2-runset` (from `main` after Phases 2 and 3 both merge). **PR title:** `feat(bench): comparative S2 runset + H1–H15 re-evaluation + /bench page refresh`.

## Task 4.1 — Pre-flight check

- [ ] **Step 4.1.1: Verify all three real adapters run in dev mode**

```bash
pnpm --filter @pretable/app-bench dev
```

For each `adapter ∈ {pretable, ag-grid, tanstack, mui}` × `scriptName ∈ {scroll, sort, filter-text, updates}`:

- Open `http://localhost:5173/?adapter=<a>&scenario=S2&scale=hypothesis&scriptName=<s>`
- Click Run
- Confirm a result row appears (status `completed` or, for documented unsupported scripts, `unsupported` with reason)

Block on this — the matrix run is 90+ minutes; spending 15 minutes confirming the harness is healthy is cheap insurance.

- [ ] **Step 4.1.2: Build the bench harness for the matrix run**

```bash
pnpm --filter @pretable/app-bench build
```

## Task 4.2 — Run the comparative matrix

- [ ] **Step 4.2.1: Execute**

```bash
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable,ag-grid,tanstack,mui \
  --scenarios=S2 \
  --scripts=initial,scroll,sort,filter-text,filter-metadata,updates,autosize,select-range-extend,keyboard-nav-row,select-all,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis \
  --repeats=3
```

Expected wall-clock: 90–120 min. Output goes to `status/runsets/<id>/`.

- [ ] **Step 4.2.2: Identify the new runset directory**

```bash
ls -lt status/runsets/ | head
```

Note the most recent directory id; refer to it as `<runset-id>` in subsequent steps.

## Task 4.3 — Inspect `hypotheses.json`

- [ ] **Step 4.3.1: Read the evaluator results**

```bash
cat status/runsets/<runset-id>/hypotheses.json | jq '.[] | {id, status, summary}'
```

For each H1–H15, decide:

- **Still satisfied:** ship as-is.
- **Now failing (was satisfied before):** the previous claim was against a stub baseline. Honest move: ship the failing evaluation, do not re-thresh the evaluator to mask it. Add a postmortem entry in `repo-memory.md` (Task 4.6).
- **Still failing (was failing before):** no change in narrative. Note in PR body.
- **Now satisfied (was failing before):** real evidence improved the claim. Note in PR body.

Do NOT modify evaluator threshold values to flip a status. The only acceptable evaluator change in this phase is updating the *rationale comment* to reflect the new comparator floor — and only when the threshold was already calibrated against `gridalpha` and now needs a rationale update for `ag-grid`.

- [ ] **Step 4.3.2: Optional — update threshold-rationale comments**

If a hypothesis is `H1 — pretable scroll p95 ≥ 4× gridalpha`'s threshold-comment in `scripts/bench-matrix.mjs` references gridalpha, update the comment to reference `ag-grid` (and the actual measured multiplier from the runset, e.g., `≈ 2.3× ag-grid Community`). The `4×` threshold itself is NOT changed; only the explanatory comment.

If a threshold change feels necessary because the multiplier compressed dramatically, **stop and surface it to the user** — that's a content decision, not an implementation one.

## Task 4.4 — Commit the runset

- [ ] **Step 4.4.1: Commit**

```bash
git add status/runsets/<runset-id>
git commit -m "$(cat <<'EOF'
chore(bench): comparative S2/hypothesis runset against real AG Grid / TanStack / MUI

Matrix: 4 adapters × 13 scripts × 3 repeats on Chromium S2/hypothesis.
First runset against real third-party grids (Phase 1-3 of B2). H1-H15
re-evaluated; results in hypotheses.json.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Replace `<runset-id>` with the actual directory name.

## Task 4.5 — Refresh `apps/website/app/bench/page.tsx`

**Files:** Modify `apps/website/app/bench/page.tsx`.

- [ ] **Step 4.5.1: Re-point the data source to the new runset**

Find where the page reads runset data (likely an import or `fs.readFile` on a JSON path). Update to point at the new `<runset-id>` (or, if the page already reads "the latest runset," verify that resolution works and points at the new one).

- [ ] **Step 4.5.2: Audit the editorial prose**

Find every paragraph or sentence that makes a behavioral claim about a comparator (`"clips"`, `"needs DIY assembly"`, `"applyTransaction"`, etc.). For each:

- If the claim is supported by the runset (e.g., "AG Grid is ~2× slower at scroll p95"), keep / update wording with measured numbers.
- If the claim is unsupported (it was about the stub baseline), delete or rewrite with what the runset actually shows.

Capture the rewritten prose as a "Prose draft" section in the PR body for editorial review before merging. Do NOT auto-merge this PR — block on user review of prose.

- [ ] **Step 4.5.3: Build and visually inspect**

```bash
pnpm --filter @pretable/website build
pnpm --filter @pretable/website preview
# Open http://localhost:3000/bench in a browser; review the rendered page
```

## Task 4.6 — Update `repo-memory.md`

**Files:** Modify `docs/research/repo-memory.md`.

- [ ] **Step 4.6.1: Append a B2 milestone entry**

```md
## 2026-05-08 (or actual completion date)

### Tier 1 B2 — Comparative bench landed against real grids

- gridalpha/gridbeta/gridgamma stubs replaced with real AG Grid Community v33, TanStack Table v8 + react-virtual v3, and MUI X DataGrid Community v7.
- BenchAdapterId renamed to `pretable | ag-grid | tanstack | mui` everywhere except frozen historical runsets.
- Idiomatic out-of-the-box config per adapter; library-tier-honest unsupported matrix.
- One comparative S2/hypothesis runset (3 repeats) committed under `status/runsets/<runset-id>`.
- H1-H15 re-evaluated against real evidence: <list status changes — N satisfied, N failing, N flips>.
- Public-API surface unchanged; new deps land in apps/bench only.

### Postmortem on flipped hypotheses (if any)

<For each H that flipped, one bullet describing what was claimed, what the real evidence shows, and a forward action.>

### Next checkpoint

- <Per the user's priority — typically theming or AI integrations from the standing backlog.>
```

- [ ] **Step 4.6.2: Commit**

```bash
git add docs/research/repo-memory.md
git commit -m "docs(research): repo-memory milestone — Tier 1 B2 comparative bench

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

## Task 4.7 — Repo-wide gates and PR

- [ ] **Step 4.7.1: Run gates**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
```

- [ ] **Step 4.7.2: Push and open PR (NO auto-merge — block on prose review)**

```bash
git push -u origin b2-runset
gh pr create --title "feat(bench): comparative S2 runset + H1–H15 re-evaluation + /bench page refresh" --body "$(cat <<'EOF'
## Summary

Phase 4 of 4 for [Tier 1 B2 comparative bench](../specs/2026-05-08-tier1-b2-comparative-bench-design.md).

- Comparative S2/hypothesis matrix run against real AG Grid / TanStack / MUI.
- H1–H15 re-evaluated. <Summarize: N satisfied, N failing, M flips since the gridalpha-stub era.>
- `/bench` page data source re-pointed at the new runset; editorial prose rewritten to match measured deltas.

## Hypothesis status changes

<Tabulate: H#, before status, after status, summary delta. One row per H1–H15.>

## Prose draft for /bench page

<Paste the rewritten prose for editorial review.>

## What's NOT in this PR

- Threshold value changes in any evaluator (only rationale comments updated).
- Webkit/Firefox runs.
- `/bench` page layout redesign.

## Test plan

- [x] `pnpm -w typecheck` passes
- [x] `pnpm -w test` passes
- [x] `pnpm -w lint` 0 errors
- [x] `pnpm format` clean
- [x] All four adapters run end-to-end in dev mode (Task 4.1)
- [x] Runset committed under `status/runsets/<runset-id>`
- [x] `hypotheses.json` results documented above

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Do not run `gh pr merge --auto`.** Wait for the user's editorial review of the prose. The user merges manually after approving.

---

## Self-Review

**Spec coverage check** (against `2026-05-08-tier1-b2-comparative-bench-design.md`):

| Spec section | Covered by |
|---|---|
| Goal: replace stubs with real grids | Phases 1–3 |
| Non-goals (Webkit, Premium tier, etc.) | Out-of-scope notes in PR bodies |
| Sub-project shape: 4 sequential PRs | Phase Map |
| Adapter ID rename (cross-cutting in PR 1) | Tasks 1.2–1.6, 1.10–1.13 |
| Runtime profiles per adapter | Task 1.5 (ag-grid + placeholders), 2.2/3.2 (data-attrs), 1.5/3.2 (mui) |
| Per-adapter test surface | Tasks 1.11.3, 2.3, 3.3 |
| Bundle/dep impact (apps/bench-only) | Tasks 1.8.2, 2.1.2, 3.1.2 (pnpm why guards) |
| Idiomatic out-of-the-box config | Task 1.9 (ag-grid), 2.2 (tanstack), 3.2 (mui) |
| Documented unsupported matrix | Per-adapter scriptName-driven branches in 1.9.2 / 2.2.1 / 3.2.1; selection scripts return unsupported via dispatch fall-through (existing harness behavior) |
| PR 4: matrix run + evaluation + website refresh | Phase 4, all tasks |
| Threshold-realism handling (don't mask regressions) | Task 4.3.1 (decision rules) + 4.3.2 (rationale-only edits) |
| Open question deferred to PR 4 (prose draft) | Task 4.5.2 |

All sections covered.

**Placeholder scan:** `<runset-id>` appears in Tasks 4.4 and 4.5 — intentional, generated at run-time. `<list status changes>` and `<Tabulate ...>` appear in Tasks 4.6 and 4.7 — intentional, those are content the engineer fills in from the runset they generated. Otherwise no `TBD`/`TODO` placeholders.

**Type consistency check:**

- `BenchAdapterId` union: `"pretable" | "ag-grid" | "tanstack" | "mui"` — same in 1.2.1, 1.3.1, 1.5.2–1.5.4.
- Adapter component names: `AgGridAdapter`, `TanstackAdapter`, `MuiAdapter` — same in 1.6.2, 1.7.1/1.7.2, 1.9.2, 2.2.1, 3.2.1.
- Adapter file paths: `ag-grid-adapter.tsx`, `tanstack-adapter.tsx`, `mui-adapter.tsx` — same throughout.
- `data-pretable-bench-tanstack-viewport`, `data-tanstack-row`, `data-tanstack-cell` selectors: consistent between 1.5.3, 2.2.1, 2.3.1.
- `.ag-body-viewport` / `.ag-row` / `.ag-cell`: consistent between 1.5.2, 1.10.1, 1.11.3.
- `.MuiDataGrid-virtualScroller` / `.MuiDataGrid-row` / `.MuiDataGrid-cell`: consistent between 1.5.4, 1.10.1, 3.3.1.

**Scope check:** Four phases, each producing a self-contained, mergeable PR. Phase 1 is the largest (carries the rename); Phases 2/3 are roughly symmetrical and can run in parallel; Phase 4 is the synthesis. Each phase is small enough to dispatch as a single subagent task per the standing workflow.
