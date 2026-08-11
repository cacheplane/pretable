# TanStack Table v9 Benchmark Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dependabot PR #277 a native TanStack Table v9 benchmark migration that preserves the existing adapter contract and merges only after all local and GitHub checks pass.

**Architecture:** Keep the adapter headless and virtualized, but replace v8's bundled hook/row-model API with one static v9 `tableFeatures` configuration containing only column filtering and row sorting. Preserve heterogeneous auto filter/sort behavior with the exported `filterFns` and `sortFns` registries, use core cells instead of registering unused visibility/sizing features, and leave historical benchmark records unchanged.

**Tech Stack:** React 19, TypeScript 6, TanStack Table 9.1, TanStack Virtual 3, Vitest, Testing Library, Vite, pnpm, GitHub Actions.

---

## File map

- Modify `apps/bench/src/__tests__/tanstack-adapter.test.tsx`: add behavioral coverage for the v9 identity, row attributes, sort order, substring/exact filtering, and update callback.
- Modify `apps/bench/src/tanstack-adapter.tsx`: migrate the adapter from v8 to v9's native feature API.
- Modify `apps/bench/src/bench-app.tsx`: update the live comparator description to v9.
- Modify `apps/website/app/bench/page.tsx`: update the live benchmark-page description to v9.
- Preserve `apps/bench/package.json` and `pnpm-lock.yaml`: retain Dependabot's 9.1.0 dependency update.
- Preserve historical `docs/research`, `docs/superpowers`, status milestone, and `ComparisonTable` v8 references because they describe actual v8 runsets.

### Task 1: Add native-v9 compatibility regressions

**Files:**

- Modify: `apps/bench/src/__tests__/tanstack-adapter.test.tsx`

- [ ] **Step 1: Extend the metadata fixture with a near match**

Add `{ id: "5", status: "running-late" }` to `statusDataset.rows`. Change the metadata assertion comment from “2 of 4” to “2 of 5”; keep the expected result count at `2` so the test distinguishes exact matching from substring matching.

- [ ] **Step 2: Add plan and rendered-row helpers**

Add a `sortPlan` helper that creates a `BenchInteractionPlan` with one descending sort entry, and a `renderedRowIds(container)` helper that reads `data-row-id` from `[data-tanstack-row]` elements.

```tsx
function sortPlan(columnId: string): BenchInteractionPlan {
  return {
    focusedRowId: null,
    filters: {},
    mode: "sort",
    probeColumnId: columnId,
    resultRowCount: 0,
    rows: [],
    rowGroups: [],
    selectedRowId: null,
    sort: [{ columnId, direction: "desc" }],
  };
}

function renderedRowIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-tanstack-row]"), (row) =>
    row.getAttribute("data-row-id"),
  );
}
```

- [ ] **Step 3: Strengthen the mount test**

Assert the rendered heading is `TanStack Table v9`. Assert the first rendered row has `data-row-id="1"` and `data-row-index="0"`, while retaining the viewport/row/cell selector checks.

- [ ] **Step 4: Add descending-sort behavior coverage**

Render `dataset`, rerender with `sortPlan("name")`, and wait for `renderedRowIds(container)` to equal `["2", "1"]`. Assert the corresponding `data-row-index` values remain `["0", "1"]` after sorting.

- [ ] **Step 5: Add substring-filter behavior coverage**

Rerender `statusDataset` with a `filter-text` plan for `{ status: { operator: "contains", value: "run" } }`. Assert result count `3` and row IDs `["1", "3", "5"]`; this proves the v9 `auto` filter resolves to `includesString`.

- [ ] **Step 6: Add update-callback coverage**

Import `act` from Testing Library and `ApplyBenchUpdates` from `bench-runtime`. Capture the typed callback, invoke it inside `act`, apply a patch that changes row `1` from `Alpha` to `Omega`, then assert the row still has `data-row-id="1"` and its rendered text changes to `Omega`.

```tsx
let applyUpdates: ApplyBenchUpdates | undefined;
const { container } = render(
  <TanstackAdapter
    dataset={dataset as never}
    onUpdateApiReady={(apply) => {
      applyUpdates = apply;
    }}
    runKey={0}
  />,
);

await waitFor(() => expect(applyUpdates).toBeDefined());
act(() => applyUpdates?.([{ id: "1", name: "Omega" }]));
await waitFor(() => {
  const row = container.querySelector('[data-row-id="1"]');
  expect(row?.textContent).toContain("Omega");
  expect(row?.getAttribute("data-row-id")).toBe("1");
});
```

- [ ] **Step 7: Run focused tests to verify RED**

Run:

```bash
pnpm --filter @pretable/app-bench exec vitest run src/__tests__/tanstack-adapter.test.tsx --environment jsdom
```

