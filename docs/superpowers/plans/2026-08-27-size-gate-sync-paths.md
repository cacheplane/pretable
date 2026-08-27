# Size-gate the synchronous filter/sort paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Row-count-gate the synchronous sort/filter fast paths (sync at or below a measured per-path limit, cooperative above) so no measured script ships a main-thread block over the arc's 50 ms bar (issue #488).

**Architecture:** One dispatch-condition edit in `setQuery`'s `fastPath` selection reading `root.rows.size` from the committed root, two `@internal` injectable limit options for tests, defaults fixed by a browser long-task sweep at intermediate row counts. Cooperative path untouched.

**Tech Stack:** TypeScript, Vitest, Playwright bench harness, api-extractor.

**Spec:** `docs/superpowers/specs/2026-08-27-size-gate-sync-paths-design.md` — READ FIRST. Line refs from the #488 exploration map at `015a84a7`; re-locate by content.

---

### Task 1: Browser threshold sweep (measurement only — NOTHING from this task is committed except the results doc later)

Performed by the controller (measurement-protocol discipline). For each size in {10 000, 15 000, 20 000, 30 000}:

- [ ] Patch `packages/scenario-data/src/index.ts` `scenarioScaleRowCounts.S2.hypothesis` to the size (LOCAL ONLY — verify `git status` shows it and REVERT after the sweep).
- [ ] `pnpm bench:matrix --adapters=pretable --scenarios=S2 --scale=hypothesis --repeats=3 --scripts=sort,filter-metadata > /tmp/sweep-<size>.log 2>&1` (matrix rebuilds scenario-data + bench via prepare:deps; check exit 0; `lsof -i :4173` first).
- [ ] From each summary record `post_interaction_long_tasks_ms`, `post_interaction_long_tasks_count`, `settle_duration_ms`, `interaction_latency_ms`, `rowCount` (verify the patch took).
- [ ] After the sweep: `git checkout -- packages/scenario-data/src/index.ts`, rebuild once (`pnpm --filter '@pretable/app-bench^...' build`).
- [ ] Apply the spec's selection rule (largest size with block ≤ 25 ms, round down) → `SORT_LIMIT_DEFAULT`, `FILTER_LIMIT_DEFAULT`. Record the raw table + the node engine curve in the results doc draft.

### Task 2: The gate + injectable limits + tests (row-model)

**Files:**
- Modify: `packages/row-model/src/create-local-row-model.ts` (options interface ~172–178; `fastPath` selection ~1286–1299)
- Test: `packages/row-model/src/__tests__/filter-fast-path.test.ts`, `packages/row-model/src/__tests__/sort-fast-path.test.ts`

- [ ] **Step 1: Failing tests.** In each fast-path test file add a `describe("size gate", ...)` using the file's existing fixtures/helpers (ROOT_ROWS ~5 rows, scoreQuery, recording scheduler). With `ɵfilterFastPathRowLimit` (resp. `ɵsortFastPathRowLimit`) injected:

```ts
test("a filter-only change at the limit stays synchronous", () => {
  // 5 fixture rows, limit 5: == limit is SYNC (≤, not <).
  const scheduler = createRecordingScheduler(); // reuse the file's helper
  const model = createLocalRowModel({
    rows: ROOT_ROWS, columns: createColumns(), query: scoreQuery("gte", 0),
    getRowId: (row) => row.id,
    transitionScheduler: scheduler,
    ɵfilterFastPathRowLimit: ROOT_ROWS.length,
  });
  model.setQuery(scoreQuery("gte", 40));
  expect(scheduler.entries).toHaveLength(0);            // no cooperative task
  expect(snapshotIds(model)).toEqual([...FILTERED_ORDER]); // behavior survives
  // journal barrier "refilter" — copy the existing journal pin's mechanism
});

test("a filter-only change above the limit goes cooperative and still filters", async () => {
  const scheduler = createRecordingScheduler();
  const model = createLocalRowModel({
    rows: ROOT_ROWS, columns: createColumns(), query: scoreQuery("gte", 0),
    getRowId: (row) => row.id,
    transitionScheduler: scheduler,
    ɵfilterFastPathRowLimit: ROOT_ROWS.length - 1,      // limit+1 == rows
  });
  const transition = model.setQuery(scoreQuery("gte", 40));
  expect(scheduler.entries.length).toBeGreaterThan(0);  // cooperative task queued
  scheduler.flushAll();
  await transition.finished;
  expect(snapshotIds(model)).toEqual([...FILTERED_ORDER]); // OLD behavior survives
  // journal barrier is the cooperative default "bulk-replace" — pin it
});
```

