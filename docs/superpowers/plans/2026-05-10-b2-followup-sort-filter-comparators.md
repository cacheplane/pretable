# B2 Follow-up #5b — Sort + Filter Comparator Wiring

**Goal:** Open the `sort` / `filter-text` / `filter-metadata` gate in `validateSupportedP0aRequest` for ag-grid + tanstack + mui, wire each comparator adapter to apply the bench's `BenchInteractionPlan` via its native library API, re-run the matrix, and capture comparator data for H6/H7/H8.

**Architecture:** Each comparator adapter accepts an `interactionPlan?: BenchInteractionPlan | null` prop. A `useEffect` keyed on the plan calls the library's native sort/filter API. `bench-app.tsx`'s existing dispatch chain extends to call `measureBenchInteractionRun` for non-pretable adapters as well, using DOM-default state-reading (no telemetry override needed for comparators).

**Tech Stack:** Existing libraries — `ag-grid-react@33` `applyColumnState` / `setFilterModel`; `@tanstack/react-table@8` `setSorting` / `setColumnFilters`; `@mui/x-data-grid@7` `apiRef.current.setSortModel` / `setFilterModel`.

**Spec context:** Per the B2 design (section "Documented unsupported matrix"), all four adapters support sort + filter-text + filter-metadata natively. The Slab 1 gate that kept these pretable-only is the only blocker.

---

## File Structure

```
packages/bench-runner/src/
├── index.ts                            (MODIFY: open interactionScripts gate to comparators on S2/S7)
└── __tests__/bench-runner.test.ts      (MODIFY: positive + regression assertions for comparator interaction)

apps/bench/src/
├── ag-grid-adapter.tsx                 (MODIFY: accept interactionPlan; useEffect → applyColumnState / setFilterModel)
├── tanstack-adapter.tsx                (MODIFY: accept interactionPlan; useEffect → setSorting / setColumnFilters)
├── mui-adapter.tsx                     (MODIFY: accept interactionPlan; useEffect → apiRef.setSortModel / setFilterModel)
└── bench-app.tsx                       (MODIFY: pass interactionPlan to comparator adapters; widen the
                                          interactionRun dispatch to non-pretable; drop the pretable-only
                                          gate around measureBenchInteractionRun)

scripts/__tests__/bench-matrix.test.mjs (REGEN: re-run, no source changes; existing H6/H7/H8 evaluators
                                          may surface comparator data through the standard interaction
                                          summarization path)

status/milestones/2026-05-10-b2-sort-filter-comparators.hypotheses.json  (NEW: matrix re-run output)

docs/research/repo-memory.md            (MODIFY: 2026-05-10 entry — sort + filter gate opened, H6-H8 status)
```

---

## Tasks

### Task 1 — Open the gate

- [ ] **1.1** `packages/bench-runner/src/index.ts` — find the `if (interactionScripts.includes(request.scriptName))` block (currently rejects non-pretable). Replace with: scenario gate only (S2 or S7); allow all four adapters.
- [ ] **1.2** Update the gate's failure reason to mention scenario, not adapter.
- [ ] **1.3** Update tests in `packages/bench-runner/src/__tests__/bench-runner.test.ts`:
  - Replace existing assertions that comparator + sort returns `{ ok: false }` with positive assertions that all four adapters can run sort/filter-metadata/filter-text on S2.
  - Keep the "scenario S5 rejects sort" assertion.
- [ ] **1.4** Typecheck + run bench-runner tests.
- [ ] **1.5** Commit `feat(bench-runner): open sort/filter scripts to comparator adapters`.

### Task 2 — AG Grid sort/filter wiring

- [ ] **2.1** `apps/bench/src/ag-grid-adapter.tsx` — add `interactionPlan?: BenchInteractionPlan | null` to `AgGridAdapterProps`.

  Import: `import type { BenchInteractionPlan } from "./interaction-plan";`

- [ ] **2.2** In `AgGridAdapter`, add a `useEffect` keyed on `[interactionPlan, runKey]` that, when `interactionPlan` is non-null AND the grid api is ready, applies sort or filter:

  ```tsx
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort) {
      api.applyColumnState({
        state: [
          {
            colId: interactionPlan.sort.columnId,
            sort: interactionPlan.sort.direction,
          },
        ],
        defaultState: { sort: null },
      });
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text"
    ) {
      const model: Record<string, unknown> = {};
      for (const [colId, value] of Object.entries(interactionPlan.filters)) {
        model[colId] = {
          filterType: "text",
          type:
            interactionPlan.mode === "filter-metadata" ? "equals" : "contains",
          filter: value,
        };
      }
      api.setFilterModel(model);
    }
  }, [interactionPlan, runKey]);
  ```

