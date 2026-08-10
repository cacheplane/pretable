# Pretable Server-Authority Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the engine + React primitives that let an upstream processor (a server) own filtering and sorting while Pretable renders honest counts, honest labels, and an honest data lifecycle — Slice 1 of `docs/superpowers/specs/2026-08-09-server-controlled-exploration-design.md`, Pretable-only, everything `@experimental`.

**Architecture:** `@pretable-internal/grid-core` gains construction-time *processing authority* flags that substitute empty filters / empty sort into the single `deriveVisibleRows` call inside `getSnapshot`, plus a *result metadata* input (`{ total, datasetKey }`) that rides on `setRows` or arrives alone via `setResultMeta`. The snapshot grows `matchingTotal` and `datasetKey`, and `totalRowCount` is hard-renamed to `loadedRowCount`. `@pretable/react` forwards `processing`/`resultMeta`, adds a consumer-asserted `dataState` lifecycle with body-state blocks, and routes every user-facing count through a single `"all" | "loaded"` scope so a 200-of-10,432 window can never be described as "all rows". No Dawn changes, no transport, no fetcher.

**Tech Stack:** TypeScript, React 19, vitest (+ jsdom for React), pnpm workspaces, api-extractor (CI-gated public API reports), changesets, vanilla CSS in `@pretable/ui`.

---

> **Line anchors in this plan are approximate — locate by symbol, not by number.**
> `origin/main` moved during execution (pretable picked up #264, which added
> ~300 lines to `create-grid-core.ts`), and it will move again — Brian runs
> concurrent sessions. Drift is non-uniform, so no global offset corrects it.
> Every `file:line` below was accurate at authoring time; treat it as a hint and
> confirm by searching for the quoted symbol or code. If a cited line holds
> something unrelated, that is drift, not a missing prerequisite — do not "fix"
> the repo to match the plan.


## Read before you start

You are working in the pretable monorepo. Six facts that will otherwise cost you an hour:

1. **`packages/*` CSS is vanilla CSS. No Tailwind.** `@pretable/ui` owns `src/grid.css`; every rule lives inside `@layer pretable` and is wrapped in `:where()` so defaults have specificity (0,0,0). `apps/*` may use Tailwind; packages may not.
2. **The public API is hand-curated.** `packages/core/src/public_api.ts` and `packages/react/src/public_api.ts` are the only export barrels. api-extractor snapshots them into `packages/core/core.api.md` and `packages/react/react.api.md`, and `api:check` is a **required** CI gate. **Always run `pnpm build` before `pnpm api`** — a stale `dist/` silently strips exports from the report and `api:check` will not catch it.
3. **No backcompat aliases.** pretable is pre-1.0 with no external consumers. The `totalRowCount → loadedRowCount` rename is a hard rename including `apps/website` docs and `apps/bench`. Do not add a deprecated alias.
4. **Changesets are required** for changes to the public packages (`@pretable/core`, `@pretable/react`, `@pretable/ui`, `@pretable/stream-adapter` — one fixed version group).
5. **Test commands.** grid-core: `pnpm --filter @pretable-internal/grid-core exec vitest run <path> -t "<name>"`. React: `pnpm --filter @pretable/react exec vitest run --environment jsdom <path> -t "<name>"` (the `--environment jsdom` flag is **not** in the vitest config; it lives in the package's `test` script, so you must pass it when invoking vitest directly). Paths are relative to the package directory. A Vite `configLoader` warning about `__dirname` prints on every run — it is pre-existing noise, not your failure.
6. **Local test flakes.** A full react vitest run times out 1–2 random tests under load. Re-run a failing test alone before believing it.

Design-doc sections that are normative for this plan: §1.3, §4.1–§4.6, §9.3, §9.4, §10.1, §12.1, §13 slice 1.

---

## File Structure

### Created

| Path | Single responsibility |
|---|---|
| `packages/grid-core/src/dev-warn.ts` | `warnOnce(key, message)` + `resetDevWarnings()` — one console warning per key per process, for consumer misconfiguration the engine cannot fix. |
| `packages/grid-core/src/__tests__/local-mode-baseline.test.ts` | Regression net: a default-constructed grid's snapshot and derivation are byte-identical before and after every change in this plan. |
| `packages/grid-core/src/__tests__/processing-authority.test.ts` | The four `{filter, sort}` authority combinations from §4.2, and mutators emitting display state without applying it. |
| `packages/grid-core/src/__tests__/result-meta.test.ts` | `setRows(rows, meta)`, `setResultMeta`, `matchingTotal` precedence, `datasetKey` clear semantics, dev warnings. |
| `packages/react/src/dev-warn.ts` | React-side twin of the engine's `warnOnce` (react depends on `@pretable/core`, not on grid-core internals). |
| `packages/react/src/data-state.ts` | `PretableDataState` type + `resolveBodyStateKind` — which body block a phase owes. |
| `packages/react/src/data-scope.ts` | `resolveDataScope` + `resolveAriaRowCount` — the two honesty rules every label and count reads. |
| `packages/react/src/__tests__/local-mode-baseline.test.tsx` | Regression net for the surface: ARIA, DOM shape, and labels with no new props supplied. |
| `packages/react/src/__tests__/data-state-surface.test.tsx` | Body-state matrix (§4.4), `renderBodyState`, `data-pretable-data-phase`, no-`dataState` inertness. |
| `packages/react/src/__tests__/server-authority-aria.test.tsx` | `aria-rowcount`/`aria-rowindex` per §4.5 with every downgrade; no `aria-busy` in any phase; `ariaDescribedBy`. |
| `packages/react/src/__tests__/scoped-labels.test.tsx` | `selectAllLabel`, scoped select-all + copy announcements, `groupChildCountLabel`, `formatAggregate` scope. |
| `packages/react/src/__tests__/lifecycle-announcements.test.tsx` | `resultsAnnouncement` (+`added`), `dataErrorAnnouncement`, silent refresh, `focusedRowRemovedAnnouncement`, `moreRowsBoundaryAnnouncement`, DK-change focus. |
| `.changeset/server-authority-primitives.md` | One minor changeset for the whole slice. |

### Modified

| Path | What changes |
|---|---|
| `packages/grid-core/src/types.ts` | `PretableProcessingAuthority`, `PretableProcessingOptions`, `PretableMatchingTotal`, `PretableResultMeta`; `PretableGridOptions.processing`; `PretableColumn.filterOperators`; `PretableAggregateFormatInput.scope`; snapshot `totalRowCount → loadedRowCount` + `matchingTotal` + `datasetKey`; `PretableEngine.setRows` signature + `setResultMeta`. |
| `packages/grid-core/src/derived-rows.ts` (38–63) | `deriveVisibleRows` returns `{ rows, filteredCount }` instead of a bare array. |
| `packages/grid-core/src/create-grid-core.ts` | Authority consts; the derivation call (~1508–1521); `setRows` (~1137); new `setResultMeta`; snapshot fields (~1540); dataset-change clear bundle. |
| `packages/grid-core/src/__tests__/{grid-core,set-rows,group-rows}.test.ts` | Rename + `deriveVisibleRows` return-shape fallout. |
| `packages/core/src/types.ts`, `public_api.ts`, `pretable-grid.ts`, `create-grid.ts` | Re-export the new types; widen `setRows`; add `setResultMeta`. |
| `packages/react/src/use-pretable.ts` | `processing`/`resultMeta` options; grid memo scalar deps (253–257); rows+meta effect (263–269); telemetry `loadedRowCount`/`matchingTotal` (112–124, 445–488). |
| `packages/react/src/pretable-surface.tsx` | New props; messages entries + defaults (241–320); `aria-rowcount`/`aria-describedby`/`data-pretable-data-phase` (2211–2224); select-all label + announcement (2554–2641); copy announcement (2356); body-state wrapper + blocks; lifecycle/focus/boundary effects; FilterMenu `filterOperators` + enum dev warn (3694–3721). |
| `packages/react/src/group-row.tsx` (163) | Hardcoded `({group.childCount})` → `groupChildCountLabel`; aggregate `scope`. |
| `packages/react/src/rendering.ts` (38–44) | `formatAggregateValue` gains a required `scope` argument. |
| `packages/react/src/copy.ts` (56–61, 285) | `SerializeRangesArgs.scope`; pass it to `formatAggregateValue`. |
| `packages/react/src/filter-menu/filter-operators.ts` (41–49, 86–92) | `operatorsForType`/`defaultDraft` accept an allow-list. |
| `packages/react/src/filter-menu/FilterMenu.tsx` (24–41, 147) | `filterOperators` prop. |
| `packages/react/src/public_api.ts` | Export the new types. |
| `packages/ui/src/grid.css` | Body-state block styles (vanilla, inside `@layer pretable`). |
| `apps/bench/src/bench-runtime.ts` (55), `apps/bench/src/__tests__/*.ts(x)` | Rename fallout. |
| `apps/website/content/docs/**` | Rename fallout in five MDX files. |
| `packages/core/core.api.md`, `packages/react/react.api.md` | Regenerated. |

---

## Task 1: Rebase onto current origin/main and establish a green baseline

`origin/main` is three commits ahead of this branch (`58796c6` → `a90d1ca`). Brian runs concurrent sessions; re-check `origin/main` between tasks, not only here. **Never `git stash` in a worktree** — the stash stack is shared across worktrees and a parallel session's `pop` can steal your entry. Commit instead.

**Files:** none (git only)

- [ ] **Step 1: Confirm the working tree is clean.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a status --short`. Expect empty output. If not empty, commit what is there before continuing.
- [ ] **Step 2: Fetch and rebase.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a fetch origin && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a rebase origin/main`. Expect `Successfully rebased and updated refs/heads/blove/server-controlled-exploration-arch-f0e82f.` The only commits on this branch are docs, so conflicts are not expected; if one occurs it is in `docs/superpowers/`, keep both sides.
- [ ] **Step 3: Install, in case the rebase moved a lockfile.** Run `pnpm install --frozen-lockfile`. Expect `Done in ...`.
- [ ] **Step 4: Prove the engine baseline is green.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run`. Expect `Test Files  19 passed (19)` (count may differ after the rebase — record it; no failures).
- [ ] **Step 5: Prove the React baseline is green.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom`. Expect all files passing. If 1–2 tests time out, re-run each alone with `-t "<name>"` before believing it — that is the known local load flake.
- [ ] **Step 6: Record the baseline in the branch.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a log --oneline -1` and confirm the parent is `a90d1ca` or newer. No commit needed for this task.

---

## Task 2: Local-mode regression net (write it before anything moves)

This is the safety net for every later task: it asserts that a grid constructed with **no** new props behaves exactly as it does today. It must pass right now, and must keep passing unmodified except for the mechanical rename in Task 3.

**Files:**
- Create: `packages/grid-core/src/__tests__/local-mode-baseline.test.ts`
- Create: `packages/react/src/__tests__/local-mode-baseline.test.tsx`
- Test: both of the above

- [ ] **Step 1: Write the engine baseline test.** Create `packages/grid-core/src/__tests__/local-mode-baseline.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type { PretableDataRow } from "../types";

/**
 * D1-GRID-04: a default-constructed grid — no `processing`, no `resultMeta`,
 * no `dataState` — must behave exactly as it did before server-authority
 * primitives existed. Every assertion here describes shipped 0.0.9 behavior
 * and is expected to survive the whole slice untouched.
 */

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "Ada", score: 3 },
  { id: "b", name: "Bob", score: 1 },
  { id: "c", name: "Cy", score: 2 },
];

const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", type: "number" as const },
];

function makeGrid() {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: rows.map((r) => ({ ...r })),
    getRowId: (row: Row) => row.id,
  });
}

function dataIds(grid: ReturnType<typeof makeGrid>): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter((entry): entry is PretableDataRow<Row> => entry.kind === "data")
    .map((entry) => entry.id);
}

describe("local mode baseline", () => {
  test("snapshot exposes exactly the documented keys", () => {
    expect(Object.keys(makeGrid().getSnapshot()).sort()).toEqual(
      [
        "editing",
        "filters",
        "focus",
        "groupExpansionOverrides",
        "groupsDefaultExpanded",
        "rowGroups",
        "selection",
        "sort",
        "totalRowCount",
        "viewport",
        "visibleRange",
        "visibleRows",
      ].sort(),
    );
  });

  test("supplied order is the model order until a sort is set", () => {
    expect(dataIds(makeGrid())).toEqual(["a", "b", "c"]);
  });

  test("the engine applies sort locally", () => {
    const grid = makeGrid();
    grid.setSort("score", "asc");
    expect(dataIds(grid)).toEqual(["b", "c", "a"]);
  });

  test("the engine applies filters locally", () => {
    const grid = makeGrid();
    grid.setColumnFilter("name", { operator: "contains", value: "a" });
    expect(dataIds(grid)).toEqual(["a"]);
  });

  test("totalRowCount counts source rows, not post-filter rows", () => {
    const grid = makeGrid();
    grid.setColumnFilter("name", { operator: "contains", value: "a" });
    expect(grid.getSnapshot().totalRowCount).toBe(3);
  });

  test("setRows preserves selection and focus for surviving ids", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    grid.setRows([
      { id: "a", name: "Ada 2", score: 3 },
      { id: "b", name: "Bob", score: 1 },
    ]);
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.focus).toEqual({ rowId: "a", columnId: "name" });
  });

  test("grouping synthesizes headers with post-filter child counts", () => {
    const grid = makeGrid();
    grid.setRowGroups(["score"]);
    const groups = grid.getSnapshot().visibleRows.filter((r) => r.kind === "group");
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === "group" && g.childCount === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the engine baseline test and see it pass now.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/local-mode-baseline.test.ts`. Expect `Tests  7 passed (7)`. If the key-list assertion fails, the current snapshot has drifted from this plan's reading of `create-grid-core.ts:1531-1549` — update the expected list to what the engine actually emits before continuing, and note the drift.
- [ ] **Step 3: Write the surface baseline test.** Create `packages/react/src/__tests__/local-mode-baseline.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * D1-GRID-04, React half: with none of the server-authority props supplied the
 * surface's DOM, ARIA and labels are byte-identical to shipped 0.0.9. Every
 * assertion here is expected to survive the whole slice untouched.
 */

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
];

const columns = [{ id: "name", header: "Name", widthPx: 120 }];

function renderSurface() {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
    />,
  );
}

