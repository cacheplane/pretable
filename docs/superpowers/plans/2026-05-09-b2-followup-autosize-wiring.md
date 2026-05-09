# B2 Follow-up #3 — Autosize Wiring Implementation Plan

**Goal:** Wire `autosize` end-to-end through the bench harness; add comparator-parity hypothesis `H22`; re-run the full B2 matrix with autosize included.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-09-b2-followup-autosize-wiring-design.md`. Single PR on `b2-followup-3-autosize`; auto-merge on green.

**Tech Stack:** TypeScript, React 19, Vitest, Playwright (Chromium), pnpm workspaces. No new dependencies.

---

## File Structure

```
apps/bench/src/
├── query-state.ts                   (MODIFY: add "autosize" to script allowlist)
├── bench-types.ts                   (MODIFY: extend Extract narrow with "autosize")
├── bench-runtime.ts                 (MODIFY: add measureBenchAutosizeRun helper)
├── bench-app.tsx                    (MODIFY: autosizeApiRef + dispatch + handleAutosizeApiReady)
├── pretable-adapter.tsx             (MODIFY: onAutosizeReady prop wiring grid.autosizeColumns)
├── ag-grid-adapter.tsx              (MODIFY: onAutosizeReady prop using gridApi.autoSizeAllColumns)
├── mui-adapter.tsx                  (MODIFY: onAutosizeReady prop using apiRef.autosizeColumns)
└── __tests__/
    └── bench-runtime.test.ts        (MODIFY: tests for measureBenchAutosizeRun)

packages/bench-runner/src/
└── index.ts                         (MODIFY: add "autosize" to supportedScripts allowlist)

scripts/
├── bench-matrix.mjs                 (MODIFY: evaluateH22 + register in createHypothesisReport)
└── __tests__/bench-matrix.test.mjs  (MODIFY: H22 tests)

status/milestones/
└── 2026-05-09-b2-with-autosize.hypotheses.json  (NEW: matrix re-run output)

docs/research/
└── repo-memory.md                   (MODIFY: 2026-05-09 entry — autosize wired, H22 result)
```

---

## Tasks

### Task 1 — Add autosize to type/parser allowlists

- [ ] **1.1** `apps/bench/src/query-state.ts` — extend the `script` parser branch to accept `"autosize"`.
- [ ] **1.2** `apps/bench/src/bench-types.ts` — extend the `Extract<BenchScriptName, ...>` narrow with `"autosize"`.
- [ ] **1.3** `packages/bench-runner/src/index.ts` — add `"autosize"` to the `supportedScripts` array inside `validateSupportedP0aRequest`. Per the B2 spec, supported on `pretable | ag-grid | mui`; tanstack falls through to unsupported.
- [ ] **1.4** Typecheck:
  ```bash
  pnpm --filter @pretable-internal/bench-runner typecheck
  pnpm --filter @pretable/app-bench typecheck
  ```
- [ ] **1.5** Commit `feat(bench-runner): accept autosize script through harness pipeline`.

### Task 2 — measureBenchAutosizeRun helper

- [ ] **2.1** Read existing helpers (`measureBenchKeySequenceRun`) for shape; mirror.
- [ ] **2.2** Append to `apps/bench/src/bench-runtime.ts`:

```ts
export interface AutosizeBenchRunResult {
  status: "completed" | "partial" | "failed";
  notes: string[];
  metrics: { interaction_latency_ms?: number };
}