Mirror both for sort in `sort-fast-path.test.ts` (`"reorder"` vs `"bulk-replace"`). Add:
- widening-filter twin: start FILTERED (few visible), widen above the limit — must go cooperative (kills a `visible.rows.size` gate mutation; the fixture needs `rows.size > limit` but `visible.rows.size ≤ limit`).
- grouped pin: `ɵfilterFastPathRowLimit: Number.MAX_SAFE_INTEGER` + a rowGroups change → still cooperative.
- defaults pin: export the two default constants (e.g. `FILTER_FAST_PATH_ROW_LIMIT_DEFAULT`) and assert their exact values, so a silent change fails a test.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pretable-internal/row-model test 2>&1 | tail -8`. Expected: FAIL (unknown option / sync taken above limit).

- [ ] **Step 3: Implement.** In `create-local-row-model.ts`:
  - Options (siblings of `transitionBudgetMs`, `@internal`, tsdoc WITHOUT `{@link}` on ɵ names):

```ts
  /** @internal Resident-row ceiling for the synchronous sort fast path;
   *  above it a sort-only change takes the cooperative transition. The
   *  default is measured against the arc's 50ms single-block bar (see
   *  docs/superpowers/specs/2026-08-27-size-gate-sync-paths-design.md). */
  ɵsortFastPathRowLimit?: number;
  /** @internal Same gate for the filter-only fast path. */
  ɵfilterFastPathRowLimit?: number;
```

  - Defaults from Task 1 (exported constants with a WHY-comment naming the sweep).
  - The dispatch edit — gate INSIDE the existing ternary, after the grouped arm, reading the committed root before any cancel:

```ts
const residentRows = root.rows.size;
const fastPath =
  nextPlan.query.rowGroups.length > 0
    ? undefined
    : isSortOnlyChange(queryPlan, nextPlan)
      ? residentRows <= sortFastPathRowLimit
        ? Object.freeze({ rebuild: rebuildRootForSortOnlyChange, barrierReason: "reorder" as const })
        : undefined
      : isFilterOnlyChange(queryPlan, nextPlan)
        ? residentRows <= filterFastPathRowLimit
          ? Object.freeze({ rebuild: rebuildRootForFilterOnlyChange, barrierReason: "refilter" as const })
          : undefined
        : undefined;
```

  (Match the file's real structure; keep the comment above it that explains the shared commit shape, and extend it with the gate rationale + bar reference.)

- [ ] **Step 4: Run tests to verify pass** — full `pnpm --filter @pretable-internal/row-model test` (all ~650), plus `pnpm --filter @pretable-internal/row-model lint` and prettier check. Then the downstream suites: `pnpm --filter @pretable/react test 2>&1 | tail -6` (expect green; 1–2 random timeouts under load are a known flake — re-run once before believing).

- [ ] **Step 5: Commit** — `feat(row-model): size-gate the sync sort/filter fast paths (#488)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

### Task 3: api report + full build

- [ ] `pnpm build > /tmp/gate-build.log 2>&1 && pnpm api > /tmp/gate-api.log 2>&1; echo exit: $?` (build BEFORE api — stale dist silently strips exports). Commit any `.api.md` drift for the internal row-model report with the code that caused it. Root `pnpm -r lint`.

### Task 4: Bench certification (controller)

- [ ] 3k round: `pnpm bench:matrix --adapters=pretable,tanstack --scenarios=S2 --scale=hypothesis --repeats=3 --scripts=sort,filter-metadata,filter-text,filter-keystrokes` → all sync-path numbers unchanged within a frame vs the #489 round; long tasks unchanged.
- [ ] 50k round: same command `--scale=target` → `post_interaction_long_tasks_ms` ≈ 0/below-floor on sort + filter scripts (bar MET), zero blank frames, settle + keystroke warm giveback recorded, TanStack controls in band.
- [ ] Any cell violating expectations: STOP, diagnose (two rounds if cells disagree), do not rationalize.

### Task 5: Results doc + PR

- [ ] `docs/superpowers/specs/2026-08-27-size-gate-sync-paths-results.md`: sweep table (browser + node curves), chosen limits + rule, certification tables, giveback statement, fitness note (load, controls).
- [ ] Prettier the docs. Push, PR titled `feat(row-model): size-gate the sync sort/filter fast paths (closes #488)`, auto-merge, verify merged via `gh pr view` before recording anywhere.