describe("local mode baseline (surface)", () => {
  it("aria-rowcount counts the loaded model plus the header", () => {
    renderSurface();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("data rows start at aria-rowindex 2", () => {
    renderSurface();
    const gridRows = screen.getAllByRole("row");
    expect(gridRows[gridRows.length - 1]).toHaveAttribute("aria-rowindex", "3");
  });

  it("never sets aria-busy on the grid", () => {
    renderSurface();
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
  });

  it("does not set a data-phase attribute", () => {
    renderSurface();
    expect(screen.getByRole("grid")).not.toHaveAttribute(
      "data-pretable-data-phase",
    );
  });

  it("renders no body-state block", () => {
    const view = renderSurface();
    expect(
      view.container.querySelector("[data-pretable-body-state]"),
    ).toBeNull();
  });

  it("does not add a data-state wrapper around the viewport", () => {
    const view = renderSurface();
    expect(
      view.container.querySelector("[data-pretable-data-state-wrapper]"),
    ).toBeNull();
  });

  it('labels the header checkbox "Select all rows"', () => {
    renderSurface();
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the surface baseline test and see it pass now.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/local-mode-baseline.test.tsx`. Expect `Tests  7 passed (7)`.
- [ ] **Step 5: Commit the net.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "test: pin local-mode baseline before server-authority primitives"`.

---

## Task 3: Hard-rename `totalRowCount` → `loadedRowCount`

The old name becomes actively wrong the day two totals exist (§10.1). No alias. Fifteen call sites across four packages and two apps.

**Files:**
- Modify: `packages/grid-core/src/types.ts:408`, `packages/grid-core/src/create-grid-core.ts:1540`
- Modify: `packages/grid-core/src/__tests__/grid-core.test.ts` (208, 294, 331, 350, 394, 408), `set-rows.test.ts` (53, 71), `local-mode-baseline.test.ts` (from Task 2)
- Modify: `packages/react/src/use-pretable.ts:117,464,484`, `packages/react/src/__tests__/pretable.test.tsx:374`
- Modify: `apps/bench/src/bench-runtime.ts:55`, `apps/bench/src/__tests__/bench-runtime.test.ts:95,124`, `apps/bench/src/__tests__/pretable-adapter.test.tsx:88,158`
- Modify: `apps/website/content/docs/grid/api-reference.mdx:314,420`, `grid/custom-rendering.mdx:43,45`, `grid/pretable-surface.mdx:104`, `headless/api-reference.mdx:183`, `headless/state-model.mdx:16`
- Modify: `packages/core/core.api.md`, `packages/react/react.api.md`

- [ ] **Step 1: Rename the snapshot field in the engine type.** In `packages/grid-core/src/types.ts`, replace `  totalRowCount: number;` (line 408, inside `PretableGridSnapshot`) with:

```ts
  /** Count of loaded source records. Not the matching population — see {@link PretableGridSnapshot.matchingTotal}. */
  loadedRowCount: number;
```

- [ ] **Step 2: Rename the emit site.** In `packages/grid-core/src/create-grid-core.ts`, replace `      totalRowCount: sourceRows.length,` (line 1540) with `      loadedRowCount: sourceRows.length,`.
- [ ] **Step 3: Run the engine suite and see it fail.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run`. Expect failures in `grid-core.test.ts` and `set-rows.test.ts` and `local-mode-baseline.test.ts` reading `expected undefined to be 2` and `expected [ 'editing', ... 'totalRowCount', ... ] to deeply equal [...]`.
- [ ] **Step 4: Update the engine tests.** Run `cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a/packages/grid-core && grep -rl totalRowCount src | xargs sed -i '' 's/totalRowCount/loadedRowCount/g'`. Then re-sort the key list in `local-mode-baseline.test.ts` is unnecessary (the test sorts both sides), and rename that test's title by replacing `test("totalRowCount counts source rows, not post-filter rows"` with `test("loadedRowCount counts source rows, not post-filter rows"`.
- [ ] **Step 5: Run the engine suite and see it pass.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run`. Expect every file passing.
- [ ] **Step 6: Rename in React.** Run `cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a/packages/react && grep -rl totalRowCount src | xargs sed -i '' 's/totalRowCount/loadedRowCount/g'`. Then add the doc comment: in `packages/react/src/use-pretable.ts`, replace `  loadedRowCount: number;` inside `PretableTelemetry` with:

```ts
  /** Count of loaded source records. Renamed from `totalRowCount` — it never meant the matching population. */
  loadedRowCount: number;
```

- [ ] **Step 7: Rename in the apps.** Run `cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && grep -rl totalRowCount apps | xargs sed -i '' 's/totalRowCount/loadedRowCount/g'`. This covers `apps/bench` source + tests and all five `apps/website` MDX files. Verify with `grep -rn totalRowCount apps` — expect no output.
- [ ] **Step 8: Fix the one doc line the rename made wrong.** In `apps/website/content/docs/headless/state-model.mdx`, the table row now reads `| loadedRowCount | number | Count of source rows, before filtering. |`. Replace the description cell text `Count of source rows, before filtering.` with `Count of loaded source records, before filtering.`
- [ ] **Step 9: Confirm nothing outside docs/plans still uses the old name.** Run `grep -rn totalRowCount . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=plans --exclude-dir=specs`. Expect only `packages/core/core.api.md` and `packages/react/react.api.md` (regenerated in Step 11).
- [ ] **Step 10: Run every package test.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run && pnpm --filter @pretable/react exec vitest run --environment jsdom && pnpm --filter @pretable/app-bench exec vitest run`. Expect all green.
- [ ] **Step 11: Regenerate the API reports.** Run `pnpm build && pnpm api`. Expect `API Extractor completed successfully` four times, and `git diff --stat packages/core/core.api.md packages/react/react.api.md` showing `totalRowCount` → `loadedRowCount` in three places.
- [ ] **Step 12: Verify the gate.** Run `pnpm api:check`. Expect `API Extractor completed successfully` with no "You have changed the public API signature" error.
- [ ] **Step 13: Commit.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(core)!: rename totalRowCount to loadedRowCount on snapshot and telemetry"`.

---

## Task 4: Engine — `processing` option types (declared, inert)

Types and plumbing only. Behavior lands in Task 5, so the baseline net stays green throughout.

**Files:**
- Modify: `packages/grid-core/src/types.ts` (before `PretableGridOptions`, ~line 185), `packages/grid-core/src/index.ts`
- Modify: `packages/core/src/types.ts`, `packages/core/src/public_api.ts`
- Test: `packages/grid-core/src/__tests__/processing-authority.test.ts` (created)

- [ ] **Step 1: Write the failing test.** Create `packages/grid-core/src/__tests__/processing-authority.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type { PretableDataRow } from "../types";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "Ada", score: 3 },
  { id: "b", name: "Bob", score: 1 },
  { id: "c", name: "Cy", score: 2 },
];

const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", type: "number" as const },
];

function makeGrid(processing?: {
  filter?: "engine" | "external";
  sort?: "engine" | "external";
}) {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: rows.map((r) => ({ ...r })),
    getRowId: (row: Row) => row.id,
    processing,
  });
}

function dataIds(grid: ReturnType<typeof makeGrid>): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter((e): e is PretableDataRow<Row> => e.kind === "data")
    .map((e) => e.id);
}

describe("processing authority", () => {
  test("accepts a processing option without changing the default model", () => {
    expect(dataIds(makeGrid({ filter: "engine", sort: "engine" }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/processing-authority.test.ts`. Expect a TypeScript/vitest error: `Object literal may only specify known properties, and 'processing' does not exist in type 'PretableGridOptions<Row>'`.
- [ ] **Step 3: Add the types.** In `packages/grid-core/src/types.ts`, immediately above the `/**\n * Options accepted by \`createGrid\`.` block, insert:

```ts
/**
 * Who applies an operation to the loaded records: the engine's derivation
 * pipeline, or an external processor upstream of `setRows` (a server, a worker,
 * a wasm index — the engine does not know or care).
 *
 * @experimental
 * @public
 */
export type PretableProcessingAuthority = "engine" | "external";

/**
 * Per-operation processing authority. Construction-time: flipping authority is
 * a dataset pivot, so it takes a new grid rather than a mutator.
 *
 * @experimental
 * @public
 */
export interface PretableProcessingOptions {
  /**
   * `"external"`: filter state is displayed (funnel indicators, menu contents,
   * `snapshot.filters`) but never applied to the loaded records. Default
   * `"engine"`.
   */
  filter?: PretableProcessingAuthority;
  /**
   * `"external"`: sort state is displayed (header arrows, priority badges,
   * `snapshot.sort`) but the model order is the supplied record order. Default
   * `"engine"`.
   */
  sort?: PretableProcessingAuthority;
}
```

- [ ] **Step 4: Add the option field.** In `packages/grid-core/src/types.ts`, inside `PretableGridOptions`, immediately after `  autosize?: boolean | AutosizeOptions;`, insert:

```ts
  /**
   * Who applies filtering and sorting to the loaded records. Construction-time
   * only — flipping authority is honestly a new grid.
   *
   * @experimental
   */
  processing?: PretableProcessingOptions;
```

- [ ] **Step 5: Export from grid-core.** In `packages/grid-core/src/index.ts`, add `  PretableProcessingAuthority,` and `  PretableProcessingOptions,` to the alphabetically-ordered `export type { ... } from "./types";` list (between `PretableMoveFocusOptions` and `PretableRow`).
- [ ] **Step 6: Export from `@pretable/core`.** Add the same two names, in the same alphabetical position, to the `export type { ... }` lists in both `packages/core/src/types.ts` and `packages/core/src/public_api.ts`.
- [ ] **Step 7: Run the test and see it pass.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/processing-authority.test.ts`. Expect `Tests  1 passed (1)`.
- [ ] **Step 8: Confirm the baseline net is untouched.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/local-mode-baseline.test.ts`. Expect `Tests  7 passed (7)`.
- [ ] **Step 9: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(core): add PretableProcessingOptions to grid options (inert)"`.

---

## Task 5: Engine — external authority substitutes into the derivation

The single change site is the `deriveVisibleRows` call in `getSnapshot` (`create-grid-core.ts:1508-1521`). State mutators are untouched: they still sanitize, still store, still emit — they just stop being applied.

**Files:**
- Modify: `packages/grid-core/src/create-grid-core.ts` (~174 for the authority consts, 1508–1521 for the call)
- Test: `packages/grid-core/src/__tests__/processing-authority.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `packages/grid-core/src/__tests__/processing-authority.test.ts`, inside the existing `describe("processing authority", ...)`:

```ts
  test("engine/engine is today's behavior byte-for-byte", () => {
    const grid = makeGrid();
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(dataIds(grid)).toEqual(["b"]);
  });

  test("external/external leaves the supplied order untouched", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(dataIds(grid)).toEqual(["a", "b", "c"]);
  });

  test("external filter with engine sort sorts the unfiltered records", () => {
    const grid = makeGrid({ filter: "external", sort: "engine" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(dataIds(grid)).toEqual(["b", "c", "a"]);
  });

  test("engine filter with external sort filters but keeps supplied order", () => {
    const grid = makeGrid({ filter: "engine", sort: "external" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("score", { operator: "gte", value: 2 });
    expect(dataIds(grid)).toEqual(["a", "c"]);
  });

  test("mutators still record display state under external authority", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    const snap = grid.getSnapshot();
    expect(snap.sort).toEqual([{ columnId: "score", direction: "asc" }]);
    expect(snap.filters).toEqual({
      name: { operator: "contains", value: "b" },
    });
  });

  test("sortable:false still prunes under external sort authority", () => {
    const grid = createGridCore<Row>({
      columns: [{ id: "name" }, { id: "score", sortable: false }],
      rows: rows.map((r) => ({ ...r })),
      getRowId: (row: Row) => row.id,
      processing: { filter: "external", sort: "external" },
    });
    grid.setSort("score", "asc");
    expect(grid.getSnapshot().sort).toEqual([]);
  });

  test("grouping still works under external authority", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRowGroups(["score"]);
    expect(
      grid.getSnapshot().visibleRows.filter((r) => r.kind === "group"),
    ).toHaveLength(3);
  });
```

- [ ] **Step 2: Run and see them fail.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/processing-authority.test.ts`. Expect three failures, e.g. `expected [ 'b' ] to deeply equal [ 'a', 'b', 'c' ]` for "external/external leaves the supplied order untouched".
- [ ] **Step 3: Add the module-level empty inputs.** In `packages/grid-core/src/create-grid-core.ts`, immediately after `const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";` (line 35), insert:

```ts
/**
 * Substituted into the derivation when an operation's authority is external.
 * Module-level so the identity is stable and the derivation cache is not
 * invalidated by a fresh empty literal on every snapshot.
 */
const NO_FILTERS: Record<string, ColumnFilter> = {};
const NO_SORT: PretableSortEntry[] = [];
```

- [ ] **Step 4: Resolve the authorities once at construction.** In `packages/grid-core/src/create-grid-core.ts`, immediately after `  let sourceRows = createSourceRows(options);` (line 174), insert:

```ts
  // Read once: `processing` is construction-time by contract, and `options` is
  // reassigned throughout (setRows, autosize, column mutators), so re-reading
  // it per snapshot would only invite an accidental mid-life flip.
  const filterAuthority: PretableProcessingAuthority =
    options.processing?.filter ?? "engine";
  const sortAuthority: PretableProcessingAuthority =
    options.processing?.sort ?? "engine";
```

- [ ] **Step 5: Import the type.** In `packages/grid-core/src/create-grid-core.ts`, add `  PretableProcessingAuthority,` to the `import type { ... } from "./types";` block (after `PretableMoveFocusOptions`).
- [ ] **Step 6: Substitute in the derivation.** In `packages/grid-core/src/create-grid-core.ts`, inside `getSnapshot`, replace the two lines

```ts
            columns: options.columns,
            filters,
            rows: sourceRows,
            sort,
```

with

```ts
            columns: options.columns,
            // External filter authority: the records arrived already filtered
            // upstream, so applying the displayed filters here would filter the
            // same predicate twice. The state is still displayed — see
            // `snapshot.filters` — it is simply not applied.
            filters: filterAuthority === "external" ? NO_FILTERS : filters,
            rows: sourceRows,
            // External sort authority: the empty-sort path already falls
            // through to `sourceIndex`, i.e. the order the records were
            // supplied in, which is exactly the upstream processor's order.
            sort: sortAuthority === "external" ? NO_SORT : sort,
```

- [ ] **Step 7: Run and see them pass.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/processing-authority.test.ts`. Expect `Tests  8 passed (8)`.
- [ ] **Step 8: Run the whole engine suite.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run`. Expect all green, baseline net included.
- [ ] **Step 9: Commit.** `git -C ... add -A && git -C ... commit -m "feat(core): apply external processing authority in the derivation pipeline"` (use the full worktree path as in earlier tasks).

---

## Task 6: Engine — `matchingTotal` computed locally under engine filter authority

`matchingTotal` under engine filter authority is the exact **post-filter, pre-grouping** count. That number is not derivable from `visibleRows` (group synthesis adds headers; collapsed branches hide children), so `deriveVisibleRows` must report it. This also closes the long-standing "post-filter row count" residual.

**Files:**
- Modify: `packages/grid-core/src/derived-rows.ts:22-63`
- Modify: `packages/grid-core/src/types.ts` (new `PretableMatchingTotal`; snapshot field)
- Modify: `packages/grid-core/src/create-grid-core.ts` (~184 cache slot, ~1500–1549 getSnapshot)
- Modify: `packages/grid-core/src/__tests__/group-rows.test.ts:107`
- Modify: `packages/grid-core/src/index.ts`, `packages/core/src/types.ts`, `packages/core/src/public_api.ts`
- Test: `packages/grid-core/src/__tests__/result-meta.test.ts` (created)

- [ ] **Step 1: Write the failing test.** Create `packages/grid-core/src/__tests__/result-meta.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "Ada", score: 3 },
  { id: "b", name: "Bob", score: 1 },
  { id: "c", name: "Cy", score: 2 },
];

const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", type: "number" as const },
];

function makeGrid(processing?: {
  filter?: "engine" | "external";
  sort?: "engine" | "external";
}) {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: rows.map((r) => ({ ...r })),
    getRowId: (row: Row) => row.id,
    processing,
  });
}

describe("matchingTotal under engine filter authority", () => {
  test("is the exact loaded count when nothing is filtered", () => {
    expect(makeGrid().getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
  });

  test("is the exact post-filter count", () => {
    const grid = makeGrid();
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 1,
    });
  });

  test("is pre-grouping: collapsed branches do not reduce it", () => {
    const grid = makeGrid();
    grid.setRowGroups(["score"]);
    grid.collapseAll();
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
  });

  test("datasetKey is null before any meta is supplied", () => {
    expect(makeGrid().getSnapshot().datasetKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/result-meta.test.ts`. Expect `expected undefined to deeply equal { kind: 'exact', count: 3 }`.
- [ ] **Step 3: Change `deriveVisibleRows` to report the filtered count.** In `packages/grid-core/src/derived-rows.ts`, immediately after the `DeriveVisibleRowsInput` interface, insert:

```ts
/** Output of the pipeline: the flat visible model plus the count behind it. */
export interface DeriveVisibleRowsResult<TRow extends PretableRow> {
  rows: PretableVisibleRow<TRow>[];
  /**
   * How many source rows survived the filter pass — post-filter, pre-grouping.
   * Deliberately reported here rather than recomputed: it is not derivable from
   * `rows` (group synthesis adds header rows and collapsed branches hide their
   * children), and a second filter pass would double the pipeline's cost.
   */
  filteredCount: number;
}
```

Then replace the body of `deriveVisibleRows` — from `): PretableVisibleRow<TRow>[] {` through its closing `}` — with:

```ts
): DeriveVisibleRowsResult<TRow> {
  const resolvedFilters = resolveFilters(input.columns, input.filters);
  const filtered = input.rows.filter((entry) =>
    matchesFilters(entry.row, resolvedFilters),
  );

  return {
    rows: buildGroupedRows<TRow>({
      rows: filtered,
      // Only worth carrying the pre-filter set when it can actually differ.
      // Equal lengths mean the filter removed nothing, so `filtered` is a copy
      // of `input.rows` in the same order and the two sort identically —
      // `buildGroupedRows` sorts whichever it folds over, so skipping here does
      // not change the fold order.
      allRows:
        input.aggregateFilteredRows && filtered.length !== input.rows.length
          ? input.rows
          : undefined,
      columns: input.columns,
      rowGroups: input.rowGroups ?? [],
      sort: input.sort,
      groupExpansionOverrides: input.groupExpansionOverrides ?? NO_OVERRIDES,
      defaultExpanded: input.groupsDefaultExpanded ?? true,
    }),
    filteredCount: filtered.length,
  };
}
```

- [ ] **Step 4: Add `PretableMatchingTotal` and the two snapshot fields.** In `packages/grid-core/src/types.ts`, immediately above the `PretableGridSnapshot` doc comment, insert:

```ts
/**
 * How many records match the fulfilled query — loaded or not. Three kinds
 * because real backends have three answers: SQL gives an exact count,
 * sampling engines give an estimate, and Elasticsearch gives
 * `{ relation: "gte", value: 10000 }`.
 *
 * @experimental
 * @public
 */
export type PretableMatchingTotal =
  | { kind: "exact"; count: number }
  | { kind: "estimate"; count: number }
  | { kind: "unknown"; atLeast?: number };
```

and inside `PretableGridSnapshot`, immediately after the `loadedRowCount` field, insert:

```ts
  /**
   * Engine filter authority: computed locally and always exact (post-filter,
   * pre-grouping). External filter authority: the last supplied
   * `resultMeta.total`, else `{ kind: "unknown" }`.
   *
   * @experimental
   */
  matchingTotal: PretableMatchingTotal;
  /**
   * The last supplied dataset identity; `null` before any. Local mode never
   * changes it.
   *
   * @experimental
   */
  datasetKey: string | null;
```

- [ ] **Step 5: Add the cache slot and compute the total.** In `packages/grid-core/src/create-grid-core.ts`, immediately after `  let cachedSnapshot: PretableGridSnapshot<TRow> | null = null;` (line 184), insert:

```ts
  let cachedFilteredCount = 0;
  /** Last supplied `resultMeta.total`; only consulted under external filter authority. */
  let suppliedTotal: PretableMatchingTotal | null = null;
  let datasetKey: string | null = null;
```

Then in `getSnapshot`, replace

```ts
    const visibleRows = derivedIsFresh
      ? cachedVisibleRows!
      : preserveAggregateIdentity(
          deriveVisibleRows({
```

…through the closing `        );` of that expression, with:

```ts
    let visibleRows: PretableVisibleRow<TRow>[];
    let filteredCount: number;

    if (derivedIsFresh) {
      visibleRows = cachedVisibleRows!;
      filteredCount = cachedFilteredCount;
    } else {
      const derived = deriveVisibleRows({
        columns: options.columns,
        // External filter authority: the records arrived already filtered
        // upstream, so applying the displayed filters here would filter the
        // same predicate twice. The state is still displayed — see
        // `snapshot.filters` — it is simply not applied.
        filters: filterAuthority === "external" ? NO_FILTERS : filters,
        rows: sourceRows,
        // External sort authority: the empty-sort path already falls through to
        // `sourceIndex`, i.e. the order the records were supplied in, which is
        // exactly the upstream processor's order.
        sort: sortAuthority === "external" ? NO_SORT : sort,
        rowGroups,
        groupExpansionOverrides,
        groupsDefaultExpanded,
        aggregateFilteredRows,
      });
      visibleRows = preserveAggregateIdentity(derived.rows);
      filteredCount = derived.filteredCount;
    }
```

(This replaces the substitution edit from Task 5 Step 6 — the comments carry over verbatim.) Then, immediately after `    cachedVisibleRows = visibleRows;`, insert `    cachedFilteredCount = filteredCount;`.

- [ ] **Step 6: Emit the two new snapshot fields.** In `create-grid-core.ts`, immediately after `      loadedRowCount: sourceRows.length,` inside the `cachedSnapshot = { ... }` literal, insert:

```ts
      matchingTotal:
        filterAuthority === "external"
          ? (suppliedTotal ?? { kind: "unknown" })
          : { kind: "exact", count: filteredCount },
      datasetKey,
```

- [ ] **Step 7: Import the new type.** Add `  PretableMatchingTotal,` to the `import type { ... } from "./types";` block in `create-grid-core.ts` (after `PretableGridOptions`).
- [ ] **Step 8: Fix the one other `deriveVisibleRows` caller.** In `packages/grid-core/src/__tests__/group-rows.test.ts:107`, the expression `const expected = deriveVisibleRows<Holding>({` now returns an object. Append `.rows` to the end of that call — i.e. change the closing `    });` of that call to `    }).rows;`.
- [ ] **Step 9: Export the type.** Add `  PretableMatchingTotal,` to the alphabetized `export type { ... }` lists in `packages/grid-core/src/index.ts`, `packages/core/src/types.ts`, and `packages/core/src/public_api.ts` (between `PretableGroupRow` and `PretableMoveFocusOptions`).
- [ ] **Step 10: Update the baseline snapshot key list.** In `packages/grid-core/src/__tests__/local-mode-baseline.test.ts`, add `"matchingTotal",` and `"datasetKey",` to the expected key array. This is the *only* permitted edit to the baseline net in this slice: two additive keys, no removals, no value changes.
- [ ] **Step 11: Run and see it pass.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run`. Expect all files green, `result-meta.test.ts` with `Tests  4 passed (4)`.
- [ ] **Step 12: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(core): compute snapshot.matchingTotal from the filter pass"`.

---

## Task 7: Engine — `PretableResultMeta`, `setRows(rows, meta)`, `setResultMeta`

**Files:**
- Create: `packages/grid-core/src/dev-warn.ts`
- Modify: `packages/grid-core/src/types.ts` (`PretableResultMeta`; `PretableEngine.setRows`/`setResultMeta`)
- Modify: `packages/grid-core/src/create-grid-core.ts` (setRows ~1137, new setResultMeta)
- Modify: `packages/core/src/pretable-grid.ts`, `packages/core/src/create-grid.ts`, `packages/core/src/types.ts`, `packages/core/src/public_api.ts`
- Test: `packages/grid-core/src/__tests__/result-meta.test.ts`

- [ ] **Step 1: Write the failing tests.** Append a new `describe` block to `packages/grid-core/src/__tests__/result-meta.test.ts`:

```ts
describe("result meta under external filter authority", () => {
  test("setRows carries the total in the same emit as the rows", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setRows(rows.slice(0, 2), { total: { kind: "exact", count: 4120 } });
    const snap = grid.getSnapshot();
    expect(emits).toBe(1);
    expect(snap.loadedRowCount).toBe(2);
    expect(snap.matchingTotal).toEqual({ kind: "exact", count: 4120 });
  });

  test("matchingTotal is unknown until a total is supplied", () => {
    expect(
      makeGrid({ filter: "external", sort: "external" }).getSnapshot()
        .matchingTotal,
    ).toEqual({ kind: "unknown" });
  });

  test("setResultMeta refines the total without a rows replacement", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { total: { kind: "estimate", count: 5000 } });
    const rowsBefore = grid.getSnapshot().visibleRows;
    grid.setResultMeta({ total: { kind: "exact", count: 5032 } });
    const snap = grid.getSnapshot();
    expect(snap.matchingTotal).toEqual({ kind: "exact", count: 5032 });
    expect(snap.visibleRows).toEqual(rowsBefore);
  });

  test("setResultMeta with an unchanged total does not emit", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { total: { kind: "exact", count: 9 } });
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setResultMeta({ total: { kind: "exact", count: 9 } });
    expect(emits).toBe(0);
  });

  test("appending is setRows(prev.concat(page)) and preserves selection", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRows(rows.slice(0, 2), { total: { kind: "exact", count: 3 } });
    grid.toggleRowSelection("a");
    grid.setRows(rows, { total: { kind: "exact", count: 3 } });
    const snap = grid.getSnapshot();
    expect(snap.loadedRowCount).toBe(3);
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.selection.ranges[0]!.startRowId).toBe("a");
  });

  test("a supplied total under engine filter authority is ignored, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const grid = makeGrid();
    grid.setRows(rows, { total: { kind: "exact", count: 999 } });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("resultMeta.total");
    warn.mockRestore();
  });
});
```

Add `vi` to the vitest import at the top of the file and `import { resetDevWarnings } from "../dev-warn";`.

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/result-meta.test.ts`. Expect `Failed to resolve import "../dev-warn"`.
- [ ] **Step 3: Create the dev-warning helper.** Create `packages/grid-core/src/dev-warn.ts`:

```ts
const warned = new Set<string>();

/**
 * One console warning per key per process. The conditions that call this
 * describe consumer misconfiguration the engine cannot repair, and they are
 * evaluated on paths that run once per poll tick — a warning per emit under a
 * 2 s cadence would be a firehose that trains people to ignore it.
 *
 * @internal
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn(message);
}

/**
 * Forget every emitted key. Tests only — the set is module state, so without
 * this a second test asserting the same warning would see nothing.
 *
 * @internal
 */
export function resetDevWarnings(): void {
  warned.clear();
}
```

- [ ] **Step 4: Add `PretableResultMeta` to the types.** In `packages/grid-core/src/types.ts`, immediately after the `PretableMatchingTotal` block, insert:

```ts
/**
 * Metadata about the result set the loaded records came from. Supplied
 * alongside `setRows`, or on its own via `setResultMeta`.
 *
 * **Contiguous-from-head contract.** The loaded records must be a prefix of the
 * result set in result order. That is what makes loaded model index `i` equal
 * dataset position `i`, which is what lets the renderer publish global
 * `aria-rowindex` values. Windowed or noncontiguous loading is not
 * representable here and downgrades the ARIA counts.
 *
 * @experimental
 * @public
 */
export interface PretableResultMeta {
  /** Matching total for the result set the loaded records came from. */
  total?: PretableMatchingTotal;
  /**
   * Dataset identity. When this key CHANGES between calls the loaded records
   * answer a different question: the engine clears selection, focus,
   * group-expansion overrides and any in-flight edit. A stable (or omitted) key
   * preserves all of them — the existing streaming guarantees. The first key
   * supplied is an assignment, not a change.
   */
  datasetKey?: string;
}
```

- [ ] **Step 5: Widen the engine interface.** In `packages/grid-core/src/types.ts`, inside `PretableEngine`, replace `  setRows(rows: TRow[]): void;` with:

```ts
  setRows(rows: TRow[], meta?: PretableResultMeta): void;
  setResultMeta(meta: PretableResultMeta): void;
```

- [ ] **Step 6: Implement in the engine.** In `packages/grid-core/src/create-grid-core.ts`:

(a) Add `import { warnOnce } from "./dev-warn";` next to the other local imports, and `  PretableResultMeta,` to the `import type { ... } from "./types";` block.

(b) Immediately after the `NO_SORT` const, add:

```ts
const SUPPLIED_TOTAL_WARN_KEY = "supplied-total-under-engine-filter";
const SUPPLIED_TOTAL_WARN_MESSAGE =
  '[pretable] resultMeta.total was supplied while filter authority is "engine". ' +
  "The engine computes the matching total locally from its own filter pass, so " +
  "the supplied value is ignored — the two cannot be reconciled. Pass " +
  'processing: { filter: "external" } if an upstream processor owns filtering.';
```

(c) Immediately above the `store` object (before `const store = {`), add:

```ts
  /** Store the parts of `meta` the current authority can honor. */
  function applyResultMeta(meta: PretableResultMeta | undefined): void {
    if (!meta) {
      return;
    }
    if (meta.datasetKey !== undefined) {
      datasetKey = meta.datasetKey;
    }
    if (meta.total !== undefined) {
      if (filterAuthority === "external") {
        suppliedTotal = meta.total;
      } else {
        warnOnce(SUPPLIED_TOTAL_WARN_KEY, SUPPLIED_TOTAL_WARN_MESSAGE);
      }
    }
  }
```

(d) In `setRows`, replace the first line `      const before = captureVisibleRowsForFocusReconciliation();` with:

```ts
      applyResultMeta(meta);
      const before = captureVisibleRowsForFocusReconciliation();
```

and change the signature `    setRows(nextRows: TRow[]) {` to `    setRows(nextRows: TRow[], meta?: PretableResultMeta) {`.

(e) Immediately after the closing `    },` of `setRows`, insert:

```ts
    setResultMeta(meta: PretableResultMeta) {
      const nextKey = meta.datasetKey ?? datasetKey;
      const nextTotal =
        meta.total !== undefined && filterAuthority === "external"
          ? meta.total
          : suppliedTotal;

      if (meta.total !== undefined && filterAuthority !== "external") {
        warnOnce(SUPPLIED_TOTAL_WARN_KEY, SUPPLIED_TOTAL_WARN_MESSAGE);
      }

      if (nextKey === datasetKey && matchingTotalsEqual(nextTotal, suppliedTotal)) {
        return;
      }

      datasetKey = nextKey;
      suppliedTotal = nextTotal;
      emit();
    },
```

(f) At the bottom of the file, next to `function clamp(...)`, add:

```ts
function matchingTotalsEqual(
  a: PretableMatchingTotal | null,
  b: PretableMatchingTotal | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "unknown") {
    return a.atLeast === (b as { atLeast?: number }).atLeast;
  }
  return a.count === (b as { count: number }).count;
}
```

- [ ] **Step 7: Widen the `@pretable/core` facade.** In `packages/core/src/pretable-grid.ts`, replace `  setRows(rows: TRow[]): void;` with:

```ts
  setRows(rows: TRow[], meta?: PretableResultMeta): void;
  /**
   * Update result metadata without a rows replacement — a late-arriving exact
   * count, say. Avoids forcing a fake rows-identity change.
   *
   * @experimental
   */
  setResultMeta(meta: PretableResultMeta): void;
```

and add `  PretableResultMeta,` to its `import type { ... } from "@pretable-internal/grid-core";` block. In `packages/core/src/create-grid.ts`, add `    setResultMeta: engine.setResultMeta,` immediately after `    setRows: engine.setRows,`.

- [ ] **Step 8: Export the type.** Add `  PretableResultMeta,` to the alphabetized `export type { ... }` lists in `packages/grid-core/src/index.ts`, `packages/core/src/types.ts`, and `packages/core/src/public_api.ts` (between `PretableRowSelectionTriState` and `PretableSelectionState`).
- [ ] **Step 9: Run and see them pass.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/result-meta.test.ts`. Expect `Tests  10 passed (10)`.
- [ ] **Step 10: Run the whole engine + core suites.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run && pnpm --filter @pretable/core exec vitest run`. Expect all green.
- [ ] **Step 11: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(core): add PretableResultMeta via setRows and setResultMeta"`.

---

## Task 8: Engine — `datasetKey` change clears the interaction bundle

A different `datasetKey` means the loaded records answer a different question. Clear selection, focus, group-expansion overrides, the in-flight edit and the aggregate-identity cache; **suppress the clamped-index focus fallback**, because a row position in the old query's result has no relationship to the same position in a different query's window.

**Files:**
- Modify: `packages/grid-core/src/create-grid-core.ts` (`setRows`, `setResultMeta`, new `clearForDatasetChange`)
- Test: `packages/grid-core/src/__tests__/result-meta.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `packages/grid-core/src/__tests__/result-meta.test.ts`:

```ts
describe("datasetKey", () => {
  function externalGrid() {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRows(rows, { datasetKey: "q1", total: { kind: "exact", count: 3 } });
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    grid.beginEdit({ rowId: "b", columnId: "name" });
    return grid;
  }

  test("the first key is an assignment, not a pivot", () => {
    const grid = makeGrid({ filter: "external" });
    grid.toggleRowSelection("a");
    grid.setRows(rows, { datasetKey: "q1" });
    expect(grid.getSnapshot().selection.ranges).toHaveLength(1);
    expect(grid.getSnapshot().datasetKey).toBe("q1");
  });

  test("an unchanged key preserves selection, focus and edit", () => {
    const grid = externalGrid();
    grid.setRows(rows, { datasetKey: "q1" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.focus).toEqual({ rowId: "a", columnId: "name" });
    expect(snap.editing).not.toBeNull();
  });

  test("a changed key clears selection, focus and edit", () => {
    const grid = externalGrid();
    grid.setRows(rows, { datasetKey: "q2" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toEqual([]);
    expect(snap.focus).toEqual({ rowId: null, columnId: null });
    expect(snap.editing).toBeNull();
    expect(snap.datasetKey).toBe("q2");
  });

  test("a changed key suppresses the clamped-index focus fallback", () => {
    const grid = externalGrid();
    // "a" survives the replacement, so same-key reconciliation would keep it.
    grid.setRows(rows, { datasetKey: "q2" });
    expect(grid.getSnapshot().focus.rowId).toBeNull();
  });

  test("a changed key clears group-expansion overrides", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { datasetKey: "q1" });
    grid.setRowGroups(["score"]);
    const firstGroup = grid.getSnapshot().visibleRows.find((r) => r.kind === "group")!;
    grid.setGroupExpanded(firstGroup.id, false);
    expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(1);
    grid.setRows(rows, { datasetKey: "q2" });
    expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(0);
  });

  test("setResultMeta can pivot the dataset too", () => {
    const grid = externalGrid();
    grid.setResultMeta({ datasetKey: "q2" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toEqual([]);
    expect(snap.datasetKey).toBe("q2");
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/result-meta.test.ts -t "a changed key clears selection"`. Expect `expected [ { …(4) } ] to deeply equal []`.
- [ ] **Step 3: Add the clear bundle.** In `packages/grid-core/src/create-grid-core.ts`, immediately above `applyResultMeta` (added in Task 7), insert:

```ts
  /**
   * The dataset-pivot clear bundle. A different `datasetKey` means the loaded
   * records answer a different question, so nothing keyed to the old answer
   * survives — including the aggregate-identity cache, whose group ids are
   * path-derived and would otherwise hand back a previous query's objects.
   */
  function clearForDatasetChange(): void {
    selection = { ranges: [], anchor: null };
    focus = { rowId: null, columnId: null };
    groupExpansionOverrides = new Set<string>();
    editing = null;
    previousAggregates = new Map();
    cachedVisibleRows = null;
  }
```

- [ ] **Step 4: Wire it into `setRows`.** In `setRows`, replace

```ts
      applyResultMeta(meta);
      const before = captureVisibleRowsForFocusReconciliation();
```

with

```ts
      const datasetChanged =
        meta?.datasetKey !== undefined &&
        datasetKey !== null &&
        meta.datasetKey !== datasetKey;

      if (datasetChanged) {
        clearForDatasetChange();
      }

      applyResultMeta(meta);

      // `null` disables focus reconciliation entirely. Across an identity
      // change the clamped-index fallback is not a repair, it is a guess:
      // position i in the old query's result says nothing about position i in
      // a different query's window.
      const before = datasetChanged
        ? null
        : captureVisibleRowsForFocusReconciliation();
```

- [ ] **Step 5: Wire it into `setResultMeta`.** In `setResultMeta`, immediately after the early-return guard `      }` that follows `if (nextKey === datasetKey && matchingTotalsEqual(...))`, insert:

```ts
      if (nextKey !== datasetKey && datasetKey !== null) {
        clearForDatasetChange();
      }
```

- [ ] **Step 6: Run and see them pass.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/result-meta.test.ts`. Expect `Tests  16 passed (16)`.
- [ ] **Step 7: Run the whole engine suite.** Run `pnpm --filter @pretable-internal/grid-core exec vitest run`. Expect all green.
- [ ] **Step 8: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(core): clear interaction state on a datasetKey change"`.

---

## Task 9: `column.filterOperators` — prune the funnel menu

The built-in funnel appends `isEmpty`/`isNotEmpty` to every type. A consumer whose processor cannot express those operators is otherwise forced to ship a control that does nothing — the exact dishonesty class this slice exists to remove.

**Files:**
- Modify: `packages/grid-core/src/types.ts` (`PretableColumn`, after `filterable?`)
- Create: `packages/react/src/dev-warn.ts`
- Modify: `packages/react/src/filter-menu/filter-operators.ts:41-49,86-92`
- Modify: `packages/react/src/filter-menu/FilterMenu.tsx:24-44,147`
- Modify: `packages/react/src/pretable-surface.tsx:3704-3719`
- Test: `packages/react/src/__tests__/filter-operators.test.ts`, `packages/react/src/__tests__/filter-menu-surface.test.tsx`

- [ ] **Step 1: Write the failing unit tests.** Append to `packages/react/src/__tests__/filter-operators.test.ts`, inside `describe("operatorsForType", ...)`:

```ts
  it("prunes to the declared allow-list, in the per-type order", () => {
    expect(operatorsForType("text", ["equals", "contains"])).toEqual([
      "contains",
      "equals",
    ]);
  });

  it("drops isEmpty/isNotEmpty when they are not allowed", () => {
    expect(operatorsForType("enum", ["isAnyOf", "isNoneOf"])).toEqual([
      "isAnyOf",
      "isNoneOf",
    ]);
  });

  it("falls back to the full set and warns when the allow-list matches nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    expect(operatorsForType("number", ["isAnyOf"])).toEqual([
      "equals",
      "notEquals",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
```

Add `vi` to the vitest import and `import { resetDevWarnings } from "../dev-warn";`.

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/filter-operators.test.ts`. Expect `Failed to resolve import "../dev-warn"`.
- [ ] **Step 3: Create the React dev-warn twin.** Create `packages/react/src/dev-warn.ts` with byte-identical content to `packages/grid-core/src/dev-warn.ts` (Task 7 Step 3). It is duplicated rather than shared because `@pretable/react` depends on the *public* `@pretable/core`, and `warnOnce` is not public API — eight lines is cheaper than widening the surface.
- [ ] **Step 4: Add `filterOperators` to the column type.** In `packages/grid-core/src/types.ts`, inside `PretableColumn`, immediately after `  filterable?: boolean;`, insert:

```ts
  /**
   * Restrict the filter menu to the operators the processor can honor. Omitted
   * = the full per-type set (today's behavior). Load-bearing under external
   * filter authority: an unpruned menu offers operators the server will ignore.
   *
   * @experimental
   */
  filterOperators?: FilterOperator[];
```

- [ ] **Step 5: Teach `operatorsForType` the allow-list.** In `packages/react/src/filter-menu/filter-operators.ts`, add `import { warnOnce } from "../dev-warn";` at the top, then replace the whole `operatorsForType` function with:

```ts
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
```

and replace `export function defaultDraft(type: ColumnType): FilterDraft {` / `  const operator = operatorsForType(type)[0]!;` with:

```ts
export function defaultDraft(
  type: ColumnType,
  allowed?: readonly FilterOperator[],
): FilterDraft {
  const operator = operatorsForType(type, allowed)[0]!;
```

- [ ] **Step 6: Run the unit tests and see them pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/filter-operators.test.ts`. Expect all passing.
- [ ] **Step 7: Write the failing surface test.** Append to `packages/react/src/__tests__/filter-menu-surface.test.tsx`, inside its top-level `describe`:

```tsx
  it("column.filterOperators prunes the funnel's operator select", () => {
    const view = render(
      <PretableSurface<Row>
        ariaLabel="Rows"
        columns={[
          {
            id: "name",
            header: "Name",
            filterable: true,
            filterOperators: ["contains", "startsWith"],
          },
        ]}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
      />,
    );
    fireEvent.click(view.container.querySelector("[data-pretable-funnel]")!);
    const select = screen.getByLabelText("Filter operator");
    expect(
      [...select.querySelectorAll("option")].map((o) => o.getAttribute("value")),
    ).toEqual(["contains", "startsWith"]);
  });
```

Check the funnel's actual attribute selector against the existing tests in that file and use whatever they use to click the funnel (search for `funnel` in the file) — do not invent a selector.

- [ ] **Step 8: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/filter-menu-surface.test.tsx -t "prunes the funnel"`. Expect the option list to still contain `isEmpty`.
- [ ] **Step 9: Thread the prop through `FilterMenu`.** In `packages/react/src/filter-menu/FilterMenu.tsx`: add `  filterOperators,` to the destructured parameter list (after `options,`), add `  filterOperators?: FilterOperator[];` to the inline props type (after `options: { value: string; label?: string }[];`), and change line 147 `  const operators = operatorsForType(type);` to `  const operators = operatorsForType(type, filterOperators);`. Also change the two `defaultDraft(type)` call sites in that file to `defaultDraft(type, filterOperators)`.
- [ ] **Step 10: Pass it from the surface.** In `packages/react/src/pretable-surface.tsx`, inside the `<FilterMenu ... />` element (~3704), add `                filterOperators={col.filterOperators}` immediately after the `type={col.type ?? "text"}` line.
- [ ] **Step 11: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/filter-menu-surface.test.tsx`. Expect all passing.
- [ ] **Step 12: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): honor column.filterOperators in the funnel menu"`.

---

## Task 10: React — forward `processing` and `resultMeta`; extend telemetry

**Files:**
- Modify: `packages/react/src/use-pretable.ts:112-124` (telemetry type), `149-161` (options), `253-269` (memo + rows effect), `445-488` (telemetry memo)
- Modify: `packages/react/src/pretable-surface.tsx` (props ~430–560, `usePretable` call ~949)
- Modify: `packages/react/src/public_api.ts`
- Test: `packages/react/src/__tests__/use-pretable-streaming.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append to `packages/react/src/__tests__/use-pretable-streaming.test.tsx`:

```tsx
  it("does not recreate the grid when processing is an inline object literal", () => {
    const seen: unknown[] = [];
    function Harness({ rows }: { rows: Row[] }) {
      const model = usePretable<Row>({
        columns,
        rows,
        getRowId: (row) => row.id,
        viewportHeight: 300,
        processing: { filter: "external", sort: "external" },
      });
      seen.push(model.grid);
      return null;
    }
    const view = render(<Harness rows={rowsA} />);
    view.rerender(<Harness rows={rowsB} />);
    expect(new Set(seen).size).toBe(1);
  });

  it("routes a meta-only change through setResultMeta and keeps the rows array", () => {
    function Harness({
      rows,
      total,
    }: {
      rows: Row[];
      total: number;
    }) {
      const model = usePretable<Row>({
        columns,
        rows,
        getRowId: (row) => row.id,
        viewportHeight: 300,
        processing: { filter: "external" },
        resultMeta: { total: { kind: "exact", count: total } },
      });
      return (
        <div
          data-total={JSON.stringify(model.snapshot.matchingTotal)}
          data-loaded={model.telemetry.loadedRowCount}
        />
      );
    }
    const view = render(<Harness rows={rowsA} total={100} />);
    view.rerender(<Harness rows={rowsA} total={101} />);
    const node = view.container.firstElementChild!;
    expect(node.getAttribute("data-total")).toBe(
      JSON.stringify({ kind: "exact", count: 101 }),
    );
    expect(node.getAttribute("data-loaded")).toBe(String(rowsA.length));
  });
```

Reuse whatever `columns`, `rowsA`, `rowsB`, `Row` the file already defines; if the names differ, use the file's own names rather than adding fixtures.

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/use-pretable-streaming.test.tsx`. Expect `Object literal may only specify known properties, and 'processing' does not exist in type 'UsePretableOptions<Row>'`.
- [ ] **Step 3: Extend the hook options.** In `packages/react/src/use-pretable.ts`, inside `UsePretableOptions`, immediately after `  autosize?: boolean | AutosizeOptions;`, insert:

```ts
  /**
   * Who applies filtering and sorting. Forwarded to `createGrid`. Participates
   * in the grid memo as its two scalar fields, never as object identity.
   *
   * @experimental
   */
  processing?: PretableProcessingOptions;
  /**
   * Matching total + dataset identity for the loaded records. Applied through
   * `setRows` when `rows` also changed, otherwise through `setResultMeta`.
   *
   * @experimental
   */
  resultMeta?: PretableResultMeta;
```

and add `  type PretableProcessingOptions,`, `  type PretableResultMeta,`, `  type PretableMatchingTotal,` to the `from "@pretable/core"` import block.

- [ ] **Step 4: Extend the telemetry type.** In `packages/react/src/use-pretable.ts`, inside `PretableTelemetry`, immediately after the `loadedRowCount` field, insert:

```ts
  /**
   * How many records match the fulfilled query — loaded or not. Equal to the
   * exact post-filter count in local mode.
   *
   * @experimental
   */
  matchingTotal: PretableMatchingTotal;
```

- [ ] **Step 5: Destructure the new options.** In the `usePretable` parameter destructuring, add `  processing,` and `  resultMeta,` alongside `autosize`.
- [ ] **Step 6: Rebuild the grid memo on scalar authority changes only.** Replace the memo at lines 253–257 with:

```ts
  // Object identity is deliberately not a dependency: an inline
  // `processing={{ filter: "external" }}` literal is a new object every render
  // and must not rebuild the grid (which would destroy selection, focus,
  // measured heights and any in-flight edit on every keystroke).
  const processingFilter = processing?.filter;
  const processingSort = processing?.sort;
  const grid = useMemo(
    () =>
      createGrid({
        columns,
        rows,
        getRowId: stableGetRowId,
        autosize,
        processing:
          processingFilter === undefined && processingSort === undefined
            ? undefined
            : { filter: processingFilter, sort: processingSort },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows reconciled via grid.setRows, columns via mergeColumnsFromProps, getRowId via the stable wrapper above; processing participates as its scalar fields
    [autosize, stableGetRowId, processingFilter, processingSort],
  );
```

- [ ] **Step 7: Commit rows and meta in one emit.** Replace the rows layout effect at lines 262–269 with:

```ts
  const lastRowsRef = useRef(rows);
  // Starts `undefined` rather than `resultMeta` so an initial meta reaches the
  // grid: `createGrid` takes no meta, and the rows branch below never fires on
  // the first commit.
  const lastResultMetaRef = useRef<PretableResultMeta | undefined>(undefined);
  useLayoutEffect(() => {
    const rowsChanged = lastRowsRef.current !== rows;
    const metaChanged = lastResultMetaRef.current !== resultMeta;
    lastRowsRef.current = rows;
    lastResultMetaRef.current = resultMeta;

    if (rowsChanged) {
      // One call, one emit: rows and their total can never render torn.
      grid.setRows(rows, resultMeta);
      return;
    }

    if (metaChanged && resultMeta) {
      // A refined total with the same rows — no rows-identity churn needed.
      grid.setResultMeta(resultMeta);
    }
  }, [grid, resultMeta, rows]);
```

- [ ] **Step 8: Publish the total in telemetry.** In the telemetry memo, add `      matchingTotal: snapshot.matchingTotal,` immediately after the `loadedRowCount` entry, and add `    snapshot.matchingTotal,` to the dependency array next to `snapshot.loadedRowCount`.
- [ ] **Step 9: Add the surface props.** In `packages/react/src/pretable-surface.tsx`, inside `PretableSurfaceProps`, immediately after the `state?: PretableSurfaceState | null;` field, insert:

```ts
  /**
   * Who applies filtering and sorting to the loaded records. Construction-time:
   * changing it after mount does rebuild the grid.
   *
   * @experimental
   */
  processing?: PretableProcessingOptions;
  /**
   * Matching total + dataset identity for the loaded records.
   *
   * @experimental
   */
  resultMeta?: PretableResultMeta;
  /**
   * Pass-through to the grid element, e.g. to associate a stale-results notice
   * rendered outside the grid.
   *
   * @experimental
   */
  ariaDescribedBy?: string;
```

Add `processing`, `resultMeta`, `ariaDescribedBy` to the component's parameter destructuring, add the two type imports from `@pretable/core`, and pass `    processing,` + `    resultMeta,` into the `usePretable({ ... })` call (~949).

- [ ] **Step 10: Wire `aria-describedby`.** In the `scrollViewport` JSX (~2211), immediately after `      aria-colcount={drawnColumns.length}`, insert `      aria-describedby={ariaDescribedBy}`.
- [ ] **Step 11: Export the new types from React.** In `packages/react/src/public_api.ts`, add `  PretableMatchingTotal,`, `  PretableProcessingAuthority,`, `  PretableProcessingOptions,`, `  PretableResultMeta,` to the `export type { ... } from "@pretable/core";` block.
- [ ] **Step 12: Run and see them pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/use-pretable-streaming.test.tsx src/__tests__/local-mode-baseline.test.tsx`. Expect all passing.
- [ ] **Step 13: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): forward processing and resultMeta; publish matchingTotal in telemetry"`.

---

## Task 11: React — the ARIA row-count honesty rules

ARIA 1.2: `aria-rowcount` is the total row count of the **full** table including rows not in the DOM, `-1` when unknown; `aria-rowindex` is the 1-based position within the full table counting the header. **`aria-rowindex` needs no code change** — under a head-anchored contiguous window, loaded model index `i` *is* dataset position `i`, so the existing `rowIndex + 2` is already the global position. Only `aria-rowcount` moves, and only when every honesty condition holds.

**Files:**
- Create: `packages/react/src/data-scope.ts`
- Modify: `packages/react/src/pretable-surface.tsx:2214` (`aria-rowcount`)
- Test: `packages/react/src/__tests__/server-authority-aria.test.tsx` (created)

- [ ] **Step 1: Write the failing test.** Create `packages/react/src/__tests__/server-authority-aria.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";

afterEach(cleanup);

type Row = { id: string; name: string; team: string };

const rows: Row[] = [
  { id: "a", name: "Ada", team: "x" },
  { id: "b", name: "Bob", team: "y" },
];

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "team", header: "Team", widthPx: 120 },
];

function renderSurface(opts: {
  processing?: PretableProcessingOptions;
  total?: PretableMatchingTotal;
  rowGroups?: string[];
}) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      processing={opts.processing}
      resultMeta={opts.total ? { total: opts.total } : undefined}
      state={opts.rowGroups ? { rowGroups: opts.rowGroups } : undefined}
    />,
  );
}

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

describe("aria-rowcount honesty rules", () => {
  it("publishes the exact population under full external authority", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "5433");
  });

  it("keeps global aria-rowindex arithmetic (model index + 2)", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
    });
    const gridRows = screen.getAllByRole("row");
    expect(gridRows[gridRows.length - 1]).toHaveAttribute("aria-rowindex", "3");
  });

  it("downgrades to the loaded model count when sort authority is engine", () => {
    renderSurface({
      processing: { filter: "external", sort: "engine" },
      total: { kind: "exact", count: 5432 },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("downgrades to the loaded model count while grouping is active", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
      rowGroups: ["team"],
    });
    expect(screen.getByRole("treegrid")).toHaveAttribute("aria-rowcount", "5");
  });

  it("reports -1 for an estimate total", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "estimate", count: 5000 },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
  });

  it("reports -1 for an unknown total", () => {
    renderSurface({ processing: EXTERNAL, total: { kind: "unknown" } });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
  });

  it("downgrades when more records are loaded than the total claims", () => {
    renderSurface({ processing: EXTERNAL, total: { kind: "exact", count: 1 } });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("is unchanged in local mode", () => {
    renderSurface({});
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("never sets aria-busy, in any configuration", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
    });
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
  });

  it("forwards ariaDescribedBy to the grid element", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="People"
        ariaDescribedBy="notice-1"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
      />,
    );
    expect(screen.getByRole("grid")).toHaveAttribute(
      "aria-describedby",
      "notice-1",
    );
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/server-authority-aria.test.tsx`. Expect `expected element to have attribute aria-rowcount="5433", received "3"`.
- [ ] **Step 3: Create the rules module.** Create `packages/react/src/data-scope.ts`:

```ts
import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";

import { warnOnce } from "./dev-warn";

/** The snapshot fields these rules read. Structural so tests can pass literals. */
export interface DataHonestyInput {
  visibleRowCount: number;
  rowGroupCount: number;
  loadedRowCount: number;
  matchingTotal: PretableMatchingTotal;
}

/**
 * `aria-rowcount` per the design's honesty rules (§4.5).
 *
 * ARIA 1.2 defines the attribute as the total row count of the FULL table
 * including rows not in the DOM, with `-1` for unknown. A remote grid may only
 * publish the population count when every condition that makes loaded model
 * index `i` equal dataset position `i` holds. Any doubt downgrades to the
 * loaded-model count, which is the one number the grid can prove.
 */
export function resolveAriaRowCount(
  input: DataHonestyInput,
  processing: PretableProcessingOptions | undefined,
): number {
  const loadedModelCount = input.visibleRowCount + 1;

  // Anything short of full external authority means the engine reordered or
  // re-selected the loaded window locally, and global positions no longer hold.
  if (processing?.filter !== "external" || processing.sort !== "external") {
    return loadedModelCount;
  }

  // Grouping synthesizes header rows and hides the children of collapsed
  // branches: the contiguous mapping is gone.
  if (input.rowGroupCount > 0) {
    return loadedModelCount;
  }

  const total = input.matchingTotal;

  // An estimate cannot be spoken through an attribute whose contract is an
  // exact integer. `-1` is the spec's "unknown"; the number belongs in prose.
  if (total.kind !== "exact") {
    return -1;
  }

  // A detected violation of the contiguous-from-head contract: more records
  // loaded than the population claims. Downgrade rather than lie.
  if (total.count < input.loadedRowCount) {
    return loadedModelCount;
  }

  return total.count + 1;
}

/**
 * Whether the loaded records are the whole matching population (`"all"`) or a
 * window onto it (`"loaded"`). Every user-facing count label routes through
 * this, so a 200-of-10,432 window can never be described as "all rows". Local
 * mode is always `"all"`.
 */
export function resolveDataScope(
  input: Pick<DataHonestyInput, "loadedRowCount" | "matchingTotal">,
  processing: PretableProcessingOptions | undefined,
): "all" | "loaded" {
  if (processing?.filter !== "external") {
    return "all";
  }
  const total = input.matchingTotal;
  if (total.kind === "exact" && total.count <= input.loadedRowCount) {
    return "all";
  }
  return "loaded";
}

/**
 * Engine sort over a partial window is expressible — a complete-window consumer
 * legitimately uses it — but dishonest when the window really is partial: it
 * presents "top N of a server-selected sample" under a truthful-looking
 * `aria-sort`.
 */
export function warnOnEngineSortOverPartialWindow(
  input: DataHonestyInput,
  processing: PretableProcessingOptions | undefined,
): void {
  if (processing?.filter !== "external" || processing.sort === "external") {
    return;
  }
  const total = input.matchingTotal;
  if (total.kind !== "exact" || total.count <= input.loadedRowCount) {
    return;
  }
  warnOnce(
    "engine-sort-over-partial-window",
    "[pretable] sort authority is \"engine\" while only part of the matching " +
      "population is loaded. Sorting a server-selected window locally presents " +
      "the wrong SAMPLE, not just the wrong order. Set " +
      'processing: { sort: "external" } or load the whole result.',
  );
}
```

- [ ] **Step 4: Use it in the surface.** In `packages/react/src/pretable-surface.tsx`, add `import { resolveAriaRowCount, resolveDataScope, warnOnEngineSortOverPartialWindow } from "./data-scope";` next to the other local imports. Immediately after the `const isGrouped = snapshot.rowGroups.length > 0;` line (~973), insert:

```ts
  const dataHonestyInput = {
    visibleRowCount: snapshot.visibleRows.length,
    rowGroupCount: snapshot.rowGroups.length,
    loadedRowCount: snapshot.loadedRowCount,
    matchingTotal: snapshot.matchingTotal,
  };
  const ariaRowCount = resolveAriaRowCount(dataHonestyInput, processing);
  /** "all" or "loaded" — every count-bearing label reads this, never its own rule. */
  const dataScope = resolveDataScope(dataHonestyInput, processing);
  warnOnEngineSortOverPartialWindow(dataHonestyInput, processing);
```

Then replace `      aria-rowcount={snapshot.visibleRows.length + 1}` (~2214) with `      aria-rowcount={ariaRowCount}`.

- [ ] **Step 5: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/server-authority-aria.test.tsx`. Expect `Tests  10 passed (10)`.
- [ ] **Step 6: Confirm the ARIA pins still hold.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/local-mode-baseline.test.tsx src/__tests__/group-row-render.test.tsx src/__tests__/pretable-surface.test.tsx`. Expect all passing — especially "counts only currently visible filtered rows plus the header".
- [ ] **Step 7: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): honest aria-rowcount under external processing authority"`.

---

## Task 12: React — scoped select-all and copy labels

Three surfaces the review caught: the header checkbox's hardcoded `aria-label="Select all rows"`, the select-all announcement, and the copy announcement. A copy of 200-of-10,432 must not announce as an unscoped copy.

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx:241-320` (messages + defaults), `2356` (copy), `2554-2641` (header checkbox)
- Create: `packages/react/src/__tests__/scoped-labels.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `packages/react/src/__tests__/scoped-labels.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceMessages } from "../pretable-surface";

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
];

const columns = [{ id: "name", header: "Name", widthPx: 120 }];

function renderSurface(props: {
  external?: boolean;
  total?: number;
  messages?: PretableSurfaceMessages;
}) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
      messages={props.messages}
      processing={
        props.external ? { filter: "external", sort: "external" } : undefined
      }
      resultMeta={
        props.total === undefined
          ? undefined
          : { total: { kind: "exact", count: props.total } }
      }
    />,
  );
}

describe("scoped select-all labeling", () => {
  it('says "Select all rows" in local mode', () => {
    renderSurface({});
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });

  it('says "Select all loaded rows" when the window is partial', () => {
    renderSurface({ external: true, total: 5432 });
    expect(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    ).toBeInTheDocument();
  });

  it('says "Select all rows" when the window IS the whole population', () => {
    renderSurface({ external: true, total: 2 });
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });

  it("passes scope and counts to selectAllAnnouncement", () => {
    const seen: unknown[] = [];
    renderSurface({
      external: true,
      total: 5432,
      messages: {
        selectAllAnnouncement: (args) => {
          seen.push(args);
          return "ok";
        },
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      scope: "loaded",
      loadedCount: 2,
      total: 5432,
      isAll: true,
    });
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/scoped-labels.test.tsx`. Expect `Unable to find an accessible element with the role "checkbox" and name "Select all loaded rows"`.
- [ ] **Step 3: Add the message entries.** In `packages/react/src/pretable-surface.tsx`, inside `PretableSurfaceMessages`, replace the existing `selectAllAnnouncement` and `copyAnnouncement` declarations with:

```ts
  /**
   * `aria-label` for the header select-all checkbox. `scope: "loaded"` means
   * the checkbox targets a window onto a larger population.
   *
   * @experimental
   */
  selectAllLabel?: (args: { scope: "all" | "loaded" }) => string;
  selectAllAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    isAll: boolean;
    /** @experimental */
    scope: "all" | "loaded";
    /** @experimental */
    loadedCount: number;
    /** @experimental — exact matching total, when one is known. */
    total?: number;
  }) => string;
  copyAnnouncement?: (args: {
    rowCount: number;
    columnCount: number;
    /** @experimental — a copy of 200-of-10,432 is not an unscoped copy. */
    scope: "all" | "loaded";
  }) => string;
```

- [ ] **Step 4: Add the defaults.** In `defaultMessages`, replace the `selectAllAnnouncement` and `copyAnnouncement` entries with:

```ts
  selectAllLabel: ({ scope }) =>
    scope === "loaded" ? "Select all loaded rows" : "Select all rows",
  selectAllAnnouncement: ({ rowCount, columnCount, isAll, scope }) =>
    isAll
      ? scope === "loaded"
        ? `All ${rowCount} loaded rows selected`
        : "All rows selected"
      : `${rowCount} rows × ${columnCount} columns selected`,
  copyAnnouncement: ({ rowCount, columnCount, scope }) =>
    scope === "loaded"
      ? `${rowCount} loaded rows × ${columnCount} columns copied`
      : `${rowCount} rows × ${columnCount} columns copied`,
```

and add `      selectAllLabel: messages?.selectAllLabel ?? defaultMessages.selectAllLabel,` to the `effectiveMessages` memo (~868).

- [ ] **Step 5: Use them at the header checkbox.** In `packages/react/src/pretable-surface.tsx` (~2603), replace `                    aria-label="Select all rows"` with:

```tsx
                    aria-label={effectiveMessages.selectAllLabel({
                      scope: dataScope,
                    })}
```

and inside the same button's `onClick`, replace the `scheduleAnnouncement(...)` argument object with:

```tsx
                          effectiveMessages.selectAllAnnouncement({
                            rowCount: extent.rowCount,
                            columnCount: extent.columnCount,
                            isAll: extent.isAll,
                            scope: dataScope,
                            loadedCount: after.loadedRowCount,
                            total:
                              after.matchingTotal.kind === "exact"
                                ? after.matchingTotal.count
                                : undefined,
                          }),
```

- [ ] **Step 6: Scope the copy announcement.** At ~2356, add `                    scope: dataScope,` to the `effectiveMessages.copyAnnouncement({ ... })` argument object.
- [ ] **Step 7: Scope the Cmd/Ctrl+A announcement.** Find the other `selectAllAnnouncement` call (~2470, the keyboard select-all path) and add the same four extra keys — `scope`, `loadedCount`, `total` — reading from the post-mutation snapshot the same way.
- [ ] **Step 8: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/scoped-labels.test.tsx src/__tests__/local-mode-baseline.test.tsx`. Expect all passing.
- [ ] **Step 9: Run the surface suite.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/pretable-surface.test.tsx`. Expect all passing (the existing select-all and copy announcement tests use the English defaults, which are unchanged for `scope: "all"`).
- [ ] **Step 10: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): scope select-all and copy labels to the loaded window"`.

---

## Task 13: React — `groupChildCountLabel` and `formatAggregate` scope

Engine grouping over a partial window stays permitted but is *marked*: a sum over 200 loaded rows must never be presentable as a population sum (§9.4).

**Files:**
- Modify: `packages/grid-core/src/types.ts` (`PretableAggregateFormatInput`)
- Modify: `packages/react/src/rendering.ts:38-44`
- Modify: `packages/react/src/group-row.tsx:14-33,163,166`
- Modify: `packages/react/src/copy.ts:56-61,285`
- Modify: `packages/react/src/pretable-surface.tsx` (GroupRow render site, copy args)
- Test: `packages/react/src/__tests__/scoped-labels.test.tsx`

- [ ] **Step 1: Write the failing test.** Append to `packages/react/src/__tests__/scoped-labels.test.tsx`:

```tsx
describe("grouping honesty under a partial window", () => {
  type GRow = { id: string; team: string; points: number };

  const gRows: GRow[] = [
    { id: "a", team: "Red", points: 3 },
    { id: "b", team: "Red", points: 4 },
  ];

  const gColumns = [
    { id: "team", header: "Team", widthPx: 120 },
    {
      id: "points",
      header: "Points",
      widthPx: 120,
      type: "number" as const,
      aggregate: "sum" as const,
      formatAggregate: (input: { value: unknown; scope: "all" | "loaded" }) =>
        `${String(input.value)} [${input.scope}]`,
    },
  ];

  function renderGrouped(external: boolean, total?: number) {
    return render(
      <PretableSurface<GRow>
        ariaLabel="Teams"
        columns={gColumns}
        rows={gRows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        state={{ rowGroups: ["team"] }}
        processing={
          external ? { filter: "external", sort: "external" } : undefined
        }
        resultMeta={
          total === undefined
            ? undefined
            : { total: { kind: "exact", count: total } }
        }
      />,
    );
  }

  it("renders the bare child count in local mode", () => {
    const view = renderGrouped(false);
    expect(
      view.container.querySelector("[data-pretable-group-count]")?.textContent,
    ).toBe("(2)");
  });

  it('marks the child count "loaded" under a partial window', () => {
    const view = renderGrouped(true, 5432);
    expect(
      view.container.querySelector("[data-pretable-group-count]")?.textContent,
    ).toBe("(2 loaded)");
  });

  it("passes scope to formatAggregate", () => {
    const view = renderGrouped(true, 5432);
    expect(view.container.textContent).toContain("7 [loaded]");
  });

  it("passes scope all in local mode", () => {
    const view = renderGrouped(false);
    expect(view.container.textContent).toContain("7 [all]");
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/scoped-labels.test.tsx -t "passes scope to formatAggregate"`. Expect `expected '…7…' to contain '7 [loaded]'`.
- [ ] **Step 3: Widen the aggregate format input.** In `packages/grid-core/src/types.ts`, inside `PretableAggregateFormatInput`, immediately after `  group: PretableGroupRow;`, insert:

```ts
  /**
   * `"loaded"` when the aggregate folded a window onto a larger population, so
   * a sum over 200 loaded rows is never presentable as a population sum. Local
   * mode always passes `"all"`.
   *
   * @experimental
   */
  scope: "all" | "loaded";
```

- [ ] **Step 4: Require scope at the formatter.** In `packages/react/src/rendering.ts`, replace `formatAggregateValue` with:

```ts
export function formatAggregateValue<TRow extends PretableRow>(
  column: PretableColumn<TRow>,
  group: PretableGroupRow,
  scope: "all" | "loaded",
): string {
  const value = group.aggregates[column.id];
  return column.formatAggregate
    ? column.formatAggregate({ value, column, group, scope })
    : formatCellValue(value);
}
```

- [ ] **Step 5: Add the message entry and default.** In `packages/react/src/pretable-surface.tsx`, inside `PretableSurfaceMessages` (after `groupCollapsedAnnouncement`), insert:

```ts
  /**
   * Group-header child count. `scope: "loaded"` marks partial-window grouping —
   * a count of loaded children that makes no claim about the population.
   *
   * @experimental
   */
  groupChildCountLabel?: (args: {
    childCount: number;
    scope: "all" | "loaded";
  }) => string;
```

and in `defaultMessages`:

```ts
  groupChildCountLabel: ({ childCount, scope }) =>
    scope === "loaded" ? `(${childCount} loaded)` : `(${childCount})`,
```

(The parentheses live in the message, not the JSX, so local-mode DOM stays byte-identical to today's `({group.childCount})`.) Add the `effectiveMessages` entry the same way as `selectAllLabel`.

- [ ] **Step 6: Thread scope into `GroupRow`.** In `packages/react/src/group-row.tsx`, add to `GroupRowProps`:

```ts
  /** Renders the child count; supplied by the surface from `messages`. */
  childCountLabel: (childCount: number) => string;
  /** `"loaded"` when the folded rows are a window onto a larger population. */
  scope: "all" | "loaded";
```

destructure both in the component signature, replace `                <span data-pretable-group-count="">({group.childCount})</span>` with:

```tsx
                <span data-pretable-group-count="">
                  {childCountLabel(group.childCount)}
                </span>
```

and replace `              formatAggregateValue(column, group)` with `              formatAggregateValue(column, group, scope)`.

- [ ] **Step 7: Supply them from the surface.** In `packages/react/src/pretable-surface.tsx`, near the `dataScope` const, add:

```ts
  const groupChildCountLabel = useCallback(
    (childCount: number) =>
      effectiveMessages.groupChildCountLabel({ childCount, scope: dataScope }),
    [dataScope, effectiveMessages],
  );
```

and add `                childCountLabel={groupChildCountLabel}` + `                scope={dataScope}` to the `<GroupRow ... />` element.

- [ ] **Step 8: Scope the copy path.** In `packages/react/src/copy.ts`, add to `SerializeRangesArgs`:

```ts
  /**
   * Aggregate scope for copied group rows. Defaults to `"all"` so a manual
   * caller that does not know about partial windows cannot accidentally
   * mislabel a full local copy.
   *
   * @experimental
   */
  scope?: "all" | "loaded";
```

replace `            text = formatAggregateValue(col, row);` with `            text = formatAggregateValue(col, row, args.scope ?? "all");`, and in `pretable-surface.tsx` add `            scope: dataScope,` to the `SerializeRangesArgs` literal (~2340).

- [ ] **Step 9: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/scoped-labels.test.tsx src/__tests__/group-row-render.test.tsx src/__tests__/copy.test.ts`. Expect all passing. `copy.test.ts` will fail to typecheck if any `formatAggregateValue` call there is missing the new argument — add `"all"`.
- [ ] **Step 10: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): mark group counts and aggregates as loaded-scope"`.

---

## Task 14: React — `PretableDataState`, body-state blocks, `renderBodyState`

**`dataState` has no default.** With the prop absent the entire lifecycle presentation is off: no blocks, no phase attribute, no announcements. That is what keeps `rows={[]}` rendering nothing for existing local consumers (D1-GRID-04) and stops a remote consumer flashing "No results" before its first fetch.

**Files:**
- Create: `packages/react/src/data-state.ts`
- Modify: `packages/react/src/pretable-surface.tsx` (props, messages, scrollViewport attrs ~2211, the two return statements ~3770–3810)
- Modify: `packages/ui/src/grid.css`
- Modify: `packages/react/src/public_api.ts`
- Create: `packages/react/src/__tests__/data-state-surface.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `packages/react/src/__tests__/data-state-surface.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableDataState } from "../data-state";

afterEach(cleanup);

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const oneRow: Row[] = [{ id: "a", name: "Ada" }];

function renderSurface(rows: Row[], dataState?: PretableDataState) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      dataState={dataState}
      processing={{ filter: "external", sort: "external" }}
    />,
  );
}

function block(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector("[data-pretable-body-state]");
}

describe("body-state rendering", () => {
  it("renders nothing extra when dataState is absent", () => {
    const view = renderSurface([]);
    expect(block(view)).toBeNull();
    expect(screen.getByRole("grid")).not.toHaveAttribute(
      "data-pretable-data-phase",
    );
  });

  it("loading with nothing loaded shows the loading block", () => {
    const view = renderSurface([], { phase: "loading" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "loading");
    expect(block(view)).toHaveTextContent("Loading…");
  });

  it("idle with nothing loaded shows the empty block", () => {
    const view = renderSurface([], { phase: "idle" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
    expect(block(view)).toHaveTextContent("No results");
  });

  it("stale with nothing loaded shows loading, not 'no results'", () => {
    const view = renderSurface([], { phase: "stale" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "loading");
  });

  it("refreshing with nothing loaded keeps the empty block", () => {
    const view = renderSurface([], { phase: "refreshing" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "empty");
  });

  it("error with nothing loaded shows the error block", () => {
    const view = renderSurface([], { phase: "error", message: "boom" });
    expect(block(view)).toHaveAttribute("data-pretable-body-state", "error");
    expect(block(view)).toHaveTextContent("boom");
  });

  it("error with rows keeps the rows and shows a status strip", () => {
    const view = renderSurface(oneRow, { phase: "error", message: "boom" });
    expect(block(view)).toHaveAttribute(
      "data-pretable-body-state",
      "error-strip",
    );
    expect(block(view)).toHaveAttribute("role", "status");
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("stale with rows renders no block, only the phase attribute", () => {
    const view = renderSurface(oneRow, { phase: "stale" });
    expect(block(view)).toBeNull();
    expect(screen.getByRole("grid")).toHaveAttribute(
      "data-pretable-data-phase",
      "stale",
    );
  });

  it("renderBodyState replaces the built-in block", () => {
    const view = render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        viewportHeight={400}
        dataState={{ phase: "idle" }}
        renderBodyState={(input) => (
          <span data-testid="custom">
            {input.phase}:{input.loadedRowCount}
          </span>
        )}
      />,
    );
    expect(view.getByTestId("custom")).toHaveTextContent("idle:0");
    expect(block(view)).not.toHaveTextContent("No results");
  });

  it("never sets aria-busy in any phase", () => {
    for (const phase of [
      "idle",
      "loading",
      "stale",
      "refreshing",
      "loading-more",
    ] as const) {
      cleanup();
      renderSurface(oneRow, { phase });
      expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
    }
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/data-state-surface.test.tsx`. Expect `Failed to resolve import "../data-state"`.
- [ ] **Step 3: Create the data-state module.** Create `packages/react/src/data-state.ts`:

```ts
/**
 * Presentation lifecycle of the loaded records. Consumer-owned and
 * consumer-asserted; the surface renders it and never infers it.
 *
 * **No default.** When the prop is absent the entire lifecycle presentation is
 * off — no body blocks, no phase announcements, no data-phase attribute — so
 * local consumers see zero change. Remote consumers must supply it from their
 * first render, starting at `{ phase: "loading" }`.
 *
 * @experimental
 * @public
 */
export type PretableDataState =
  /** The loaded records answer the desired query. */
  | { phase: "idle" }
  /** Nothing usable is loaded for the desired query. */
  | { phase: "loading" }
  /** The records answer a PREVIOUS query; the desired one is in flight. */
  | { phase: "stale" }
  /** Same query, a newer fulfillment in flight (polling). */
  | { phase: "refreshing" }
  /** A tail extension is in flight. */
  | { phase: "loading-more" }
  | { phase: "error"; message?: string };

/** Which body block the surface owes, or `null` when the rows are the answer. */
export type PretableBodyStateKind = "loading" | "empty" | "error" | "error-strip";

/**
 * §4.4's table, as a function. Called only when `dataState` was supplied.
 *
 * The two non-obvious rows are deliberate: `stale` with nothing loaded shows
 * loading, because an old-empty result with a NEW query in flight is not "no
 * results"; and `refreshing` with nothing loaded keeps the empty block, because
 * a 2 s poll over an empty result must not flicker empty → loading → empty.
 */
export function resolveBodyStateKind(
  phase: PretableDataState["phase"],
  loadedRowCount: number,
): PretableBodyStateKind | null {
  if (phase === "error") {
    // Never discard fulfilled records for a failure: rows stay visible and
    // interactive, and the failure gets a strip at the top of the viewport.
    return loadedRowCount === 0 ? "error" : "error-strip";
  }

  if (loadedRowCount > 0) {
    return null;
  }

  switch (phase) {
    case "loading":
    case "stale":
      return "loading";
    case "idle":
    case "refreshing":
      return "empty";
    case "loading-more":
      // A tail extension with nothing loaded is not a state the design defines.
      // Rendering nothing beats guessing at a block.
      return null;
  }
}
```

- [ ] **Step 4: Add the props and messages.** In `packages/react/src/pretable-surface.tsx`:

(a) `import { resolveBodyStateKind, type PretableDataState } from "./data-state";`

(b) In `PretableSurfaceProps`, after `ariaDescribedBy`:

```ts
  /**
   * Presentation lifecycle of the loaded records. No default — omit it and the
   * lifecycle presentation is entirely off.
   *
   * @experimental
   */
  dataState?: PretableDataState;
  /**
   * Override the built-in body-state blocks (loading / empty / error, and the
   * error strip that renders above intact rows). Return value replaces the
   * built-in content; the wrapper element and its data attribute stay.
   *
   * @experimental
   */
  renderBodyState?: (input: {
    phase: PretableDataState["phase"];
    errorMessage?: string;
    loadedRowCount: number;
    matchingTotal: PretableMatchingTotal;
  }) => ReactNode;
```

(c) In `PretableSurfaceMessages`:

```ts
  /** Body copy for the empty block. Filtered vs unfiltered wording is the consumer's call. @experimental */
  emptyStateMessage?: () => string;
  /** Body copy for the loading block. @experimental */
  loadingStateMessage?: () => string;
  /** Announced — and rendered as the error block's copy — when Pretable owns the failure UI. @experimental */
  dataErrorAnnouncement?: (args: { message?: string }) => string;
```

(d) In `defaultMessages`:

```ts
  emptyStateMessage: () => "No results",
  loadingStateMessage: () => "Loading…",
  dataErrorAnnouncement: ({ message }) =>
    message ? `Could not load results. ${message}` : "Could not load results",
```

(e) Add all three to the `effectiveMessages` memo.

- [ ] **Step 5: Compute and build the block.** In `pretable-surface.tsx`, immediately after the `dataScope` const, insert:

```ts
  const bodyStateKind =
    dataState === undefined
      ? null
      : resolveBodyStateKind(dataState.phase, snapshot.loadedRowCount);

  const errorMessage =
    dataState !== undefined && dataState.phase === "error"
      ? dataState.message
      : undefined;

  const bodyStateBlock =
    dataState === undefined || bodyStateKind === null ? null : (
      <div
        data-pretable-body-state={bodyStateKind}
        // A status role only where the block appears alongside live content;
        // a full-viewport block is the content, not a status about it.
        role={bodyStateKind === "error-strip" ? "status" : undefined}
      >
        {renderBodyState
          ? renderBodyState({
              phase: dataState.phase,
              errorMessage,
              loadedRowCount: snapshot.loadedRowCount,
              matchingTotal: snapshot.matchingTotal,
            })
          : bodyStateKind === "loading"
            ? effectiveMessages.loadingStateMessage()
            : bodyStateKind === "empty"
              ? effectiveMessages.emptyStateMessage()
              : effectiveMessages.dataErrorAnnouncement({
                  message: errorMessage,
                })}
      </div>
    );
```

- [ ] **Step 6: Add the phase attribute.** In the `scrollViewport` JSX, immediately after `      data-pretable-hydrated={...}`, insert `      data-pretable-data-phase={dataState?.phase}`. React omits the attribute entirely when the value is `undefined`, which is exactly the no-`dataState` contract.
- [ ] **Step 7: Wrap only when the prop is supplied.** Immediately above `  if (!groupPanelEnabled) {`, insert:

```tsx
  // The block cannot live inside the viewport: that element carries
  // role="grid"/"treegrid", whose children must be rows and rowgroups. It gets
  // a wrapper — created ONLY when `dataState` is supplied, so a local
  // consumer's DOM, CSS selectors and layout are byte-identical to before this
  // prop existed.
  const withBodyState = (content: ReactNode): ReactNode =>
    dataState === undefined ? (
      content
    ) : (
      <div data-pretable-data-state-wrapper="">
        {bodyStateKind === "error-strip" ? bodyStateBlock : null}
        {content}
        {bodyStateKind !== null && bodyStateKind !== "error-strip"
          ? bodyStateBlock
          : null}
      </div>
    );
```

Then change the no-panel return's `{scrollViewport}` to `{withBodyState(scrollViewport)}`, and in the panel return wrap the whole `<div data-pretable-group-panel-wrapper="" …>…</div>` element in `withBodyState( … )`.

- [ ] **Step 8: Style the blocks (vanilla CSS).** In `packages/ui/src/grid.css`, immediately before the closing `}` of `@layer pretable`, add:

```css
  /* Data-lifecycle body states. Austere by design: no spinner opinion and no
     animation — a consumer who wants one supplies `renderBodyState`. */
  :where([data-pretable-data-state-wrapper]) {
    display: flex;
    flex-direction: column;
  }

  :where([data-pretable-body-state]) {
    box-sizing: border-box;
    padding: calc(var(--pretable-cell-padding-y) * 4)
      var(--pretable-cell-padding-x);
    background: var(--pretable-bg-grid);
    color: var(--pretable-text-dim);
    font-family: var(--pretable-font-sans);
    font-size: var(--pretable-font-size-cell);
    text-align: center;
  }

  /* Failures read left-aligned like prose, and in the theme's error color. */
  :where([data-pretable-body-state="error"]),
  :where([data-pretable-body-state="error-strip"]) {
    color: var(--pretable-text-error);
    text-align: start;
  }

  /* The strip sits above intact rows, so it needs the seam the viewport's own
     top border would otherwise draw twice. */
  :where([data-pretable-body-state="error-strip"]) {
    border: 1px solid var(--pretable-rule-strong);
    border-bottom: 0;
    border-radius: var(--pretable-radius) var(--pretable-radius) 0 0;
  }
```

- [ ] **Step 9: Export the type.** In `packages/react/src/public_api.ts`, add `export type { PretableDataState } from "./data-state";` in the "Component prop / message / config types" block.
- [ ] **Step 10: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/data-state-surface.test.tsx src/__tests__/local-mode-baseline.test.tsx`. Expect all passing.
- [ ] **Step 11: Run the full React suite.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom`. Expect all green; re-run any single timeout alone before believing it.
- [ ] **Step 12: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): consumer-asserted dataState with body-state blocks"`.

---

## Task 15: React — lifecycle announcements

One channel per event, never double-spoken, all through the existing 500 ms trailing-edge last-wins scheduler. A 2 s poll resolving `refreshing → idle` is **silent** — a metronome in a live region is worse than no announcement at all.

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (messages, one new effect)
- Create: `packages/react/src/__tests__/lifecycle-announcements.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `packages/react/src/__tests__/lifecycle-announcements.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableDataState } from "../data-state";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const page1: Row[] = [{ id: "a", name: "Ada" }];
const page2: Row[] = [...page1, { id: "b", name: "Bob" }];

function Harness({
  rows,
  dataState,
  total,
}: {
  rows: Row[];
  dataState: PretableDataState;
  total: number;
}) {
  return (
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: total } }}
      dataState={dataState}
    />
  );
}

/** The live region is portaled to document.body and settles after 500 ms. */
function liveText(): string {
  act(() => {
    vi.advanceTimersByTime(600);
  });
  return (
    document.body.querySelector("[data-pretable-live-region]")?.textContent ?? ""
  );
}

describe("lifecycle announcements", () => {
  it("announces the honest count on loading → idle", () => {
    const view = render(
      <Harness rows={[]} dataState={{ phase: "loading" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    expect(liveText()).toBe("Showing 1 of 4120");
  });

  it("announces the delta on loading-more → idle", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "loading-more" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page2} dataState={{ phase: "idle" }} total={4120} />,
    );
    expect(liveText()).toBe("Loaded 1 more. 2 of 4120 loaded.");
  });

  it("is silent when a refresh resolves", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "refreshing" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    expect(liveText()).toBe("");
  });

  it("announces an error", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "error", message: "network down" }}
        total={4120}
      />,
    );
    expect(liveText()).toBe("Could not load results. network down");
  });

  it("announces once when the query moves ahead of the rows", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "stale" }} total={4120} />,
    );
    expect(liveText()).toBe("Updating results…");
  });

  it("says nothing on the first render", () => {
    render(<Harness rows={[]} dataState={{ phase: "loading" }} total={0} />);
    expect(liveText()).toBe("");
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/lifecycle-announcements.test.tsx`. Expect `expected '' to be 'Showing 1 of 4120'`.
- [ ] **Step 3: Add the message entry and default.** In `PretableSurfaceMessages`:

```ts
  /**
   * Announced when loading / stale / loading-more resolves to idle — the honest
   * count moment, and the filter-result announcement Pretable never had.
   * `added` is present only for a tail extension.
   *
   * @experimental
   */
  resultsAnnouncement?: (args: {
    loaded: number;
    total: PretableMatchingTotal;
    added?: number;
  }) => string;

  /**
   * Announced on entering `stale`. This is the ONLY assistive-technology
   * signal that the visible rows answer the previous query — the
   * `data-pretable-data-phase` attribute and any consumer dimming are visual
   * only, so without this a screen-reader user cannot tell that the controls
   * and the rows disagree (design §4.5, D1-UX-02).
   *
   * @experimental
   */
  staleAnnouncement?: () => string;
```

In `defaultMessages` (plain integers, no `toLocaleString` — the defaults must not vary with the runtime locale):

```ts
  resultsAnnouncement: ({ loaded, total, added }) => {
    const population =
      total.kind === "exact"
        ? `${loaded} of ${total.count}`
        : total.kind === "estimate"
          ? `${loaded} of about ${total.count}`
          : total.atLeast !== undefined
            ? `${loaded} of more than ${total.atLeast}`
            : `${loaded}`;
    return added === undefined
      ? `Showing ${population}`
      : `Loaded ${added} more. ${population} loaded.`;
  },
  staleAnnouncement: () => "Updating results…",
```

Add it to `effectiveMessages`.

- [ ] **Step 4: Add the transition effect.** In `pretable-surface.tsx`, after the `scheduleAnnouncement` definition and after the `usePretable` call, insert:

```tsx
  // Phase transitions, one announcement each. Deliberately keyed on the phase
  // VALUE, not on `dataState` identity: an inline `dataState={{phase:"idle"}}`
  // literal is a new object every render and must not re-announce.
  const previousPhaseRef = useRef<PretableDataState["phase"] | undefined>(
    undefined,
  );
  const loadedBeforeLoadMoreRef = useRef(0);

  useEffect(() => {
    const phase = dataState?.phase;
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;

    if (phase === undefined || phase === previousPhase) {
      return;
    }

    if (phase === "loading-more") {
      // Remember the baseline so the resolution can report the delta.
      loadedBeforeLoadMoreRef.current = snapshot.loadedRowCount;
      return;
    }

    if (phase === "stale") {
      // The desired query has moved ahead of the fulfilled rows. Announced
      // once on entry (the phase-value guard above makes repeats impossible
      // within a settling burst); the resolution's resultsAnnouncement
      // supersedes it through the last-wins scheduler.
      scheduleAnnouncement(effectiveMessages.staleAnnouncement());
      return;
    }

    if (phase === "error") {
      // Structural single-channel rule: Pretable announces the failure only
      // because Pretable is the one rendering it (error block or status strip).
      // A consumer showing its own role="alert" banner keeps the phase out of
      // "error", so double-speak is impossible by construction.
      scheduleAnnouncement(
        effectiveMessages.dataErrorAnnouncement({ message: errorMessage }),
      );
      return;
    }

    if (phase !== "idle") {
      return;
    }

    // A 2 s poll must not produce a metronome, and the very first commit is not
    // a transition anyone asked to hear about.
    if (previousPhase === undefined || previousPhase === "refreshing") {
      return;
    }

    scheduleAnnouncement(
      effectiveMessages.resultsAnnouncement({
        loaded: snapshot.loadedRowCount,
        total: snapshot.matchingTotal,
        added:
          previousPhase === "loading-more"
            ? snapshot.loadedRowCount - loadedBeforeLoadMoreRef.current
            : undefined,
      }),
    );
  }, [
    dataState,
    effectiveMessages,
    errorMessage,
    scheduleAnnouncement,
    snapshot.loadedRowCount,
    snapshot.matchingTotal,
  ]);
```

- [ ] **Step 5: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/lifecycle-announcements.test.tsx`. Expect `Tests  6 passed (6)`. If the live-region text is empty because the region is gated on hydration, check how `pretable-surface.test.tsx` reaches `[data-pretable-live-region]` and copy that approach — the portal only mounts after `useHydrated` flips.
- [ ] **Step 6: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): announce result counts and data errors on phase transitions"`.

---

## Task 16: React — the DK-change focus rule and `focusedRowRemovedAnnouncement`

Two consequences of a data-driven rows replacement, handled in one effect because their conditions are mutually exclusive: a **dataset pivot** (deterministic focus, never `<body>`; scroll to top; no focus announcement — the results announcement covers it), and a **same-dataset repair** (the engine moved focus to a survivor; say so).

The effect must be declared **after** the `usePretable` call so it runs after that hook's own `setRows` layout effect in the same commit. `grid.getSnapshot()` inside it is post-replacement, while the DOM has not yet re-rendered — which is exactly why `document.activeElement` still reports where the user was.

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx`
- Test: `packages/react/src/__tests__/lifecycle-announcements.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append to `packages/react/src/__tests__/lifecycle-announcements.test.tsx`:

```tsx
describe("data-driven focus reconciliation", () => {
  function FocusHarness({
    rows,
    datasetKey,
  }: {
    rows: Row[];
    datasetKey: string;
  }) {
    return (
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external", sort: "external" }}
        resultMeta={{ datasetKey, total: { kind: "exact", count: rows.length } }}
        state={{ focus: undefined }}
      />
    );
  }

  it("announces a repaired focus when the focused row leaves the results", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    const cell = view.container.querySelector('[data-pretable-row-id="b"]')!
      .firstElementChild as HTMLElement;
    act(() => {
      cell.focus();
      cell.click();
    });
    view.rerender(<FocusHarness rows={page1} datasetKey="q1" />);
    expect(liveText()).toBe(
      "Focused row is no longer in the results; moved to a nearby row.",
    );
  });

  it("moves focus to the first cell of a new dataset and does not announce a repair", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    const cell = view.container.querySelector('[data-pretable-row-id="b"]')!
      .firstElementChild as HTMLElement;
    act(() => {
      cell.focus();
      cell.click();
    });
    view.rerender(<FocusHarness rows={page2} datasetKey="q2" />);
    expect(liveText()).not.toContain("no longer in the results");
    expect(
      view.container.querySelector('[data-pretable-row-id="a"]')
        ?.firstElementChild,
    ).toHaveAttribute("tabindex", "0");
  });
});
```

If the focused-cell selector or the `tabindex` assertion does not match the surface's actual roving-tabindex markup, read `pretable-surface.test.tsx`'s focus tests and mirror whatever they assert on — do not invent attributes.

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/lifecycle-announcements.test.tsx -t "announces a repaired focus"`. Expect `expected '' to be 'Focused row is no longer…'`.
- [ ] **Step 3: Add the two message entries.** In `PretableSurfaceMessages`:

```ts
  /**
   * Announced only when focus reconciliation's id lookup misses during a
   * data-driven rows replacement — never for a user action, and never for a
   * dataset change (the results announcement covers that transition).
   *
   * @experimental
   */
  focusedRowRemovedAnnouncement?: () => string;
```

In `defaultMessages`:

```ts
  focusedRowRemovedAnnouncement: () =>
    "Focused row is no longer in the results; moved to a nearby row.",
```

Add it to `effectiveMessages`.

- [ ] **Step 4: Add the reconciliation effect.** In `pretable-surface.tsx`, immediately after the phase-transition effect from Task 15, insert:

```tsx
  // Declared AFTER `usePretable` on purpose: layout effects run in declaration
  // order within a component, so this fires after the hook's own `setRows`
  // effect in the same commit. `grid.getSnapshot()` is therefore
  // post-replacement while the DOM still shows the old rows — which is what
  // makes the `document.activeElement` read below meaningful.
  const focusRowIdBeforeRowsRef = useRef<string | null>(null);
  const datasetKeyBeforeRowsRef = useRef<string | null>(null);
  const rowsSeenRef = useRef(rows);

  useLayoutEffect(() => {
    const after = grid.getSnapshot();

    if (rowsSeenRef.current === rows) {
      focusRowIdBeforeRowsRef.current = after.focus.rowId;
      datasetKeyBeforeRowsRef.current = after.datasetKey;
      return;
    }

    const focusWasInsideGrid =
      typeof document !== "undefined" &&
      viewportRef.current !== null &&
      document.activeElement !== null &&
      viewportRef.current.contains(document.activeElement);

    const previousFocusRowId = focusRowIdBeforeRowsRef.current;
    const previousDatasetKey = datasetKeyBeforeRowsRef.current;
    rowsSeenRef.current = rows;
    datasetKeyBeforeRowsRef.current = after.datasetKey;

    const datasetPivoted =
      previousDatasetKey !== null && after.datasetKey !== previousDatasetKey;

    if (datasetPivoted) {
      // The engine already cleared focus. Put it somewhere deterministic rather
      // than letting DOM focus fall to <body> — but only if the user was
      // actually inside the grid; nothing gets grabbed otherwise.
      if (focusWasInsideGrid) {
        const firstDataRow = after.visibleRows.find(isDataRow);
        const firstColumn = columnsInVisualOrder.find(
          (column) => column.id !== ROW_SELECT_COLUMN_ID,
        );
        if (firstDataRow && firstColumn) {
          grid.setFocus({ rowId: firstDataRow.id, columnId: firstColumn.id });
        } else {
          viewportRef.current?.focus();
        }
      }

      // A different question: the old scroll offset means nothing against the
      // new answer.
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
      }
      grid.setViewport({ ...after.viewport, scrollTop: 0 });

      focusRowIdBeforeRowsRef.current = grid.getSnapshot().focus.rowId;
      return;
    }

    focusRowIdBeforeRowsRef.current = after.focus.rowId;

    if (previousFocusRowId !== null && after.focus.rowId !== previousFocusRowId) {
      scheduleAnnouncement(effectiveMessages.focusedRowRemovedAnnouncement());
    }
  });
```

The effect has no dependency array on purpose: it must sample state after *every* commit, matching the existing height-measurement effect at ~2140.

- [ ] **Step 5: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/lifecycle-announcements.test.tsx`. Expect `Tests  7 passed (7)`.
- [ ] **Step 6: Confirm streaming preservation is intact.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/use-pretable-streaming.test.tsx src/__tests__/pretable-surface.test.tsx`. Expect all passing — a same-key streaming replacement must not fire the announcement.
- [ ] **Step 7: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): deterministic focus and announcement on data-driven row replacement"`.

---

## Task 17: React — `moreRowsBoundaryAnnouncement` and the enum distinct-values warning

Navigation refused at the last loaded row while more matching rows exist is otherwise a silent dead end for a keyboard user. Announce it once per boundary arrival.

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (messages, `SurfaceKeyDownContext` ~4319, arrow-key branch ~4419, ctx construction, FilterMenu options callback ~3700)
- Test: `packages/react/src/__tests__/lifecycle-announcements.test.tsx`

- [ ] **Step 1: Write the failing test.** Append to `packages/react/src/__tests__/lifecycle-announcements.test.tsx`:

```tsx
describe("loaded-boundary announcement", () => {
  it("announces once when ArrowDown is refused at the last loaded row", () => {
    const view = render(
      <Harness rows={page2} dataState={{ phase: "idle" }} total={5432} />,
    );
    const lastCell = view.container.querySelector('[data-pretable-row-id="b"]')!
      .firstElementChild as HTMLElement;
    act(() => {
      lastCell.focus();
      lastCell.click();
    });
    act(() => {
      fireEvent.keyDown(lastCell, { key: "ArrowDown" });
    });
    expect(liveText()).toBe("End of loaded rows. 5430 more available.");
  });

  it("says nothing at the boundary when everything is loaded", () => {
    const view = render(
      <Harness rows={page2} dataState={{ phase: "idle" }} total={2} />,
    );
    const lastCell = view.container.querySelector('[data-pretable-row-id="b"]')!
      .firstElementChild as HTMLElement;
    act(() => {
      lastCell.focus();
      lastCell.click();
    });
    act(() => {
      fireEvent.keyDown(lastCell, { key: "ArrowDown" });
    });
    expect(liveText()).toBe("");
  });
});
```

Add `fireEvent` to the `@testing-library/react` import.

- [ ] **Step 2: Run and see it fail.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/lifecycle-announcements.test.tsx -t "announces once when ArrowDown"`. Expect `expected '' to be 'End of loaded rows. 5430 more available.'`.
- [ ] **Step 3: Add the message entry and default.** In `PretableSurfaceMessages`:

```ts
  /**
   * Announced when navigation is refused at the last loaded row while more
   * matching rows exist. Once per boundary arrival, not once per keypress.
   *
   * @experimental
   */
  moreRowsBoundaryAnnouncement?: (args: {
    loadedCount: number;
    total?: number;
  }) => string;
```

In `defaultMessages`:

```ts
  moreRowsBoundaryAnnouncement: ({ loadedCount, total }) =>
    total === undefined
      ? `End of loaded rows. ${loadedCount} loaded.`
      : `End of loaded rows. ${total - loadedCount} more available.`,
```

Add it to `effectiveMessages`.

- [ ] **Step 4: Add the hook to the keydown context.** In `SurfaceKeyDownContext`, add:

```ts
  /** Called when a downward move was refused at the last row of the model. */
  onLoadedBoundaryReached?: () => void;
```

destructure it in `handleSurfaceKeyDown`, and inside the `if (direction) {` branch, immediately after `    grid.moveFocus(direction, { extend: shift, jumpToEdge: cmd });`, insert:

```ts
    // A refused downward move at the end of the model is the load-more
    // boundary. Detecting it here rather than in the engine keeps the engine
    // ignorant of what "more" means.
    if (
      direction === "down" &&
      onLoadedBoundaryReached &&
      focus.rowId !== null &&
      grid.getSnapshot().focus.rowId === focus.rowId &&
      rows[rows.length - 1]?.id === focus.rowId
    ) {
      onLoadedBoundaryReached();
    }
```

- [ ] **Step 5: Supply the callback.** In the component, near the other refs, add `  const boundaryAnnouncedForRowIdRef = useRef<string | null>(null);` and:

```tsx
  // Reset when focus leaves the boundary row, so a second arrival announces
  // again while sitting there does not.
  useEffect(() => {
    if (snapshot.focus.rowId !== boundaryAnnouncedForRowIdRef.current) {
      boundaryAnnouncedForRowIdRef.current = null;
    }
  }, [snapshot.focus.rowId]);

  const announceLoadedBoundary = useCallback(() => {
    const snap = grid.getSnapshot();
    const total = snap.matchingTotal;
    if (!(total.kind === "exact" && total.count > snap.loadedRowCount)) {
      return;
    }
    if (boundaryAnnouncedForRowIdRef.current === snap.focus.rowId) {
      return;
    }
    boundaryAnnouncedForRowIdRef.current = snap.focus.rowId;
    scheduleAnnouncement(
      effectiveMessages.moreRowsBoundaryAnnouncement({
        loadedCount: snap.loadedRowCount,
        total: total.count,
      }),
    );
  }, [effectiveMessages, grid, scheduleAnnouncement]);
```

Then add `      onLoadedBoundaryReached: announceLoadedBoundary,` to the object passed to `handleSurfaceKeyDown`.

- [ ] **Step 6: Warn on the enum distinct-values fallback.** At the `FilterMenu` render site (~3700), replace

```tsx
            const options = resolveColumnOptions(col, () =>
              grid.distinctColumnValues(filterOpenState.columnId),
            );
```

with

```tsx
            const options = resolveColumnOptions(col, () => {
              // Reaching the fallback under external filter authority means the
              // funnel is about to offer the distinct values of the LOADED
              // window as an `isAnyOf` universe — an incomplete one, silently.
              if (processing?.filter === "external") {
                warnOnce(
                  `distinct-values-fallback:${col.id}`,
                  `[pretable] Column "${col.id}" has no \`options\` and filtering is ` +
                    "external, so the funnel is offering the distinct values of the " +
                    "loaded window. That is an incomplete universe for isAnyOf. " +
                    "Declare `column.options`.",
                );
              }
              return grid.distinctColumnValues(filterOpenState.columnId);
            });
```

and add `import { warnOnce } from "./dev-warn";` to the surface's imports.

- [ ] **Step 7: Run and see it pass.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/lifecycle-announcements.test.tsx`. Expect `Tests  9 passed (9)`.
- [ ] **Step 8: Run the full React suite.** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom`. Expect all green.
- [ ] **Step 9: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "feat(react): announce the loaded-rows boundary and warn on incomplete enum facets"`.

---

## Task 18: `@experimental` sweep, API reports, changeset, full verification

Every new symbol ships `@experimental` (house precedent: the `state` prop). Promotion to stable happens after Inspector dogfooding, not here.

**Files:**
- Modify: any new symbol still missing the tag
- Modify: `packages/core/core.api.md`, `packages/react/react.api.md`
- Create: `.changeset/server-authority-primitives.md`

- [ ] **Step 1: Audit the tags.** Run `cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && grep -rn "PretableProcessingAuthority\|PretableProcessingOptions\|PretableMatchingTotal\|PretableResultMeta\|PretableDataState\|filterOperators\|renderBodyState\|ariaDescribedBy\|selectAllLabel\|resultsAnnouncement\|groupChildCountLabel\|dataErrorAnnouncement\|focusedRowRemovedAnnouncement\|moreRowsBoundaryAnnouncement\|emptyStateMessage\|loadingStateMessage\|matchingTotal\|datasetKey\|loadedRowCount\|setResultMeta" packages/grid-core/src/types.ts packages/core/src/pretable-grid.ts packages/react/src/use-pretable.ts packages/react/src/pretable-surface.tsx packages/react/src/data-state.ts packages/react/src/copy.ts`. For every *declaration* hit, confirm the preceding TSDoc block contains `@experimental`. Add it where missing. `loadedRowCount` is a rename of a stable field and stays stable — do **not** tag it.
- [ ] **Step 2: Typecheck every package.** Run `pnpm typecheck`. Expect no errors. A missing `scope` argument at a `formatAggregateValue` call or a missing `matchingTotal` in a hand-built telemetry fixture will surface here.
- [ ] **Step 3: Lint.** Run `pnpm lint`. Expect no errors. The most likely complaint is `react-hooks/exhaustive-deps` on the new effects — fix by adding the missing dependency, not by widening the disable comment, except on the grid memo where the disable is already justified in a comment.
- [ ] **Step 4: Format.** Run `pnpm format:write && pnpm format`. Expect `All matched files use Prettier code style!`.
- [ ] **Step 5: Build, then regenerate the API reports.** Run `pnpm build && pnpm api`. **Build first** — a stale `dist/` silently strips exports from the report and `api:check` will not catch it. Expect `API Extractor completed successfully` four times.
- [ ] **Step 6: Review the API diff.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a diff packages/core/core.api.md packages/react/react.api.md`. Expect roughly 10 added entries in `core.api.md` (the four new types, `processing`, `filterOperators`, `matchingTotal`, `datasetKey`, `setResultMeta`, `PretableAggregateFormatInput.scope`) and roughly 17 in `react.api.md` (the ten message entries, four props, `PretableDataState`, telemetry `matchingTotal`, `SerializeRangesArgs.scope`). If a symbol you added is **missing**, it is not exported from the relevant `public_api.ts` — fix that, rebuild, re-run `pnpm api`.
- [ ] **Step 7: Verify the gate.** Run `pnpm api:check`. Expect success with no "You have changed the public API signature" error.
- [ ] **Step 8: Write the changeset.** Create `.changeset/server-authority-primitives.md`:

```md
---
"@pretable/core": minor
"@pretable/react": minor
"@pretable/ui": minor
---

Add server-authority primitives (experimental).

An upstream processor — a server, a worker, a wasm index — can now own
filtering and sorting while Pretable renders honest counts and an honest data
lifecycle.

- `processing: { filter, sort }` on `createGrid` / `PretableSurface` selects
  per-operation processing authority. `"external"` displays the state (funnel
  indicators, header arrows, `snapshot.filters`, `snapshot.sort`) without
  applying it to the loaded records.
- `setRows(rows, meta)` and `setResultMeta(meta)` accept a `PretableResultMeta`
  of `{ total, datasetKey }`. `snapshot.matchingTotal` reports the matching
  population; a changed `datasetKey` clears selection, focus, group expansion
  and any in-flight edit.
- `dataState` (no default) turns on lifecycle presentation: loading / empty /
  error body blocks, a `data-pretable-data-phase` styling hook, and result and
  error announcements. `renderBodyState` overrides the built-in blocks.
- `aria-rowcount` publishes the exact population under full external authority
  with an exact total and no grouping, and downgrades honestly otherwise.
  `aria-busy` is never set on the grid.
- Select-all, copy, group child counts and `formatAggregate` are scoped
  `"all" | "loaded"` so a partial window can never be described as everything.
- `column.filterOperators` prunes the funnel menu to operators the processor
  can honor.

**Breaking:** `PretableGridSnapshot.totalRowCount` and
`PretableTelemetry.totalRowCount` are renamed to `loadedRowCount`. There is no
alias — the old name became wrong the moment two totals existed.
```

- [ ] **Step 9: Run every test in the repo.** Run `pnpm test`. Expect all packages and apps green. Re-run any single React timeout alone with `-t` before treating it as a real failure.
- [ ] **Step 10: Re-check for parallel work.** Run `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a fetch origin && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a log --oneline HEAD..origin/main`. If anything landed since Task 1, rebase onto it and re-run Steps 5–9.
- [ ] **Step 11: Commit.** `git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a add -A && git -C /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a commit -m "chore: regenerate API reports and add changeset for server-authority primitives"`.

---

## Definition of done

- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm api:check` all pass.
- [ ] Both local-mode baseline test files pass **unmodified** except for the two additive snapshot keys (Task 6 Step 10) and the mechanical rename (Task 3 Step 4).
- [ ] `grep -rn totalRowCount . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git` returns hits only in `docs/superpowers/plans` and `docs/superpowers/specs` (historical documents).
- [ ] Every new public symbol carries `@experimental` in its TSDoc.
- [ ] No Tailwind classes anywhere under `packages/`.
- [ ] One changeset covering `@pretable/core`, `@pretable/react`, `@pretable/ui` at `minor`.

## Deliberately out of scope for this slice

- Any Dawn change (slices 2–4).
- ~~The "Updating results…" stale announcement~~ — **resolved during plan review**: the design gap was real (§4.5 named the announcement, §4.3 defined no message key), and the design was amended to add `staleAnnouncement` rather than drop the announcement. It is the only AT-facing stale signal, so omitting it would have quietly failed `D1-UX-02` for screen-reader users. Now built in Task 15.
- Load-more and retry controls: consumer chrome outside the grid element (§9.2).
- Bench `replace`/`append` scripts and budget assertions (slice 5, §12.3).
- `rowIndexOffset` / windowed noncontiguous arithmetic, remote grouping (`processing.group`), query-aware facets — named EXT seams in §15.
