# Multi-Column Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column sort model with an ordered `PretableSortEntry[]` cascade end to end: engine, shift-click UI with priority badges, controlled state, docs, and all consumer migrations — one PR.

**Architecture:** `snapshot.sort` becomes `PretableSortEntry[]` (`{columnId, direction: "asc"|"desc"}`, index = priority, `[]` = unsorted). `setSort(columnId, direction)` keeps its signature but replaces the whole list with one entry (null clears); new `replaceSort(entries)` does atomic multi-sort and is what controlled state + shift-click use. `sortRows` becomes a multi-key cascade with the existing per-key logic and sourceIndex tie-break. No backcompat: `PretableSortState` is deleted.

**Tech Stack:** TypeScript, Vitest + RTL, vanilla CSS (`@pretable/ui`), api-extractor (required gate). Commands: `pnpm --filter @pretable-internal/grid-core test`, `pnpm --filter @pretable/react test`, `pnpm -r typecheck`/`lint`/`test`, `pnpm format`/`format:write`, `pnpm api`.

**Key facts (verified against code):**

- Engine: `grid-core/src/types.ts:169` `PretableSortState`, `:257` `snapshot.sort`, `PretableSortDirection = "asc"|"desc"|null`; `create-grid-core.ts:89` `cachedDerivedSort`, `:91` `let sort`, `:115` `setSort` (change-guard + emit); `derived-rows.ts:94` `sortRows` (single key: `if (!sort.columnId || !sort.direction) return [...rows]`, all-numeric fast path, `Intl.Collator` at module scope, sourceIndex tie-break); snapshot build copies `sort` and caches on reference.
- Surface (`react/src/pretable-surface.tsx`): `getNextSortDirection` imported `:46`; `onSortChange` prop `:236` (`{columnId, direction}|null`), destructured `:446`; per-column `sortDirection` derived `:1266-1268` from `snapshot.sort.columnId === column.id`; `ariaSort` `:1285-`; header `onClick` calls `grid.setSort(column.id, nextDirection)` then `onSortChange`; `MemoizedHeaderContent` props incl. `sortDirection` (`:354`, memo comparator `:413`), renders the arrow (`:396-398`).
- Controlled: `use-pretable.ts:80` `sort?: PretableSortState | null`; apply at `:230-231` `grid.setSort(state.sort?.columnId ?? null, state.sort?.direction ?? null)`.
- Other consumers (grep-verified): `packages/core` (`types.ts`, `pretable-grid.ts`, `create-grid.ts`, `public_api.ts`), `packages/react` (`inspection-grid.tsx`, `labeled-grid-surface.tsx`), `packages/bench-runner/src/index.ts`, `apps/bench` (`tanstack-adapter.tsx`, `mui-adapter.tsx`, and check `ag-grid-adapter.tsx` + `interaction-plan.ts`), website hero (`heroGrid/sort.ts` `applySort` + website `SortState`; `HeroGrid.tsx` `userSort`/`onSortChange`/`state.sort`), plus tests and `*.mdx` docs showing `PretableSortState`.
- Docs nav is hardcoded (`apps/website/app/docs/_nav.ts`); search-index is a build-time route (nothing to regen).
- Prior gotchas that apply: run `pnpm format` before finishing (45-file style debt incident); build react sequentially before `pnpm api` if the report looks stale (parallel-build dist race); grep `*.mdx` in no-backcompat sweeps.

---

## Task 1: Engine — types, cascade, `replaceSort` (grid-core)

**Files:**

- Modify: `packages/grid-core/src/types.ts`, `derived-rows.ts`, `create-grid-core.ts`, `index.ts` (export)
- Test: `packages/grid-core/src/__tests__/` — new `multi-sort.test.ts` + migrate existing sort usages (`grid-core.test.ts`, `emit-behavior.test.ts`, others found by grep)

- [ ] **Step 1: Types.** In `types.ts`: add

```ts
/** @public — one entry in the ordered sort list; index in the list = priority. */
export interface PretableSortEntry {
  columnId: string;
  direction: "asc" | "desc";
}
```

Delete `PretableSortState`. Retype `PretableGridSnapshot.sort` to `PretableSortEntry[]`. In `PretableEngine`: keep `setSort(columnId: string | null, direction: PretableSortDirection): void`; add `replaceSort(entries: PretableSortEntry[]): void`. Keep `PretableSortDirection` unchanged.

