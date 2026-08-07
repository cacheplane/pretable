# Row Grouping Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Headless multi-level row grouping with aggregation — a grouped flat row model, expand/collapse, monoid aggregators, and every existing `visibleRows` consumer migrated so the repo stays green.

**Architecture:** `visibleRows` stays a flat array but becomes a discriminated union (`{kind:"data"} | {kind:"group"}`). A pure `group-rows.ts` module does grouping, aggregation, per-level sorting and flattening; `deriveVisibleRows` calls it after filtering. Aggregators are monoids (`init`/`accumulate`/`merge`/`finalize`) implemented leaf-first so a later rollup optimization stays internal. Full recompute — no incremental tree.

**Tech Stack:** TypeScript, Vitest, api-extractor (required gate). Commands: `pnpm --filter @pretable-internal/grid-core test`, `pnpm --filter @pretable/react test`, `pnpm -r typecheck`/`lint`/`test`, `npx prettier --write <files>` (repo-wide `pnpm format:write` can exceed a 2-minute timeout), `pnpm api`.

**Key facts (verified against `main`):**

- `deriveVisibleRows({ columns, filters, rows: SourceRow<TRow>[], sort: PretableSortEntry[] })` in `packages/grid-core/src/derived-rows.ts` — filters, then `sortRows` (multi-key cascade with `sourceIndex` tie-break), then maps to `{id,row,sourceIndex}`.
- `create-grid-core.ts`: `cachedVisibleRows` + `cachedDerivedSort` + `cachedDerivedFilters` (~~:144-146); the cache hit is `cachedDerivedSort === sort && cachedDerivedFilters === filters` (~~:1119-1122); **`setRows` and `applyTransaction` both null `cachedVisibleRows`**, so row changes always re-derive from source rows.
- **67 references to `.visibleRows` across `packages/` + `apps/`** (excluding dist). Known hot spots: `renderer-dom/create-renderer.ts:55`, `create-grid-core.ts` (selectAll ~:284, clearSelection ~:427, moveFocus ~~:546), `react/pretable-surface.tsx` (~~:810, ~:887), `react/copy.ts`, `labeled-grid-surface.tsx`, bench adapters, website.
- Prior gotchas: run prettier on touched files; build react sequentially before `pnpm api` if a report looks stale; `pnpm -r test` occasionally flakes under parallel load in `apps/bench` and `pretable-surface.test.tsx` — re-run in isolation to confirm it isn't you.

---

## Task 1: Types + built-in aggregators + group-id helpers

**Files:**

- Modify: `packages/grid-core/src/types.ts`
- Create: `packages/grid-core/src/aggregators.ts`, `packages/grid-core/src/group-id.ts`
- Test: `packages/grid-core/src/__tests__/aggregators.test.ts`, `__tests__/group-id.test.ts`

- [ ] **Step 1: Types** (`types.ts`), exactly per the spec's "Row model" and "aggregate function interface" sections: `PretableDataRow`, `PretableGroupRow`, the `PretableVisibleRow` union, `PretableAggregator<TAcc, TOut>`, and the column field `aggregate?: "sum"|"avg"|"min"|"max"|"count"|PretableAggregator`. Add `rowGroup?: boolean` to `PretableColumn`. Do NOT touch `deriveVisibleRows`/engine yet — this task must leave the repo compiling for grid-core (downstream packages break in Task 4; that's expected and scoped).
      If widening the union breaks grid-core's own files immediately, add the narrowest local `kind === "data"` guards needed to keep THIS package green, and note them for Task 3.