- [ ] **2.3** Typecheck.
- [ ] **2.4** Commit `feat(bench): AG Grid adapter applies BenchInteractionPlan via applyColumnState + setFilterModel`.

### Task 3 — TanStack sort/filter wiring

- [ ] **3.1** `apps/bench/src/tanstack-adapter.tsx` — capture the table instance via a ref so a useEffect can read it. The adapter currently creates the table via `useReactTable`; expose it via a ref so the interaction useEffect can call `table.setSorting` / `table.setColumnFilters`.

- [ ] **3.2** Add `interactionPlan?: BenchInteractionPlan | null` prop. In a `useEffect` keyed on `[interactionPlan, runKey]`:

  ```tsx
  useEffect(() => {
    const t = tableRef.current;
    if (!t || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort) {
      t.setSorting([
        {
          id: interactionPlan.sort.columnId,
          desc: interactionPlan.sort.direction === "desc",
        },
      ]);
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text"
    ) {
      const filters = Object.entries(interactionPlan.filters).map(
        ([id, value]) => ({ id, value }),
      );
      t.setColumnFilters(filters);
    }
  }, [interactionPlan, runKey]);
  ```

- [ ] **3.3** Verify each column has `enableColumnFilter: true` and a default filterFn. TanStack v8 default is `auto` which uses `includesString` for strings. For `filter-metadata` (equals match) you may need to set `filterFn: "equalsString"` on the relevant column. Check `apps/bench/src/tanstack-adapter.tsx`'s existing `toColumnDef` and add filterFn handling driven by columnId from the plan if needed.

- [ ] **3.4** Typecheck.
- [ ] **3.5** Commit `feat(bench): TanStack adapter applies BenchInteractionPlan via setSorting + setColumnFilters`.

### Task 4 — MUI sort/filter wiring

