# Filter Tree (SP2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filters become an arbitrary-depth tree of AND/OR groups over the existing typed leaves — the engine prerequisite for the tool panel's filter builder (SP2b).

**Architecture:** The row-model query is already the single source of truth for filters (grid-core holds no filter state; the surface's per-column record is a derived projection). A recursive group node joins the filter union; capture, evaluation, and equality in `compiled-query.ts` recurse; the surface's projection, funnel, and FilterMenu write path become tree-aware. No UI renders groups in SP2a.

**Tech Stack:** TypeScript, vitest, API Extractor, changesets. No CSS, no new components.

**Spec:** `docs/superpowers/specs/2026-08-25-filter-tree-design.md` — decisions there are settled: arbitrary nesting; `filters` stays an array with groups as elements (implicit top-level AND); **empty group evaluates TRUE regardless of `op`**; funnel lights on any occurrence; menu owns only its column's top-level leaf.

---

## Ground truth (verified, 2026-08-25 — line numbers may drift, anchors won't)

- `packages/row-model/src/column-types.ts:566` — `PretableQueryFor.filters: readonly PretableFilterFor<TColumns>[]`; `PretableFilterFor` is the big distributive conditional at `:470-530`.
- `packages/row-model/src/compiled-query.ts`:
  - `:251` `RuntimeFilter { columnId, operator, value? }`; `:263` `RuntimeQuery`.
  - `:572` `captureFilter(raw, index)` — validates and freezes each incoming leaf, `fail()`s with a `query.filters[i]` path.
  - `:1491` evaluation: `this.#runtimeQuery.filters.every((filter) => …)`.
  - `:906` `queryEqual` → `:914` `filtersEqual` — **order-insensitive multiset** match (used-set + findIndex). AND/OR are commutative, so order-insensitivity stays correct per level under recursion.
  - `:150/:1170` `filterAuthority === "external"` gates evaluation — the tree does not touch this seam.
- `packages/react/src/pretable-surface.tsx`:
  - `:2180-2190` builds the derived `Record<columnId, ColumnFilter>` **from `rowModelSnapshot.query.filters`, with a cast that assumes every element is a leaf** (`entry.columnId`) — a group element would today land under key `undefined`. This is the projection that becomes tree-aware.
  - `:403` the controlled `state.filters: Readonly<Record<string, ColumnFilter>>`.
  - `:5848` funnel: `active={Boolean(snapshot.filters[column.id])}`; `:6616` menu reads `snapshot.filters[columnId]`.
  - The menu's commit path goes through the surface's query write (find it from `:6616`'s handler; it rebuilds the filters array and calls the model's `setQuery` path).
- `ColumnFilter` (`packages/grid-core/src/types.ts:124`) is `{ operator, value? }` — **column-id-less**; the record's key carries the id. Grid-core has zero filter state or methods; nothing in grid-core changes in SP2a.
- Server-side docs live under `apps/website/content/docs/server-data/`.

## File map

| File | Responsibility |
|---|---|
| `packages/row-model/src/column-types.ts` | `PretableFilterGroupFor`, widen `PretableQueryFor.filters`, `isPretableFilterGroup` guard |
| `packages/row-model/src/compiled-query.ts` | recursive capture / evaluation / equality |
| `packages/row-model/src/__tests__/filter-tree.test.ts` | new — semantics suite |
| row-model's existing type-tests file (find: `ls packages/row-model/src/__tests__/*type*`) | `IsNever` probes |
| `packages/react/src/pretable-surface.tsx` | snapshot projection, funnel, menu read/write, `state.filters` shape |
| `packages/react/src/__tests__/` | extend the filter/controlled-state suites |
| `apps/website/content/docs/server-data/` filter page | wire contract |
| `packages/core` / `packages/react` `.api.md` + `.changeset/` | reports, changesets |

## Standing rules

- TDD; prettier before trusting a test; mutation-check every guard-like assertion; `pnpm build` before `pnpm api`; drawn-order/`getColumns()` rules don't apply here but the audit discipline does; subscribe to snapshots, never `getState`, in anything reactive; no stash/checkout with uncommitted work — restore mutations by targeted edit.
- **Pre-1.0, no compatibility aliases** — but "array of leaves keeps compiling" is a design requirement, not backcompat courtesy: verify it with an untouched existing test.

---

### Task 1: row-model — the group type, guard, and capture

**Files:** `packages/row-model/src/column-types.ts`, `packages/row-model/src/compiled-query.ts`, create `packages/row-model/src/__tests__/filter-tree.test.ts`, extend the row-model type-tests

- [ ] **Step 1: Failing type probes first.** In the row-model type-test file, following its existing `IsNever`/assertion idiom:
  - `PretableFilterGroupFor<Cols>` is not `never` for a representative column set;
  - `PretableQueryFor<Cols>["filters"][number]` accepts both a leaf and a group (assignability probes both directions);
  - a group with a misspelled `op: "nor"` is rejected;
  - **the pre-existing leaf-only probes stay untouched and green** — that is the "array of leaves keeps compiling" requirement, checked by not editing them.
- [ ] **Step 2: Failing runtime tests** in `filter-tree.test.ts` (copy the harness of the nearest compiled-query test):
  - `isPretableFilterGroup` true for `{op:"and",children:[]}`, false for every leaf shape (probe each operator family: text, number-between, date, enum-set, isEmpty);
  - capture: a query whose filters include a nested group round-trips into the compiled query without throwing; `op: "xor"` fails with a `query.filters[1].op` path; a group whose `children` is not an array fails with its path; deep-frozen output (mutating a nested child throws in strict mode).
- [ ] **Step 3: Run both, confirm failures for the right reasons.**
- [ ] **Step 4: Implement.**
  - `column-types.ts`: the interface exactly as the spec writes it; the guard narrow and total:

```ts
/** @public */
export function isPretableFilterGroup<TColumns>(
  node: PretableFilterFor<TColumns> | PretableFilterGroupFor<TColumns>,
): node is PretableFilterGroupFor<TColumns> {
  // Structural: groups carry `op` + `children`; every leaf carries `operator`.
  // Checked positively on the group's fields so an unknown shape fails closed.
  return (
    typeof node === "object" &&
    node !== null &&
    "children" in node &&
    ("op" in node
      ? (node as { op: unknown }).op === "and" ||
        (node as { op: unknown }).op === "or"
      : false)
  );
}
```

  - `compiled-query.ts`: `RuntimeFilterNode = RuntimeFilter | RuntimeFilterGroup { op, children }`; `captureFilter` becomes the leaf half of a recursive `captureFilterNode(raw, path)` that validates `op` ∈ {and, or}, requires an array `children`, recurses with `path.children[i]`, and freezes each level. Keep `fail()`'s message voice.
- [ ] **Step 5:** Tests green; whole package: `pnpm --filter @pretable-internal/row-model test` (check the actual package name in its package.json first). Prettier.
- [ ] **Step 6: Commit** `feat(row-model): filter groups — the type, the guard, and capture`.

### Task 2: recursion — evaluation and equality

**Files:** `packages/row-model/src/compiled-query.ts`, extend `filter-tree.test.ts`

- [ ] **Step 1: Failing tests.** Fixtures must be able to disprove (the repo rule — an OR fixture whose expected rows differ from the same tree under AND):
  - rows `[{n:1},{n:5},{n:9}]`, tree `[{gt 4} , {op:"or", children:[{lt 2},{gt 8}]}]` → rows 9 only; same tree with the group's op flipped to `and` → no rows. Both asserted, so a connective mix-up cannot pass.
  - nesting three deep evaluates correctly (compose the above inside another `or`).
  - **empty group ⇒ TRUE for both ops** — `{op:"or",children:[]}` alongside a real leaf filters exactly as the leaf alone; same for `and`. (This is the spec's product-safety convention; the naive algebra would say empty-OR ⇒ false.)
  - short-circuit is NOT observable behavior — do not test call counts; outcomes only.
  - equality both directions: two trees equal up to sibling permutation at each level ARE equal (no recompile); trees differing only in a nested leaf's value are NOT equal. Assert through whatever the compiled query exposes for plan reuse (find how existing tests observe recompile-vs-reuse — follow that mechanism, not internals).
- [ ] **Step 2: Confirm failures.**
- [ ] **Step 3: Implement.** `:1491` → `evaluateFilterNode(node, row)`: leaf → existing single-filter evaluation unchanged; group → `op === "and" ? children.every : children.length === 0 ? true : children.some` (write the empty-OR case explicitly with the WHY comment — `some` on empty already returns false, which is precisely the wrong answer here). `filtersEqual` → `filterNodesEqual`: same used-set multiset shape, recursing when both sides are groups (`op` must match; children compared as an order-insensitive multiset per level).
- [ ] **Step 4:** Green; full package; prettier. **Mutation round, all restored by targeted edit:** flip `every`/`some` → the OR/AND twin tests fail; delete the empty-group special case → the empty-OR test fails; make `filterNodesEqual` ignore `op` → the equality test fails.
- [ ] **Step 5: Commit** `feat(row-model): filter trees evaluate and compare recursively`.

### Task 3: API reports and the core changeset

- [ ] **Step 1:** `pnpm build && pnpm api && pnpm api:check`. Expected surfacing: `PretableFilterGroupFor`, `isPretableFilterGroup`, the widened `filters` element type — in `core.api.md` and `react.api.md` (the query types flow through both). Anything else surfacing is a stop-and-report.
- [ ] **Step 2:** Changeset `@pretable/core` minor: the group node, the guard, implicit-AND array preserved, empty-group-TRUE semantics named (a CHANGELOG reader must learn that rule here).
- [ ] **Step 3: Commit** `chore: api reports and changeset for filter groups`.

### Task 4: react — projection, funnel, menu, controlled state

**Files:** `packages/react/src/pretable-surface.tsx`, extend the surface filter/controlled-state test files

The audit is the heart of this task. `grep -n "query.filters\|state.filters\|snapshot.filters" packages/react/src apps/website apps/bench --include="*.ts*" -r` — every site gets a verdict (tree-aware / leaf-only-by-design / display-only), recorded as a code comment where non-obvious. Known sites: the projection (`:2180` — its leaf-assuming cast is the bug-in-waiting), funnel (`:5848`), menu read (`:6616`), menu commit, controlled `state.filters` (`:403`), CSV/export omissions, bench adapters, docs examples.

- [ ] **Step 1: Failing tests:**
  - **snapshot shape**: `snapshot.filters` becomes the query's array verbatim (leaves carry `columnId`; groups nest). Existing consumers of the old record shape inside the repo are part of this task's churn — the type change finds them.
  - **funnel-anywhere**: a filter on column `a` buried two groups deep lights `a`'s funnel; no top-level leaf needed. (New recursive helper `columnHasFilter(filters, columnId)` — pure, exported from a surface-adjacent module or local, unit-tested directly.)
  - **menu reads only its top-level leaf**: with `a` filtered both at top level and inside a group, the menu shows the top-level leaf's operator/value.
  - **menu write splices, groups survive** (the survives-test): commit a new filter from the menu for `a` while a group mentioning `a` and `b` exists → the group element is byte-identical in the resulting query; clearing `a` from the menu removes only the top-level leaf.
  - **controlled `state.filters`** takes the array shape; a controlled tree renders funnels and filters rows (jsdom: assert visible row count through the model, the way controlled-query tests do).
- [ ] **Step 2:** Failures confirmed. **Step 3:** Implement — projection passes the array through (delete the record-building loop), funnel uses the helper, menu read/write scoped to top-level leaves, `state.filters` type + application path updated, audit verdicts written.
- [ ] **Step 4:** Full `pnpm --filter @pretable/react test` and `pnpm --filter @pretable/app-website test` (docs examples may consume `snapshot.filters` — expected churn belongs here). Prettier.
- [ ] **Step 5:** `pnpm build && pnpm api && pnpm api:check` (react.api.md moves for the snapshot/state types); react changeset (minor) written now.
- [ ] **Step 6: Commit** `feat(react): the surface speaks filter trees — funnels, menu, controlled state`.

### Task 5: the wire contract docs

**Files:** the filter page under `apps/website/content/docs/server-data/` (find the one documenting `onQueryChange`'s filter payload)

- [ ] **Step 1:** Read the page and the docs guard's current reach (`apps/website/lib/docs/__tests__/docs-api-surface.test.ts` — it checks fenced imports, prose `Pretable*` identifiers, and registered tables; it was hardened four rounds, assume it sees more than you expect).
- [ ] **Step 2:** Document: groups arrive verbatim in `query.filters`; leaves vs groups discriminate on `op`/`children` (name `isPretableFilterGroup` for consumers on the client edge); a server that only understands flat filters must decide explicitly (reject, flatten-if-all-AND, or implement) — present the three honestly; empty-group-TRUE is part of the contract.
- [ ] **Step 3:** `pnpm --filter @pretable/app-website test -- docs-api-surface` green (register any new table). Full website suite. Prettier (markdown tables).
- [ ] **Step 4: Commit** `docs(server-data): the filter wire contract grows groups`.

### Task 6: final battery

- [ ] All package suites (row-model, core, react, ui, website) — real counts; typecheck, lint, `pnpm format`.
- [ ] `pnpm build && pnpm api && pnpm api:check`; `git status` clean of stale reports.
- [ ] Website e2e, FULL suite, production build, root playwright binary from inside `apps/website`, `--workers=1` (the cockpit filter smoke exercises the menu path end-to-end).
- [ ] Re-verify both changesets against what actually shipped.
- [ ] Confirm the audit table is complete: re-run the grep, zero unverdicted sites.

## Self-review

**Spec coverage:** type+guard (T1), evaluation+equality+empty-group (T2), reports/changesets (T3), surface+funnel+menu+state (T4), wire docs (T5), audit (T4+T6), verification (T6). External authority needs no task — the seam is evaluation-side and T2's tests run under default authority; T4's audit confirms no authority-path reader assumes leaves.

**Judgment calls made here, flagged:** (1) `snapshot.filters` becomes the query array *verbatim* rather than keeping a parallel per-column record for chrome — one vocabulary, and the funnel helper is cheaper than maintaining a projection that lies by omission; (2) the menu's write path is defined by splice-preserving-groups rather than rebuild-from-record — the survives-test enforces it.