- [ ] **Step 2: Group-id helpers** (`group-id.ts`): `makeGroupId(path: {columnId, value}[]): string` producing `__group__:col=key/col=key`, percent-escaping `/`, `=`, `%` in both the columnId and the stringified key. Plus `escapeGroupKey`/`unescapeGroupKey` if useful. **Failing tests first**: round-trip; a key containing `/`, `=`, `%`; two different paths never collide (the ag-grid `-`-join ambiguity we're fixing); `null`/`undefined`/number/boolean keys stringify deterministically.
- [ ] **Step 3: Built-in aggregators** (`aggregators.ts`): `sum`, `avg` (accumulator `{sum, count}`), `min`, `max`, `count`, each a `PretableAggregator`. Export a `resolveAggregator(spec)` mapping the string names. **Failing tests first**, and include an **associativity property test** for every built-in: for random splits of a value list, `finalize(merge(foldA, foldB)) === finalize(foldAll)`. That property is what makes a future rollup optimization safe — it must hold from day one.
      Non-numeric/`null` values: `sum`/`avg` skip them, `min`/`max` ignore them, `count` counts rows not values. Empty accumulator finalizes to `null` (not `0`) so an empty group renders blank rather than a misleading zero — assert this.
- [ ] **Step 4: Verify** `pnpm --filter @pretable-internal/grid-core test` + `typecheck`.
- [ ] **Step 5: Commit** — `feat(grid-core): grouping types, monoid aggregators, escaped group ids`

---

## Task 2: The grouping algorithm (pure)

**Files:**

- Create: `packages/grid-core/src/group-rows.ts`
- Test: `packages/grid-core/src/__tests__/group-rows.test.ts`

- [ ] **Step 1: Failing tests.** Fixture: ~8 rows over columns `sector` (2 values), `analyst` (2 values), `qty` (number), with deliberately **uneven group sizes** (this is what catches naive rollup). Cover:
  - ungrouped (`rowGroups: []`) returns exactly today's flat shape, every entry `kind:"data"`, `depth: 0`, order identical to the pre-grouping sort output;
  - single-level: group rows interleaved, correct `columnId`/`value`/`childCount`/`depth`;
  - two-level: nesting order, depths 0/1, data rows at depth 2;
  - **aggregate correctness across uneven groups**: a parent `avg` equals the average of ALL its descendant leaves, NOT the average of its child groups' averages (make the two differ numerically and assert the right one);
  - collapsed groups: descendants omitted from the flat list, group row still present with correct `childCount` and aggregates;
  - `defaultExpanded: false` collapses everything absent explicit ids;
  - a collapsed id for a group that doesn't exist is ignored;
  - sorting: data rows sorted within their group by the sort cascade; groups sorted among siblings by `value`;
  - `aggregateFilteredRows` both ways (pass pre-filter and post-filter row sets; assert the totals differ as documented, and `childCount` is always post-filter);
  - a grouping column with `null`/`undefined` values forms a single deterministic group.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `buildGroupedRows(args)`.** Suggested shape:
  ```ts
  export function buildGroupedRows<TRow extends PretableRow>(args: {
    rows: SourceRow<TRow>[]; // post-filter
    allRows?: SourceRow<TRow>[]; // pre-filter, when aggregateFilteredRows
    columns: PretableColumn<TRow>[];
    rowGroups: string[];
    sort: PretableSortEntry[];
    groupExpansionOverrides: ReadonlySet<string>;
    defaultExpanded: boolean;
  }): PretableVisibleRow<TRow>[];
  ```
  Build a nested map keyed by group value per level; aggregate each group by folding its **descendant leaves** (`init` → `accumulate` per leaf → `finalize`) for every column with an `aggregate`; sort data rows within their group with the existing cascade and groups among siblings by `value`; then flatten depth-first, descending only into expanded groups. Reuse `readCellValue` for both grouping keys and aggregate inputs. When `rowGroups` is empty, short-circuit to today's behavior.
- [ ] **Step 4: Run → PASS.** Also confirm the ungrouped path is byte-identical to the previous output (the existing `derived-rows` tests are the check).
- [ ] **Step 5: Commit** — `feat(grid-core): multi-level grouping + leaf-based aggregation`

---

## Task 3: Engine integration

**Files:**

- Modify: `packages/grid-core/src/derived-rows.ts`, `create-grid-core.ts`, `types.ts` (engine methods + snapshot), `index.ts`
- Test: extend `packages/grid-core/src/__tests__/grid-core.test.ts`, new `__tests__/grouping-engine.test.ts`

- [ ] **Step 1: Failing tests.** `setRowGroups` sets/clears and is change-guarded (equal input ⇒ same snapshot reference); unknown column ids dropped; `snapshot.rowGroups` reflects it; `toggleGroup`/`setGroupExpanded`/`expandAll`/`collapseAll` and `snapshot.groupExpansionOverrides`; expansion overrides pruned on `setRowGroups`; **a streamed update that changes a row's grouping key moves the row to the new group** (the guard-rail test — it passes for free under full recompute, and must keep passing if anyone optimizes later); unchanged aggregates keep object identity across a no-op recompute; selection/focus survive a grouped tick update.
- [ ] **Step 2: Wire `deriveVisibleRows`** to accept `rowGroups`, `groupExpansionOverrides`, `groupsDefaultExpanded`, `aggregateFilteredRows` and delegate to `buildGroupedRows` after filtering. Keep the pre-filter row set available for `aggregateFilteredRows: true`.
- [ ] **Step 3: Engine state + API** in `create-grid-core.ts`: `rowGroups: string[]`, `groupExpansionOverrides: Set<string>`; methods `setRowGroups`, `toggleGroup`, `setGroupExpanded`, `expandAll`, `collapseAll`; snapshot gains `rowGroups` + `groupExpansionOverrides` + `groupsDefaultExpanded` (copied defensively, as `sort` does). **Extend the derived cache keys** — add `rowGroups`, the override set, the expansion default and the aggregate-filtering flag to the `cachedDerived*` comparison, else grouping changes won't re-derive. Initialize `rowGroups` from columns' `rowGroup: true` in column order.
- [ ] **Step 4: Fix grid-core's own `visibleRows` consumers** — `selectAll`, `clearSelection`, `moveFocus`, page-step, and anything else in this file that assumes `.row`/`.id` on every entry. Decide and apply consistent semantics, and write them down in the code: **focus and keyboard navigation skip group rows in v1** (group-row focus/expansion by keyboard is sub-project 2); `selectAll` spans data rows only.
- [ ] **Step 5: Verify** `pnpm --filter @pretable-internal/grid-core test` + `typecheck` (this package must be fully green; downstream still breaks — that's Task 4).
- [ ] **Step 6: Commit** — `feat(grid-core): grouping engine state, expand/collapse, snapshot`

---

## Task 4: Migrate all consumers + public API + validation

**Files:** `packages/core/*`, `packages/renderer-dom/*`, `packages/react/*` (incl. `copy.ts`, `pretable-surface.tsx`, `labeled-grid-surface.tsx`, `paste.ts`), `packages/bench-runner`, `apps/bench/*`, `apps/website/*`, `*.api.md`

- [ ] **Step 1: Survey.** `grep -rn "\.visibleRows" packages apps --include='*.ts' --include='*.tsx' | grep -v dist` (~67 hits). Trioage each: does it need data rows only, or must it handle group rows? **In this sub-project, rendering group rows is out of scope** — so the default migration is "narrow to `kind === "data"` and behave exactly as before", which keeps every existing behavior and test intact. Only `renderer-dom` needs to pass group entries through so SP2 can render them.
- [ ] **Step 2: Migrate** in dependency order: `renderer-dom` → `core` → `react` → bench/website. Export the new types from `core/public_api.ts` and re-export from `react/public_api.ts` (`PretableDataRow`, `PretableGroupRow`, `PretableAggregator`; the `PretableVisibleRow` union is already exported and now widens).
  - `copy.ts`: skip group rows for now (SP2 defines their copy shape). Keep the block rectangular by simply omitting them; note it with a TODO referencing SP2.
  - `paste.ts` / `mapPasteToTargets`: group rows are never paste targets — filter them out of the target space so indices stay correct.
- [ ] **Step 3: Controlled state + surface prop plumbing** (types only, no rendering): `PretableSurfaceState.rowGroups?: string[]` applied via `setRowGroups` in `use-pretable.ts`, mirroring the `sort` slice.
- [ ] **Step 4: API reports.** `pnpm --filter @pretable/react build` then `pnpm api`. Expect a LARGE diff (the `PretableVisibleRow` widening plus the new types/methods). Read it and confirm every change is intended — no accidental internals exposed. Commit reports.
- [ ] **Step 5: Full validation.**
  ```bash
  pnpm -r typecheck && pnpm -r lint && pnpm -r test
  npx prettier --check .        # format:write the offenders if it fails
  pnpm --filter @pretable/app-website build
  pnpm api                      # second run must be a clean no-op
  ```
  Then the browser smoke: `cd apps/website && pnpm build`; `npx next start -p 3123 &`; `BASE_URL=http://localhost:3123 pnpm smoke --workers=1`; kill the server. **Nothing user-visible should change in this sub-project** — the website doesn't group anything yet, so a green smoke is the proof the migration was behavior-preserving.
- [ ] **Step 6: Commit** — `feat: migrate consumers to the grouped row model; refresh API reports`

---

## Self-Review notes (for the executor)

- **The single most important test** is Task 2's uneven-group average: a parent's `avg` must equal the mean of all descendant leaves, not the mean of child averages. Make the two numerically different or the test proves nothing.
- **Associativity property tests** (Task 1) are what license a future rollup optimization. Don't skip them as "obvious".
- **Nothing user-visible changes here.** If the website smoke or an existing test needs its expectations changed, that's a signal the migration wasn't behavior-preserving — investigate rather than update the expectation.
- **Don't render group rows** anywhere; that's SP2. This sub-project ends with the engine able to produce them and every consumer safely ignoring them.
- Empty aggregate ⇒ `null`, not `0`.
- Type consistency: `PretableDataRow`, `PretableGroupRow`, `PretableAggregator`, `buildGroupedRows`, `makeGroupId`, `resolveAggregator`, `setRowGroups`, `groupExpansionOverrides`, `aggregateFilteredRows`, `groupsDefaultExpanded` used identically across tasks.