- [ ] **Step 2: Failing tests** (`multi-sort.test.ts`). Fixture: rows with `{ id, group: string, score: number, name: string }` where groups tie. Cover:

```ts
// cascade: sort by group asc then score desc — ties in group resolved by score
grid.replaceSort([
  { columnId: "group", direction: "asc" },
  { columnId: "score", direction: "desc" },
]);
expect(ids()).toEqual([/* … */]);
// stability: equal (group, score) pairs keep source order
// setSort replaces the whole list with one entry
grid.setSort("name", "asc");
expect(grid.getSnapshot().sort).toEqual([
  { columnId: "name", direction: "asc" },
]);
// setSort(null, null) and setSort("name", null) clear to []
// replaceSort drops unknown columnIds and sortable:false columns
// replaceSort change-guard: equal list ⇒ same snapshot reference
// [] = source order
```

Run: `pnpm --filter @pretable-internal/grid-core test -- multi-sort` → FAIL (types/methods missing).

- [ ] **Step 3: `derived-rows.ts` cascade.** `deriveVisibleRows` input `sort: PretableSortEntry[]`. Rewrite `sortRows`:

```ts
function sortRows<TRow extends PretableRow>(
  rows: SourceRow<TRow>[],
  columns: PretableColumn<TRow>[],
  sort: PretableSortEntry[],
): SourceRow<TRow>[] {
  const keys = sort
    .map((entry) => {
      const column = columns.find((c) => c.id === entry.columnId);
      if (!column) return null;
      const rawKeys = rows.map((r) => readCellValue(r.row, column));
      const allNumeric = rawKeys.every((v) => typeof v === "number");
      const multiplier = entry.direction === "asc" ? 1 : -1;
      return allNumeric
        ? { kind: "num" as const, keys: rawKeys as number[], multiplier }
        : {
            kind: "str" as const,
            keys: rawKeys.map((v) => String(v ?? "")),
            multiplier,
          };
    })
    .filter((k) => k !== null);

  if (keys.length === 0) return [...rows];

  const indexed = rows.map((_, i) => i);
  indexed.sort((a, b) => {
    for (const key of keys) {
      const cmp =
        key.kind === "num"
          ? key.keys[a] - key.keys[b]
          : collator.compare(key.keys[a], key.keys[b]);
      if (cmp !== 0) return cmp * key.multiplier;
    }
    return rows[a].sourceIndex - rows[b].sourceIndex;
  });
  return indexed.map((i) => rows[i]);
}
```