Expected: FAIL before implementation because v9 no longer exports or implements `getCoreRowModel`/`useReactTable`; the new v9 heading assertion must also fail against the old live label.

- [ ] **Step 8: Commit the regressions**

```bash
git add apps/bench/src/__tests__/tanstack-adapter.test.tsx
git commit -m "test(bench): define TanStack v9 adapter contract"
```

### Task 2: Migrate the adapter to the native v9 feature API

**Files:**

- Modify: `apps/bench/src/tanstack-adapter.tsx`
- Test: `apps/bench/src/__tests__/tanstack-adapter.test.tsx`

- [ ] **Step 1: Replace v8 imports and define the static feature set**

Import `columnFilteringFeature`, `createFilteredRowModel`, `createSortedRowModel`, `filterFns`, `rowSortingFeature`, `sortFns`, `tableFeatures`, and `useTable`. Retain `flexRender`, `ColumnDef`, `SortingState`, and `Table`.

Define this once outside the component:

```tsx
const tanstackFeatures = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
});
```

- [ ] **Step 2: Bind column and table types to the feature set**

Change both `ColumnDef<ScenarioRow>` references to `ColumnDef<typeof tanstackFeatures, ScenarioRow>`. Change the table ref to `Table<typeof tanstackFeatures, ScenarioRow> | null`.

- [ ] **Step 3: Remove unused sizing and visibility APIs**

Remove `size` from each column definition. Replace `row.getVisibleCells()` with `row.getAllCells()` because the CSS grid owns widths and the adapter exposes no visibility state.

- [ ] **Step 4: Replace table construction**

Use `useTable` with the static `features` option. Remove all three v8 `get*RowModel` options; core rows are automatic and filtered/sorted row models live in `tanstackFeatures`.

```tsx
const table = useTable({
  features: tanstackFeatures,
  data,
  columns,
  state: { sorting },
  onSortingChange: setSorting,
  getRowId: (row) => String(row.id),
});
```

Update adjacent comments from `useReactTable` to `useTable` without changing the interaction-ref behavior.

- [ ] **Step 5: Update the rendered adapter heading**

Change the heading in `tanstack-adapter.tsx` from `TanStack Table v8` to `TanStack Table v9`. The focused suite introduced in Task 1 now has everything needed to turn green.

- [ ] **Step 6: Run the focused adapter suite to verify GREEN**

Run the Task 1 Vitest command. Expected: all adapter tests pass with no missing filter/sort registry warnings.

- [ ] **Step 7: Run benchmark typecheck and build**

```bash
pnpm --filter @pretable/app-bench typecheck
pnpm --filter @pretable/app-bench build
```

Expected: both exit 0; no missing v8 exports, feature-generic errors, or runtime bundle missing-export errors.

- [ ] **Step 8: Assert the rejected compatibility paths are absent**

```bash
if rg -n '@tanstack/react-table/legacy|stockFeatures' apps/bench/src/tanstack-adapter.tsx; then
  exit 1
fi
```

Expected: exit 0 with no matches.

- [ ] **Step 9: Commit the migration**

```bash
git add apps/bench/src/tanstack-adapter.tsx
git commit -m "fix(bench): migrate TanStack adapter to v9"
```

### Task 3: Align live version labels

**Files:**

- Modify: `apps/bench/src/bench-app.tsx`
- Modify: `apps/website/app/bench/page.tsx`

- [ ] **Step 1: Update the three live labels**

Change the benchmark registry description and website benchmark introduction from “TanStack Table v8” to “TanStack Table v9”. The rendered adapter title already changed with the implementation in Task 2. Do not change the website's later paragraph describing measured v8 results, historical runset comments, research memory, old plans/specs, or milestone data.

- [ ] **Step 2: Verify only live labels changed**

```bash
if rg -n 'TanStack Table v8' \
  apps/bench/src/tanstack-adapter.tsx \
  apps/bench/src/bench-app.tsx; then
  exit 1
fi
rg -n 'TanStack Table v9' \
  apps/bench/src/tanstack-adapter.tsx \
  apps/bench/src/bench-app.tsx \
  apps/website/app/bench/page.tsx
test "$(rg -c 'TanStack Table v8' apps/website/app/bench/page.tsx)" -eq 1
rg -n 'TanStack Table v8 \+ TanStack Virtual runs' \
  apps/website/app/bench/page.tsx
```

Expected: no v8 match in the live adapter/registry, exactly three v9 matches across the live surfaces, and exactly one retained v8 match in the website's historical performance paragraph.

- [ ] **Step 3: Run focused tests and static checks**