- [ ] **4.1** `apps/bench/src/mui-adapter.tsx` — `apiRef` is already exposed (post-PR #127). Add `interactionPlan?: BenchInteractionPlan | null` prop.

- [ ] **4.2** In a `useEffect` keyed on `[interactionPlan, runKey]`:

  ```tsx
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort) {
      api.setSortModel([
        {
          field: interactionPlan.sort.columnId,
          sort: interactionPlan.sort.direction,
        },
      ]);
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text"
    ) {
      const items = Object.entries(interactionPlan.filters).map(
        ([field, value]) => ({
          field,
          operator: interactionPlan.mode === "filter-metadata" ? "equals" : "contains",
          value,
        }),
      );
      api.setFilterModel({ items });
    }
  }, [interactionPlan, runKey]);
  ```

- [ ] **4.3** Typecheck.
- [ ] **4.4** Commit `feat(bench): MUI adapter applies BenchInteractionPlan via apiRef.setSortModel + setFilterModel`.

### Task 5 — bench-app dispatch

- [ ] **5.1** `apps/bench/src/bench-app.tsx` — in the existing `interactionRun` block (around line 196–226), DROP the `query.adapterId === "pretable"` gate. Each adapter now handles its own plan application via `interactionPlan` prop.

- [ ] **5.2** The `measureBenchInteractionRun` call's `readInteractionStateOverride` parameter is pretable-specific (uses telemetry). For comparators, pass `undefined` so the runtime falls back to DOM-default reading. Wrap conditionally:

  ```ts
  const interactionRun =
    scriptName === "sort" ||
    scriptName === "filter-metadata" ||
    scriptName === "filter-text"
      ? await (() => {
          const nextInteractionPlan = createBenchInteractionPlan(
            dataset,
            scriptName,
          );
          if (!nextInteractionPlan) return Promise.resolve(null);
          return measureBenchInteractionRun(
            viewportRef.current ?? document.body,
            query.adapterId,
            scriptName,
            nextInteractionPlan,
            query.adapterId === "pretable"
              ? () =>
                  createBenchInteractionStateFromTelemetry(
                    pretableTelemetryRef.current,
                    dataset.rows.length,
                  )
              : undefined,
            () => {
              setInteractionPlanOverride({
                plan: nextInteractionPlan,
                search,
              });
            },
          );
        })()
      : null;
  ```

- [ ] **5.3** Pass `interactionPlan={interactionPlan}` to ALL four adapters in the AdapterSurface render block. The pretable adapter already does this; ag-grid/tanstack/mui need the prop wired.

- [ ] **5.4** Typecheck + run bench-app tests (vitest).

- [ ] **5.5** Commit `feat(bench): dispatch interaction scripts to comparator adapters`.

### Task 6 — Re-run matrix

- [ ] **6.1** Build the harness:
  ```
  pnpm --filter @pretable/app-bench build
  ```

- [ ] **6.2** Run matrix:
  ```
  pnpm bench:matrix \
    --project=chromium \
    --adapters=pretable,ag-grid,tanstack,mui \
    --scenarios=S2 \
    --scripts=sort,filter-metadata,filter-text \
    --scale=hypothesis \
    --repeats=3
  ```
  Expected wall-clock: ~2 min (3 scripts × 4 adapters × 3 repeats = 36 runs).

- [ ] **6.3** Inspect `status/runsets/<id>/hypotheses.json`. H6, H7, H8 may flip status now that comparator data is available. Outcomes:
  - **Still satisfied:** ship as-is.
  - **Now failing:** that's the news — do NOT modify thresholds. Document in repo-memory.
  - **Now directional:** comparator beats pretable; document.

- [ ] **6.4** Copy to `status/milestones/2026-05-10-b2-sort-filter-comparators.hypotheses.json`.

- [ ] **6.5** If a run produces unexpected `partial` status or harness failure, STOP and report BLOCKED with details — don't paper over with retries.

### Task 7 — Repo-memory + PR

- [ ] **7.1** Append a 2026-05-10 entry to `docs/research/repo-memory.md` covering:
  - The gate-opening + per-adapter wiring summary.
  - Per-adapter sort + filter latency table (n=3 medians from the matrix).
  - Hypothesis status delta for H6/H7/H8.
  - Note that this closes the structural part of B2 follow-up #5; only narrative-cleanup follow-ups remain.

- [ ] **7.2** Repo-wide gates: `pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format`.

- [ ] **7.3** Commit, push, open PR with auto-merge (squash). PR body covers: scope, per-adapter wiring summary, hypothesis status delta, comparator latency table, what's NOT in the PR.

---

## Self-review

- Spec coverage: gate opening (Task 1), per-adapter library wiring (Tasks 2/3/4), bench-app dispatch (Task 5), matrix re-run (Task 6), narrative (Task 7). ✓
- No placeholders.
- Type consistency: `interactionPlan` prop is consistent across all four adapters; the trigger pattern (useEffect on `[interactionPlan, runKey]`) is uniform.
- Scope: single PR. May flip H6/H7/H8 if comparators beat pretable (acceptable; ship the truth). Auto-merge OK because it's primarily harness wiring + evidence — no editorial prose.

## Risks

- **Library filterModel API differences.** AG Grid uses `{ filterType, type, filter }` shape; MUI uses `{ items: [{ field, operator, value }] }`; TanStack uses raw `(id, value)` pairs. The plan's filter values are simple strings ("running", "Bonjour") so all three should work, but TanStack v8's default `filterFn: "auto"` may not match metadata-equals exactly. If TanStack filter result counts come back wrong, set `filterFn: "equalsString"` on the metadata column explicitly in `toColumnDef`.

- **AG Grid `setFilterModel` is async**: the filter applies on the next gridApi event-loop turn. The `measureBenchInteractionRun` helper's settle-frame loop should handle this since it watches the visible-row signature change.

- **MUI's `setSortModel` triggers a state update that causes a React re-render**, which the bench-runtime should pick up via DOM mutation observation. The default DOM state-reading should work.

- **TanStack `setColumnFilters` accepts an array — a fresh array replaces the existing filters.** Not additive; matches the bench's expected behavior of one-filter-at-a-time.

- **Per-script timing**: filter-text on tanstack at hypothesis scale (3000 rows × wrapped text) may exceed the existing 96-frame budget for filter-text in `getMaxInteractionFrames`. If runs come back partial with "settle frames exhausted", that's a real performance signal — ship it as failing/directional, don't extend the budget.