(Precompute per-entry key arrays once — preserves today's perf shape.)

- [ ] **Step 4: `create-grid-core.ts`.** State `let sort: PretableSortEntry[] = []`; cache `cachedDerivedSort: PretableSortEntry[] | null`. Replace `setSort` body:

```ts
setSort(columnId: string | null, direction: PretableSortDirection) {
  const next: PretableSortEntry[] =
    columnId && direction ? [{ columnId, direction }] : [];
  if (sortsEqual(sort, next)) return;
  sort = next;
  emit();
},
replaceSort(entries: PretableSortEntry[]) {
  const next = entries.filter((e) => {
    const col = options.columns.find((c) => c.id === e.columnId);
    return col !== undefined && col.sortable !== false;
  });
  if (sortsEqual(sort, next)) return;
  sort = next;
  emit();
},
```

Add `sortsEqual(a, b)` (length + per-entry columnId/direction). Snapshot: `sort: [...sort]`. Fix any other `sort.columnId`/`sort.direction` reads in this file (grep; e.g. keyboard/page-step logic if it touches sort — migrate to the list).

- [ ] **Step 5: Migrate existing grid-core tests** (all `setSort(...)` expectations now assert list shape where they read `snapshot.sort`). Run full package: `pnpm --filter @pretable-internal/grid-core test` → PASS; `pnpm --filter @pretable-internal/grid-core typecheck` → clean.

- [ ] **Step 6: Commit** — `feat(grid-core): ordered multi-column sort (PretableSortEntry[], replaceSort)`

---

## Task 2: Public surface — core + react plumbing (no UI yet)

**Files:**

- Modify: `packages/core/src/types.ts`, `pretable-grid.ts`, `create-grid.ts`, `public_api.ts`
- Modify: `packages/react/src/use-pretable.ts`, `public_api.ts`, `inspection-grid.tsx`, `labeled-grid-surface.tsx`
- Tests: migrate any core/react tests that reference the old shape (grep).

- [ ] **Step 1: core.** `PretableGrid` interface: keep `setSort`, add `replaceSort(entries: PretableSortEntry[]): void`. `create-grid.ts` forwards `replaceSort: engine.replaceSort`. `public_api.ts`: export `PretableSortEntry`; remove `PretableSortState` export (keep `PretableSortDirection`). Fix `core/src/types.ts` if it re-declares sort types.
- [ ] **Step 2: react plumbing.** `use-pretable.ts`: `PretableSurfaceState.sort?: PretableSortEntry[]` (drop `| null`; `[]` = explicitly unsorted); controlled apply becomes:

```ts
if (state.sort !== undefined) {
  grid.replaceSort(state.sort);
}
```

`public_api.ts`: re-export `PretableSortEntry`. Migrate `inspection-grid.tsx` + `labeled-grid-surface.tsx` sort reads (`snapshot.sort.columnId` → derive from the list: `snapshot.sort[0]` or a find by column, matching each component's intent — read the code, keep behavior).

- [ ] **Step 3: Verify** `pnpm --filter @pretable/core typecheck && pnpm --filter @pretable/react typecheck` and `pnpm --filter @pretable/react test` (surface tests will still pass — plain-click path still calls `setSort`; fix any test reading `snapshot.sort` shape). NOTE: `pretable-surface.tsx` itself must compile — its `snapshot.sort.columnId` reads (`:1266-1268`) need a minimal migration NOW (derive the column's entry via `snapshot.sort.find(...)`); the full UI work is Task 3.
- [ ] **Step 4: Commit** — `feat(core,react): expose multi-sort API (PretableSortEntry, replaceSort)`

---

## Task 3: Surface UI — shift-click, priority badges, `onSortChange` retype (+ CSS)

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`, `packages/ui/src/grid.css`
- Test: `packages/react/src/__tests__/multi-sort-surface.test.tsx` (new) + migrate `pretable-surface.test.tsx` sort tests.

- [ ] **Step 1: Failing RTL tests** (`multi-sort-surface.test.tsx`), mirroring the existing sort-click test setup:
  - plain click cycles asc → desc → none and REPLACES a multi-entry list; `onSortChange` receives the full list (`[{a,asc}]`, then `[{a,desc}]`, then `[]`).
  - shift-click on an unsorted column appends `asc` (list order preserved); shift-click cycles that column asc → desc → removed-in-place (others keep positions).
  - badges: with 2 sorted columns, headers show `data-pretable-sort-priority` "1"/"2"; with 1 sorted column, no badge; badge numbers update when an entry is removed.
  - controlled `state.sort` (2 entries) renders both indicators; ignoring `onSortChange` keeps the engine pinned to the prop.
  - `sortable: false` column: click/shift-click no-op (existing behavior preserved).
- [ ] **Step 2: Implement.** Per-column derivation replaces `:1266-1268`:

```ts
const sortIndex = snapshot.sort.findIndex((e) => e.columnId === column.id);
const sortEntry = sortIndex === -1 ? null : snapshot.sort[sortIndex];
const sortDirection = sortEntry?.direction ?? null;
const sortPriority =
  sortIndex !== -1 && snapshot.sort.length > 1 ? sortIndex + 1 : null;
```

Header `onClick`:

```ts
if (event.shiftKey) {
  const current = snapshot.sort;
  const idx = current.findIndex((e) => e.columnId === column.id);
  let next: PretableSortEntry[];
  if (idx === -1) {
    next = [...current, { columnId: column.id, direction: "asc" }];
  } else if (current[idx].direction === "asc") {
    next = current.map((e, i) =>
      i === idx ? { ...e, direction: "desc" as const } : e,
    );
  } else {
    next = current.filter((_, i) => i !== idx);
  }
  grid.replaceSort(next);
  onSortChange?.(grid.getSnapshot().sort);
} else {
  const nextDirection = getNextSortDirection(sortDirection);
  grid.setSort(column.id, nextDirection);
  onSortChange?.(grid.getSnapshot().sort);
}
```

Retype the prop: `onSortChange?: (sort: PretableSortEntry[]) => void` (`:236`). Pass `sortPriority` into `MemoizedHeaderContent`; add it to the memo comparator (`:413`) and render `<span data-pretable-sort-priority>{sortPriority}</span>` beside the arrow when non-null. Keep `aria-sort` from `sortDirection`.

- [ ] **Step 3: CSS** (`grid.css`, `:where()`, no new tokens):

```css
:where([data-pretable-sort-priority]) {
  margin-left: 2px;
  font-size: 9px;
  font-weight: 600;
  color: var(--pretable-text-dim);
  vertical-align: super;
}
```

- [ ] **Step 4: Verify** `pnpm --filter @pretable/react test && typecheck`, `pnpm --filter @pretable/ui test`.
- [ ] **Step 5: Commit** — `feat(react,ui): shift-click multi-sort with priority badges`

---

## Task 4: Migrations (hero, bench, docs) + api + full validation

**Files:**

- Modify: `apps/website/app/components/heroGrid/sort.ts` (+ its test), `HeroGrid.tsx`
- Modify: `packages/bench-runner/src/index.ts`, `apps/bench/src/*.tsx` sort plumbing (incl. `interaction-plan.ts` if it carries sort)
- Create: `apps/website/content/docs/grid/sorting.mdx`; modify `apps/website/app/docs/_nav.ts`
- Modify: `*.mdx` showing `PretableSortState` (grep), both api-reference pages
- Generated: `*.api.md`

- [ ] **Step 1: Hero.** `sort.ts`: website `SortState` becomes `PretableSortEntry[]` (or delete the local type and use the public one); `applySort(rows, entries)` becomes a multi-key cascade (mirror engine semantics; it has its own comparators — extend to iterate entries). `HeroGrid.tsx`: `userSort: PretableSortEntry[]` state (init `[]`), `onSortChange={(entries) => setUserSort(entries)}`, `state={{ sort: userSort }}` — note: always pass the list now (empty = unsorted); drop the conditional spread. Migrate hero sort tests.
- [ ] **Step 2: Bench.** Retype sort plumbing mechanically. Comparative adapters: map the entry list to each lib's multi-sort model where it's a direct translation (ag-grid `sortModel`, MUI `sortModel`, tanstack `sorting` all support arrays — straightforward); keep evaluator behavior identical for the single-entry scripts.
- [ ] **Step 3: Docs.** New `sorting.mdx` (frontmatter `nav: Grid`, `order: 5`-ish; nav entry between "Selection" and "Keyboard" — or adjacent to Filtering; pick one and be consistent): click/shift-click UX, entry-list model + priority, controlled `state.sort` + `onSortChange` examples, headless `setSort`/`replaceSort`. Update `grid/api-reference.mdx` + `headless/api-reference.mdx` sort rows/types (delete `PretableSortState`, add `PretableSortEntry`, add `replaceSort` row) and any other `.mdx` hits.
- [ ] **Step 4: Sweep + api.** Greps must come back clean: `grep -rn "PretableSortState" packages apps --include='*.ts' --include='*.tsx' --include='*.mdx'` → zero hits (excluding dist/). Build react sequentially, then `pnpm api`; review diff (adds `PretableSortEntry` + `replaceSort`, removes `PretableSortState`, retypes `sort` fields + `onSortChange`); commit reports.
- [ ] **Step 5: Full validation.**

```bash
pnpm -r typecheck && pnpm -r lint && pnpm -r test
pnpm format
pnpm --filter @pretable/app-website build
pnpm api   # second run must be a no-op
```

Local smoke (build + `next start` + `BASE_URL=… pnpm smoke`): existing sort-related steps must still pass (plain-click behavior unchanged).

- [ ] **Step 6: Commit** — `feat(website,bench): migrate to multi-sort model; add /docs/grid/sorting; refresh API reports`

---

## Self-Review notes (for the executor)

- **Spec coverage:** entry-list model + cascade + `replaceSort` (T1) ✓; public surface + controlled retype (T2) ✓; shift-click + badges + `onSortChange` list (T3) ✓; hero/bench/docs migrations + api gate (T4) ✓; no aliases — `PretableSortState` deleted with a repo-wide grep incl. `*.mdx` ✓.
- **Behavior invariants:** plain-click cycle identical to today; `[]` = source order; stability via sourceIndex; `sortable:false` still inert.
- **Known gotchas:** memo comparator must include `sortPriority`; run `pnpm format` before finishing; sequential react build before `pnpm api` if the report looks stale; hero always passes `state.sort` now (empty list) — verify the controlled re-assert doesn't fight the uncontrolled filter menu (different slices; it won't).
- **Type consistency:** `PretableSortEntry`, `replaceSort`, `sortsEqual`, `sortPriority`, `data-pretable-sort-priority` used identically across tasks.