```bash
pnpm --filter @pretable/app-bench exec vitest run \
  src/__tests__/tanstack-adapter.test.tsx \
  src/__tests__/bench-app.test.tsx \
  --environment jsdom
pnpm --filter @pretable/app-bench typecheck
pnpm exec eslint apps/bench/src/tanstack-adapter.tsx apps/bench/src/bench-app.tsx
pnpm exec eslint apps/website/app/bench/page.tsx
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit live copy**

```bash
git add \
  apps/bench/src/bench-app.tsx \
  apps/website/app/bench/page.tsx
git commit -m "docs: label TanStack benchmark as v9"
```

### Task 4: Run the complete local release gate

**Files:**

- Verify only; no expected edits.

- [ ] **Step 1: Confirm dependency and scope**

```bash
node -e 'const p=require("./apps/bench/package.json"); if (p.dependencies["@tanstack/react-table"] !== "^9.1.0") process.exit(1)'
rg -n "'@tanstack/react-table@9\.1\.0':" pnpm-lock.yaml
git diff --name-only origin/main...HEAD
```

Expected: manifest range is exactly `^9.1.0`, lockfile resolution is exactly 9.1.0, and branch scope contains the dependency/lock updates, approved spec/plan, adapter tests/implementation, and live-copy files only.

- [ ] **Step 2: Run repository gates independently**

Run each command and stop on the first failure:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm api:check
pnpm lint:packaging
pnpm publish:preflight
pnpm format
git diff --check
git diff --check origin/main...HEAD
```

Expected: every command exits 0. Record known baseline warnings separately; do not suppress or repair unrelated warnings.

- [ ] **Step 3: Review the full branch diff**

Confirm there are no legacy imports, `stockFeatures`, generated build artifacts, unrelated dependency changes, or changes to historical benchmark evidence.

- [ ] **Step 4: Request independent code review**

Use `superpowers:requesting-code-review` with base `origin/main`, head `HEAD`, the approved design, and this plan. Resolve all Critical and Important findings, then rerun affected gates.

### Task 5: Update PR #277 and merge on green

**Files:**

- GitHub operations only.

- [ ] **Step 1: Push the exact local graph to the Dependabot branch**

```bash
git push origin HEAD:dependabot/npm_and_yarn/tanstack/react-table-9.0.1
```

Expected: normal fast-forward push; do not force-push.

- [ ] **Step 2: Update the PR metadata**

```bash
gh pr edit 277 \
  --title "chore(bench): migrate TanStack Table to v9" \
  --body-file - <<'EOF'
## Summary

- upgrade the benchmark adapter to `@tanstack/react-table` 9.1.0
- use the native v9 feature API while preserving sort, filter, update, selector, and virtualization behavior
- update live benchmark labels to v9 while retaining historical v8 runset descriptions

## Verification

- focused adapter and benchmark tests
- repository test, typecheck, lint, build, API, packaging, publish-preflight, format, and diff gates
EOF
```

- [ ] **Step 3: Verify PR scope and head**

Confirm PR #277's head equals local `HEAD`, the diff is limited to the approved files, and the title/body describe the native v9 migration.

- [ ] **Step 4: Monitor all PR checks before merging**

Wait for every check associated with the verified head to reach a terminal state. Typecheck, lint, format, tests, build, API freshness, packaging, Publish preflight, CodeQL, and the external Vercel status must succeed. The repository's internal Vercel-preview and Playwright-preview jobs intentionally skip Dependabot-authored PRs; verify they are skipped for that reason rather than treating them as failures.

If GitHub marks bot-authored workflows `action_required`, approve only the exact workflow runs for the verified PR head. If any check fails, use `github:gh-fix-ci` and `superpowers:systematic-debugging`; do not merge around a failure.

- [ ] **Step 5: Squash-merge the verified green head**

```bash
head_sha=$(git rev-parse HEAD)
gh pr merge 277 --squash --match-head-commit "$head_sha"
```

Do not enable auto-merge before the complete check set is terminal. The head-match guard must reject the merge if the remote branch changes after verification.

- [ ] **Step 6: Verify the merge**

Record the squash merge SHA and confirm PR #277 merged only after every required check passed.

### Task 6: Verify post-merge health and continue triage

**Files:**

- Read-only verification.

- [ ] **Step 1: Monitor same-commit workflows**

Wait for main CI, Release, CodeQL, and OpenSSF workflows for the merge SHA. Confirm the production Vercel deployment and production Playwright smoke complete successfully.

- [ ] **Step 2: Verify release behavior**

Because this migration changes private applications only and includes no Changeset, confirm the Release workflow creates no package-version PR and publishes no public package version.

- [ ] **Step 3: Report final state**

Report local gate totals, PR checks, merge SHA, post-merge workflows, production smoke result, any nonfatal known warnings, and the next open actionable repository item. Do not clean up the worktree until all GitHub monitoring is terminal.