export async function measureBenchAutosizeRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  autosize: (() => Promise<void> | void) | null,
): Promise<AutosizeBenchRunResult> {
  if (!autosize) {
    return {
      status: "partial",
      notes: [`script: autosize`, `no autosize callback registered for ${adapterId}`],
      metrics: {},
    };
  }
  const profile = scrollRuntimeProfiles[adapterId];
  const viewport = await waitForScrollViewport(root, profile.viewportSelector);
  if (!viewport) {
    return {
      status: "partial",
      notes: [`script: autosize`, `viewport unavailable for ${adapterId}`],
      metrics: {},
    };
  }
  await waitForAnimationFrame();
  const start = performance.now();
  await autosize();
  await waitForAnimationFrame();
  const elapsed = performance.now() - start;
  return {
    status: "completed",
    notes: [`script: autosize`],
    metrics: { interaction_latency_ms: elapsed },
  };
}
```

- [ ] **2.3** Add tests in `apps/bench/src/__tests__/bench-runtime.test.ts`:
  - `measureBenchAutosizeRun calls the supplied autosize callback and returns latency`
  - `measureBenchAutosizeRun returns partial when no callback is registered`
- [ ] **2.4** Typecheck + run tests.
- [ ] **2.5** Commit `feat(bench): measureBenchAutosizeRun helper for autosize script`.

### Task 3 — Wire onAutosizeReady on adapters + bench-app

- [ ] **3.1** Each adapter accepts `onAutosizeReady?: (autosize: () => Promise<void> | void) => void`.
  - `pretable-adapter.tsx`: in `onGridReady`, call `onAutosizeReady?.(() => grid.autosizeColumns())`.
  - `ag-grid-adapter.tsx`: in the existing `onGridReady` block, call `onAutosizeReady?.(() => event.api.autoSizeAllColumns(false))`. Remove the existing `if (scriptName === "autosize")` block (now handled by the bench-app dispatch instead of pre-emptive autosize at mount).
  - `mui-adapter.tsx`: capture `apiRef` via MUI's `useGridApiRef()`; pass to `<DataGrid apiRef={...} />`; in a `useEffect` keyed on `[runKey]`, call `onAutosizeReady?.(async () => apiRef.current.autosizeColumns({ includeOutliers: true }))`.
- [ ] **3.2** `bench-app.tsx`:
  - Add `autosizeApiRef = useRef<(() => Promise<void> | void) | null>(null)`.
  - Add `handleAutosizeApiReady = useCallback((autosize) => { autosizeApiRef.current = autosize; }, [])`.
  - Pass `onAutosizeReady={handleAutosizeApiReady}` to each adapter render.
  - In the `executeRun` dispatch chain, add an autosize branch:
    ```ts
    const autosizeRun =
      scriptName === "autosize"
        ? await measureBenchAutosizeRun(
            viewportRef.current ?? document.body,
            query.adapterId,
            autosizeApiRef.current,
          )
        : null;
    ```
  - Extend the `nextResult` ternary with an autosize branch that consumes `autosizeRun.metrics` + `notes`.
- [ ] **3.3** Typecheck + repo-wide tests.
- [ ] **3.4** Commit `feat(bench): wire onAutosizeReady on pretable/ag-grid/mui adapters`.

### Task 4 — evaluateH22 with min-repeat gate

- [ ] **4.1** Read `evaluateH1` in `scripts/bench-matrix.mjs` (the comparator-parity + min-repeat gate is the model).
- [ ] **4.2** Add `evaluateH22(runs)` that:
  - Finds `pretable / S2 / autosize` series.
  - If empty → `insufficient`.
  - If `interaction_latency_ms > 16` → `failing` (single-frame floor).
  - Finds best of `ag-grid / mui` autosize series. If none → `directional`.
  - Computes `parityRatio = pretable.latency / bestComparator.latency`.
  - If ratio in `[0.9, 1.2]` AND either `sampleCount < 10` → `insufficient` with re-run guidance.
  - If ratio > 1.1 → `failing` with parity message.
  - Else → `satisfied`.

  Reuse the constant `COMPARATOR_PARITY_MIN_REPEATS = 10` already in the file (defined inside `evaluateH1`). Hoist it to a module-level constant if cleaner, otherwise duplicate with a comment.

- [ ] **4.3** Register `evaluateH22(input.runs)` in `createHypothesisReport`'s evaluator array.
- [ ] **4.4** Tests in `scripts/__tests__/bench-matrix.test.mjs`:
  - `evaluateH22 satisfied when pretable autosize at parity with mui`
  - `evaluateH22 failing when pretable autosize > 16ms`
  - `evaluateH22 failing when pretable parity > 110% outside tight zone`
  - `evaluateH22 insufficient when tight zone and < 10 repeats`
  - `evaluateH22 insufficient when no pretable runs`
- [ ] **4.5** Run matrix tests.
- [ ] **4.6** Commit `feat(bench-matrix): evaluateH22 autosize comparator-parity hypothesis`.

### Task 5 — Re-run B2 matrix with autosize

- [ ] **5.1** Build the harness:
  ```bash
  pnpm --filter @pretable/app-bench build
  ```
- [ ] **5.2** Run the matrix:
  ```bash
  pnpm bench:matrix \
    --project=chromium \
    --adapters=pretable,ag-grid,tanstack,mui \
    --scenarios=S2 \
    --scripts=initial,scroll,sort,filter-text,filter-metadata,updates,autosize,select-range-extend,keyboard-nav-row,select-all,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
    --scale=hypothesis \
    --repeats=3
  ```
  Expected wall-clock: ~5 min.
- [ ] **5.3** Inspect `status/runsets/<id>/hypotheses.json`. Confirm:
  - All previously satisfied hypotheses remain satisfied (no regressions).
  - `H22` entry exists. Likely `insufficient` due to the n=3 tight-zone gate; that's the correct outcome — document in repo-memory and recommend a 10-repeat follow-up if needed.
  - If anything else flips unexpectedly, STOP and surface to the user.
- [ ] **5.4** Copy the hypotheses report to `status/milestones/2026-05-09-b2-with-autosize.hypotheses.json`. The original `2026-05-08-b2-comparative-bench.hypotheses.json` stays untouched.
- [ ] **5.5** Append a 2026-05-09 entry to `docs/research/repo-memory.md` covering:
  - Autosize wired end-to-end.
  - H22 evaluator added (parity + min-repeat gate).
  - Matrix re-run committed; H22 status from the runset.
  - autosize gap from the prior 2026-05-08 entry now resolved.
- [ ] **5.6** Commit:
  ```
  git add status/milestones/2026-05-09-b2-with-autosize.hypotheses.json docs/research/repo-memory.md
  git commit -m "chore(bench): B2 matrix re-run with autosize; H22 evaluated"
  ```

### Task 6 — Gates + PR

- [ ] **6.1** Run repo-wide gates:
  ```bash
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```
- [ ] **6.2** Push branch.
- [ ] **6.3** Open PR with auto-merge. Body sections: Summary, autosize matrix entry table, H22 status, what's NOT in this PR (column-width fidelity, post-autosize scroll measurement, 20-repeat re-run if H22 is insufficient).

---

## Self-review

- Spec coverage: every spec section maps to a task ✓ (metric → Task 2; per-adapter wiring → Task 3; type allowlists → Task 1; H22 → Task 4; matrix re-run → Task 5; risks documented inline).
- No placeholders.
- Type consistency: `onAutosizeReady` signature `(autosize: () => Promise<void> | void) => void` consistent across Tasks 2, 3.
- Scope: single PR, roughly 7 commits-of-record, ~10 min matrix run. Auto-mergeable.
