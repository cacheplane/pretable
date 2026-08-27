# Filter-keystrokes bench script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `filter-keystrokes` bench script that applies N successive narrowing filter commits (filter-as-you-type) and reports the per-commit latency distribution with the cold first commit separated from the warm rest (issue #489).

**Architecture:** The script joins the existing interaction family (S2/S7, all four adapters). A plan builder derives the surviving keystroke steps from the dataset (dropping steps that don't move the row count — the settle latch needs a count change); a new measurement helper loops the existing `measureRowSetChange` frame loop once per step; dispatch publishes successive interaction plans through the same `setInteractionPlanOverride` trigger the single-commit scripts use. Five new metrics carry the cold/warm split. No hypothesis evaluator, no budgets, no website publication (see the design doc).

**Tech Stack:** TypeScript, React, Vitest (jsdom), Playwright, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-27-filter-keystrokes-bench-design.md` — READ IT FIRST. The exploration map's line numbers there and here were taken at `a29298a0`; re-locate by content if drifted.

**Repo rules that bite here:**
- Rebuild `@pretable-internal/bench-runner` before testing `@pretable/app-bench` (`pnpm --filter '@pretable/app-bench^...' build` — the app reads `dist/`).
- NEVER pipe gate/bench output through `grep|head` — SIGPIPE kills the gate. Redirect to a file, check exit code, then read the file.
- `lsof -i :4173` before starting any preview server; if held, do NOT kill the holder (parallel sessions) — stop and report.
- Commit per task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: bench-runner contract (script name + metrics + required-metrics)

**Files:**
- Modify: `packages/bench-runner/src/index.ts`
- Test: `packages/bench-runner/src/__tests__/bench-runner.test.ts`

- [ ] **Step 1: Write the failing tests** — in `bench-runner.test.ts`, extend the existing exact-list assertions (metric-id list around line 58, script list around 67–90) to include the new entries, and add:

```ts
test("filter-keystrokes is a supported interaction script on S2 and S7 for every adapter", () => {
  for (const adapterId of ["pretable", "tanstack", "ag-grid", "mui"] as const) {
    for (const scenarioId of ["S2", "S7"] as const) {
      expect(
        validateSupportedP0aRequest(
          createRequest({ adapterId, scenarioId, scriptName: "filter-keystrokes" }),
        ),
      ).toEqual({ ok: true });
    }
  }
});

test("filter-keystrokes rejects non-interaction scenarios", () => {
  const result = validateSupportedP0aRequest(
    createRequest({ scenarioId: "S1", scriptName: "filter-keystrokes" }),
  );
  expect(result.ok).toBe(false);
});

test("a completed filter-keystrokes run requires the keystroke distribution metrics", () => {
  const metrics = {
    ...COMPLETED_INTERACTION_METRICS, // reuse/extract the fixture the sort/filter tests use
    keystroke_commits_observed: 6,
    keystroke_first_total_ms: 120,
    keystroke_warm_total_p50_ms: 40,
    keystroke_warm_total_p95_ms: 60,
    keystroke_warm_total_max_ms: 62,
  };
  expect(() =>
    createBenchRunSummary({
      request: createRequest({ scriptName: "filter-keystrokes", scenarioId: "S2" }),
      status: "completed", timestamp: TS, tracePath: "t", metrics,
    }),
  ).not.toThrow();
  for (const missing of [
    "keystroke_commits_observed", "keystroke_first_total_ms",
    "keystroke_warm_total_p50_ms", "keystroke_warm_total_p95_ms",
    "keystroke_warm_total_max_ms", "interaction_latency_ms",
  ] as const) {
    const { [missing]: _dropped, ...rest } = metrics;
    expect(() =>
      createBenchRunSummary({
        request: createRequest({ scriptName: "filter-keystrokes", scenarioId: "S2" }),
        status: "completed", timestamp: TS, tracePath: "t", metrics: rest,
      }),
    ).toThrow(`Missing required metric: ${missing}`);
  }
});
```

Adapt `createRequest`/fixture names to what the file actually uses (it has request-builder helpers for the existing gate tests — reuse them; do NOT invent a parallel fixture).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pretable-internal/bench-runner test 2>&1 | tail -20`. Expected: the new tests fail ("filter-keystrokes" not assignable / Unsupported script / metric lists differ).

- [ ] **Step 3: Implement** in `packages/bench-runner/src/index.ts`:
  1. `BenchScriptName` union (after `"filter-text"`): add `| "filter-keystrokes"` with a doc comment: `/** N successive narrowing filter commits (filter-as-you-type); reports the per-commit latency distribution, cold first commit split from the warm rest. See docs/superpowers/specs/2026-08-27-filter-keystrokes-bench-design.md. */`
  2. `benchScriptNames` array: add `"filter-keystrokes"` after `"filter-text"`.
  3. `interactionScripts` allowlist inside `validateSupportedP0aRequest`: add `"filter-keystrokes"`.
  4. `BenchMetricId` union, after `interaction-family` metrics (near `settle_duration_ms`), add with doc comments explaining cold/warm:

```ts
  /** filter-keystrokes: surviving keystroke steps actually measured. Steps whose
   *  row count matches the previous step's are dropped at plan time (the settle
   *  latch keys on the count), so this is how a collapsed sequence is caught. */
  | "keystroke_commits_observed"
  /** Commit 1 trigger→settled — the COLD number; includes any first-use fill. */
  | "keystroke_first_total_ms"
  /** Median of commits 2..N trigger→settled — the WARM number a typing user feels. */
  | "keystroke_warm_total_p50_ms"
  | "keystroke_warm_total_p95_ms"
  | "keystroke_warm_total_max_ms"
```

  5. `benchMetricIds` array: add the same five ids next to `settle_duration_ms`.
  6. `assertRequiredMetrics`: add `scriptName === "filter-keystrokes"` to the existing sort/filter/group disjunction (so it owes the family eight), AND a new block after it:

```ts
  if (status === "completed" && scriptName === "filter-keystrokes") {
    for (const metricId of [
      "keystroke_commits_observed",
      "keystroke_first_total_ms",
      "keystroke_warm_total_p50_ms",
      "keystroke_warm_total_p95_ms",
      "keystroke_warm_total_max_ms",
    ] satisfies readonly BenchMetricId[]) {
      if (metrics[metricId] === undefined) {
        throw new Error(`Missing required metric: ${metricId}`);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify pass** — `pnpm --filter @pretable-internal/bench-runner build 2>&1 | tail -3 && pnpm --filter @pretable-internal/bench-runner test 2>&1 | tail -6`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add packages/bench-runner && git commit -m "feat(bench-runner): filter-keystrokes script + keystroke distribution metrics"`

---

### Task 2: query plumbing + keystroke plan builder

**Files:**
- Modify: `apps/bench/src/bench-types.ts` (scriptName `Extract` list, lines 11–33)
- Modify: `apps/bench/src/query-state.ts` (parse disjunction, lines 61–82)
- Modify: `apps/bench/src/interaction-plan.ts`
- Test: `apps/bench/src/__tests__/query-state.test.ts`, `apps/bench/src/__tests__/bench-app-interaction-plan.test.tsx`

- [ ] **Step 1: Failing tests.** In `query-state.test.ts` add (mirroring the existing script-parse tests around 202–240):

```ts
test("parses script=filter-keystrokes", () => {
  expect(parseBenchQuery("script=filter-keystrokes").scriptName).toBe("filter-keystrokes");
});
```

In `bench-app-interaction-plan.test.tsx` (or a sibling `filter-keystroke-plan` describe in the same file) add tests against `createBenchFilterKeystrokePlans`. Build a small synthetic `ScenarioDataset`-shaped object: `{ rows }` where rows are `{ id, col_0 }` records chosen so prefix counts are known. Use the REAL dataset type — if `createBenchFilterKeystrokePlans` only reads `dataset.rows`, type the parameter as `Pick<ScenarioDataset, "rows">` so tests stay honest without fabricating the full dataset.

```ts
const keystrokeRows = (values: string[]) =>
  values.map((value, index) => ({ id: `row-${index}`, col_0: value }) as ScenarioRow);

test("keystroke steps strictly narrow the row count and end at the full needle", () => {
  const dataset = {
    rows: keystrokeRows(["Bxx", "Boq", "Bonjour say", "Bonzz", "hello", "Bonjour encore"]),
  };
  // counts by hand: "B":5, "Bo":4, "Bon":3, "Bonj":2, "Bonjo":2 (dropped),
  // "Bonjou":2 (dropped), "Bonjour":2 — equal to last kept ("Bonj"), so it
  // REPLACES it. Expected steps: B:5, Bo:4, Bon:3, Bonjour:2.
  const steps = createBenchFilterKeystrokePlans(dataset);
  expect(steps).not.toBeNull();
  const counts = steps!.map((step) => step.plan.resultRowCount);
  expect(counts.every((count, i) => i === 0 || count < counts[i - 1]!)).toBe(true);
  expect(steps!.at(-1)!.value).toBe("Bonjour");
  // every step's plan carries the mode and the contains filter for its prefix
  for (const step of steps!) {
    expect(step.plan.mode).toBe("filter-keystrokes");
    expect(step.plan.filters["col_0"]).toEqual({ operator: "contains", value: step.value });
  }
});

test("a prefix that does not change the count is dropped, the full needle survives", () => {
  // Every "Bonjou" occurrence below is part of a full "Bonjour", so the
  // "Bonjou" step matches the same set as "Bonjour": counts by hand —
  // total 3; B:3? no — pick rows so "B":2, "Bo".."Bonjou":2, "Bonjour":1.
  const dataset = {
    rows: keystrokeRows(["Bonjour ici", "Boxx", "hello"]),
  };
  // counts: "B":2, "Bo":2 (dropped), "Bon":1, "Bonj".."Bonjou":1 (dropped),
  // "Bonjour":1 — equal to last kept ("Bon"), so it REPLACES it.
  const steps = createBenchFilterKeystrokePlans(dataset)!;
  expect(steps.map((step) => step.value)).toEqual(["B", "Bonjour"]);
  expect(steps.map((step) => step.plan.resultRowCount)).toEqual([2, 1]);
});

test("probes come from the final filtered set and are stable across every step", () => {
  const steps = createBenchFilterKeystrokePlans(dataset)!;
  const finalIds = new Set(steps.at(-1)!.plan.rows.map((row) => String(row.id)));
  for (const step of steps) {
    expect(step.plan.selectedRowId).toBe(steps.at(-1)!.plan.selectedRowId);
    expect(step.plan.focusedRowId).toBe(steps.at(-1)!.plan.focusedRowId);
    expect(finalIds.has(step.plan.selectedRowId!)).toBe(true);
  }
});

test("createBenchInteractionPlan returns null for filter-keystrokes (sequence scripts use the step builder)", () => {
  expect(createBenchInteractionPlan(dataset as ScenarioDataset, "filter-keystrokes")).toBeNull();
});
```

**IMPORTANT (choose-data-that-can-disprove):** compute the expected per-prefix counts of your fixture BY HAND in a comment beside it, and pick rows so at least one intermediate prefix is dropped AND at least three survive — a fixture where nothing is dropped cannot catch a broken dedup.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter '@pretable/app-bench^...' build 2>&1 | tail -3 && pnpm --filter @pretable/app-bench test 2>&1 | tail -20`. Expected: FAIL (`createBenchFilterKeystrokePlans` not exported).

- [ ] **Step 3: Implement.**
  - `bench-types.ts`: add `| "filter-keystrokes"` to the `Extract` list.
  - `query-state.ts`: add `script === "filter-keystrokes" ||` to the parse chain.
  - `interaction-plan.ts`: add after the `TEXT_FILTER` constant:

```ts
/**
 * filter-as-you-type sequence for the `filter-keystrokes` script: the prefixes
 * of the existing text-filter needle, applied as successive `contains` commits.
 * Reuses TEXT_FILTER's column and needle so the final keystroke's result set is
 * byte-identical to the single-commit `filter-text` script's — the two read
 * side by side, cold commit vs cold commit.
 */
export interface BenchFilterKeystrokeStep {
  /** The filter value this keystroke commits (a prefix of the full needle). */
  readonly value: string;
  readonly plan: BenchInteractionPlan;
}

export function createBenchFilterKeystrokePlans(
  dataset: Pick<ScenarioDataset, "rows">,
): BenchFilterKeystrokeStep[] | null {
  const { columnId, value: needle } = TEXT_FILTER;
  const prefixes = Array.from({ length: needle.length }, (_, index) =>
    needle.slice(0, index + 1),
  );

  // The settle machinery latches on a signature whose first component is the
  // result row count (visible rows can be identical across a narrowing), so a
  // step that does not move the count would starve the latch: keep only steps
  // that strictly reduce the count, starting from the unfiltered total.
  const kept: { value: string; rows: readonly ScenarioRow[] }[] = [];
  let previousCount = dataset.rows.length;
  for (const prefix of prefixes) {
    const rows = filterRows(dataset.rows, columnId, prefix);
    if (rows.length > previousCount) {
      // Monotone narrowing is structural (contains "Bo" ⊆ contains "B"); a
      // violation means filterRows and this builder disagree — a plan bug.
      throw new Error(
        `filter-keystrokes: prefix "${prefix}" widened the row set (${rows.length} > ${previousCount})`,
      );
    }
    if (rows.length === previousCount) {
      continue;
    }
    kept.push({ value: prefix, rows });
    previousCount = rows.length;
  }

  // The full needle must always be the last committed value — it is what makes
  // the final state comparable to `filter-text`. Equal count under monotone
  // narrowing means an identical row set, so swapping the last kept prefix for
  // the full needle preserves the strict decrease.
  const fullNeedle = prefixes.at(-1)!;
  if (kept.length > 0 && kept.at(-1)!.value !== fullNeedle) {
    const finalRows = filterRows(dataset.rows, columnId, fullNeedle);
    if (finalRows.length === kept.at(-1)!.rows.length) {
      kept[kept.length - 1] = { value: fullNeedle, rows: finalRows };
    } else {
      kept.push({ value: fullNeedle, rows: finalRows });
    }
  }

  if (kept.length < 2) {
    // One commit is the single-commit script; a sequence needs a warm tail.
    return null;
  }

  const finalRows = kept.at(-1)!.rows;
  const probeRow = finalRows[Math.floor(finalRows.length / 2)] ?? finalRows[0];
  const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

  return kept.map(({ value, rows }) => ({
    value,
    plan: {
      focusedRowId: probeRowId,
      filters: { [columnId]: { operator: "contains", value } },
      mode: "filter-keystrokes",
      probeColumnId: columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    },
  }));
}
```

  Note: `createBenchInteractionPlan` gets NO `filter-keystrokes` branch — it returns `null` for it (the dispatch uses the step builder). The `mode` type admits it automatically via the `Exclude<>`.

- [ ] **Step 4: Run tests to verify pass** — same command as Step 2. Expected: PASS (the whole app-bench suite, not just the new file).

- [ ] **Step 5: Commit** — `git add apps/bench && git commit -m "feat(bench): filter-keystrokes query plumbing + keystroke step builder"`

---

### Task 3: `measureBenchFilterKeystrokesRun`

**Files:**
- Modify: `apps/bench/src/bench-runtime.ts`
- Test: `apps/bench/src/__tests__/bench-runtime.test.ts`

- [ ] **Step 1: Failing tests.** Copy the harness pattern of the existing `measureBenchInteractionRun` tests (synchronous rAF stub advancing 16ms/frame, telemetry-override closure, trigger mutating a `phase`). Three tests:

```ts
test("measureBenchFilterKeystrokesRun measures every step and splits cold from warm", async () => {
  // harness: pretable-profile DOM with a viewport + rows (reuse the existing helpers)
  let committed = -1; // which step's trigger has fired
  const counts = [40, 12, 3]; // per-step expected result counts
  const result = await measureBenchFilterKeystrokesRun(
    root, "pretable",
    counts.map((resultRowCount, index) => ({
      value: "Bonjour".slice(0, index + 1),
      plan: { focusedRowId: "row-b", resultRowCount, selectedRowId: "row-b" },
    })),
    () => ({
      focusedRowId: "row-b",
      resultRowCount: committed < 0 ? 100 : counts[committed]!,
      selectedRowId: "row-b",
    }),
    (index) => { committed = index; },
  );
  expect(result.status).toBe("completed");
  expect(result.metrics.keystroke_commits_observed).toBe(3);
  expect(result.metrics.keystroke_first_total_ms).toBeGreaterThan(0);
  expect(result.metrics.keystroke_warm_total_p50_ms).toBeGreaterThan(0);
  expect(result.metrics.keystroke_warm_total_max_ms).toBeGreaterThanOrEqual(
    result.metrics.keystroke_warm_total_p50_ms!,
  );
  // commit 1 is the cold one and doubles as the family's interaction latency
  expect(result.metrics.interaction_latency_ms).toBeGreaterThan(0);
  expect(result.metrics.result_row_count).toBe(3);
});

test("a step that settles at the wrong count downgrades the whole run to partial and strips timings", async () => {
  // Step 2's telemetry never reaches its plan's count: the override reports
  // counts [40, 99, 3] while the plans expect [40, 12, 3]; the surface goes
  // stable at 99 so measureRowSetChange latches the stall and the sequence
  // must void itself at keystroke 2.
  let committed = -1;
  const reported = [40, 99, 3];
  const result = await measureBenchFilterKeystrokesRun(
    root, "pretable",
    [40, 12, 3].map((resultRowCount, index) => ({
      value: "Bonjour".slice(0, index + 1),
      plan: { focusedRowId: "row-b", resultRowCount, selectedRowId: "row-b" },
    })),
    () => ({
      focusedRowId: "row-b",
      resultRowCount: committed < 0 ? 100 : reported[committed]!,
      selectedRowId: "row-b",
    }),
    (index) => { committed = index; },
  );
  expect(result.status).toBe("partial");
  expect(result.notes.join(" ")).toContain("keystroke 2");
  expect(result.metrics.keystroke_first_total_ms).toBeUndefined();
  expect(result.metrics.interaction_latency_ms).toBeUndefined();
});

test("fewer than two steps is refused as partial (a sequence needs a warm tail)", async () => {
  const result = await measureBenchFilterKeystrokesRun(root, "pretable", [oneStep], override, trigger);
  expect(result.status).toBe("partial");
});
```

Also assert the trigger ordering: `(index) => calls.push(index)` and `expect(calls).toEqual([0, 1, 2])`.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pretable/app-bench test 2>&1 | tail -20`. Expected: FAIL (not exported).

- [ ] **Step 3: Implement** in `bench-runtime.ts`:
  1. `BenchInteractionMode` (line ~151): add `| "filter-keystrokes"`.
  2. `getMaxInteractionFrames` (line ~154): add `mode === "filter-keystrokes"` to the wide-budget (96) disjunction — each COMMIT gets the filter-text budget.
  3. New exported function after `measureBenchInteractionRun`:

```ts
export interface BenchFilterKeystrokeMeasurementStep {
  /** The filter value this step commits — used only for labeling. */
  value: string;
  plan: {
    focusedRowId: string | null;
    resultRowCount: number;
    selectedRowId: string | null;
  };
}

/**
 * The filter-as-you-type measurement: N successive filter commits, each opened
 * only after the previous one fully settled (settled-sequential — per-commit
 * attribution stays unambiguous), reported as a distribution with the COLD
 * first commit (any first-use fill runs inside it) split from the WARM rest.
 * The single-commit scripts cannot see warm-path work at all — the fill IS
 * their measured interaction (see the columnar-verdicts revert record); this
 * helper is the instrument that can.
 *
 * Any step that fails its latch — no visible change, never held still, or
 * settled at the wrong count — voids the WHOLE run: a distribution over a
 * broken sequence is not a distribution over typing. Peaks survive, timings
 * do not, mirroring `measureBenchInteractionRun`'s post-hoc validity rule.
 */
export async function measureBenchFilterKeystrokesRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  steps: readonly BenchFilterKeystrokeMeasurementStep[],
  readInteractionStateOverride: (() => BenchInteractionState) | undefined,
  triggerStep: (index: number) => void,
): Promise<InteractionBenchRunResult> {
  const profile = scrollRuntimeProfiles[adapterId];
  const label = "interaction mode: filter-keystrokes";

  if (steps.length < 2) {
    return {
      status: "partial",
      notes: [
        label,
        `keystroke sequence collapsed to ${steps.length} step(s); a distribution needs a warm tail`,
      ],
      metrics: { dom_nodes_peak: root.querySelectorAll("*").length },
    };
  }

  // The single-commit scripts trigger one frame after remount; a sequence
  // wants a genuinely quiet start so commit 1's window opens on a settled
  // mount rather than the mount's own tail motion.
  await waitForRenderedRowBaseline(root, profile.rowSelector);

  const maxFrames = getMaxInteractionFrames(
    profile.maxSettleFrames,
    "filter-keystrokes",
  );
  const commitTotals: number[] = [];
  const perCommitNotes: string[] = [];
  let firstCommitMetrics: Partial<Record<BenchMetricId, number>> | null = null;
  let lastMeasurement: Extract<
    Awaited<ReturnType<typeof measureRowSetChange>>,
    { status: "completed" }
  > | null = null;
  let blankGapFrames = 0;
  let longTaskCount: number | null = null;
  let longTaskMs: number | null = null;
  let anchorShiftWorst = 0;
  let domNodesPeak = 0;
  let renderedRowsPeak = 0;
  let renderedCellsPeak = 0;

  for (const [index, step] of steps.entries()) {
    const stepLabel = `keystroke ${index + 1}/${steps.length} ("${step.value}")`;
    const measurement = await measureRowSetChange({
      adapterId,
      createSignature: ({ resultRowCount, visibleRows }) =>
        createVisibleRowSignature(visibleRows, resultRowCount),
      label: stepLabel,
      maxFrames,
      plan: step.plan,
      // The previous commit's settle IS the quiet between commits.
      quietFrames: 0,
      readInteractionStateOverride,
      root,
      trigger: () => triggerStep(index),
    });

    const failedReason =
      measurement.status === "partial"
        ? measurement.reason
        : measurement.finalState.resultRowCount !== step.plan.resultRowCount
          ? `result row count settled at ${measurement.finalState.resultRowCount}, not the ${step.plan.resultRowCount} rows the plan handed the surface`
          : null;

    if (measurement.status === "partial" || failedReason !== null) {
      return {
        status: "partial",
        notes: [label, ...perCommitNotes, `${stepLabel}: ${failedReason}`],
        // Peaks identify the run; timings from a broken sequence do not
        // survive — same rule as the single-commit post-hoc validity check.
        metrics: {
          result_row_count: measurement.metrics.result_row_count,
          dom_nodes_peak: Math.max(
            domNodesPeak,
            measurement.metrics.dom_nodes_peak ?? 0,
          ),
          rendered_rows_peak: Math.max(
            renderedRowsPeak,
            measurement.metrics.rendered_rows_peak ?? 0,
          ),
          rendered_cells_peak: Math.max(
            renderedCellsPeak,
            measurement.metrics.rendered_cells_peak ?? 0,
          ),
        },
      };
    }

    const latency = measurement.metrics.interaction_latency_ms ?? 0;
    const settle = measurement.metrics.settle_duration_ms ?? 0;
    commitTotals.push(latency + settle);
    perCommitNotes.push(
      `${stepLabel}: latency ${latency.toFixed(1)} ms, settle ${settle.toFixed(1)} ms, ${step.plan.resultRowCount} rows`,
    );
    if (firstCommitMetrics === null) {
      firstCommitMetrics = measurement.metrics;
    }
    lastMeasurement = measurement;
    blankGapFrames += measurement.metrics.post_interaction_blank_gap_frames ?? 0;
    if (measurement.metrics.post_interaction_long_tasks_count !== undefined) {
      longTaskCount =
        (longTaskCount ?? 0) +
        measurement.metrics.post_interaction_long_tasks_count;
      longTaskMs =
        (longTaskMs ?? 0) + (measurement.metrics.post_interaction_long_tasks_ms ?? 0);
    }
    anchorShiftWorst = Math.max(
      anchorShiftWorst,
      measurement.metrics.post_interaction_anchor_shift_px ?? 0,
    );
    domNodesPeak = Math.max(domNodesPeak, measurement.metrics.dom_nodes_peak ?? 0);
    renderedRowsPeak = Math.max(
      renderedRowsPeak,
      measurement.metrics.rendered_rows_peak ?? 0,
    );
    renderedCellsPeak = Math.max(
      renderedCellsPeak,
      measurement.metrics.rendered_cells_peak ?? 0,
    );
  }

  const warmTotals = commitTotals.slice(1);
  const finalMetrics = lastMeasurement!.metrics;

  return {
    status: "completed",
    notes: [
      label,
      ...perCommitNotes,
      // Frame-floor disclosure travels with the last commit's notes.
      ...lastMeasurement!.notes.filter((note) => note.startsWith("frame ")),
      ...lastMeasurement!.notes.filter((note) =>
        note.includes("row height error"),
      ),
    ],
    metrics: {
      // The family set, so filter-keystrokes reads beside filter-text:
      // latency/settle are COMMIT 1's — the same cold commit filter-text times.
      interaction_latency_ms: firstCommitMetrics!.interaction_latency_ms,
      settle_duration_ms: firstCommitMetrics!.settle_duration_ms,
      post_interaction_blank_gap_frames: blankGapFrames,
      ...(longTaskCount !== null
        ? {
            post_interaction_long_tasks_count: longTaskCount,
            post_interaction_long_tasks_ms: longTaskMs ?? 0,
          }
        : {}),
      // Worst commit's p95 — a shift on ANY keystroke is a shift the user saw.
      post_interaction_anchor_shift_px: anchorShiftWorst,
      ...(finalMetrics.post_interaction_row_height_error_measurable_rows !==
      undefined
        ? {
            post_interaction_row_height_error_measurable_rows:
              finalMetrics.post_interaction_row_height_error_measurable_rows,
            ...(finalMetrics.post_interaction_row_height_error_p95_px !==
            undefined
              ? {
                  post_interaction_row_height_error_p95_px:
                    finalMetrics.post_interaction_row_height_error_p95_px,
                }
              : {}),
          }
        : {}),
      result_row_count: finalMetrics.result_row_count,
      selected_row_preserved: finalMetrics.selected_row_preserved,
      focused_row_preserved: finalMetrics.focused_row_preserved,
      dom_nodes_peak: domNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
      // The distribution this script exists for:
      keystroke_commits_observed: commitTotals.length,
      keystroke_first_total_ms: commitTotals[0],
      keystroke_warm_total_p50_ms: percentile(warmTotals, 0.5),
      keystroke_warm_total_p95_ms: percentile(warmTotals, 0.95),
      keystroke_warm_total_max_ms: Math.max(...warmTotals),
    },
  };
}
```

  (`percentile`, `createVisibleRowSignature`, `waitForRenderedRowBaseline`, `scrollRuntimeProfiles`, `measureRowSetChange` are all already in this module.)

- [ ] **Step 4: Run tests to verify pass** — `pnpm --filter @pretable/app-bench test 2>&1 | tail -8`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add apps/bench/src/bench-runtime.ts apps/bench/src/__tests__/bench-runtime.test.ts && git commit -m "feat(bench): measureBenchFilterKeystrokesRun — settled-sequential keystroke measurement"`

---

### Task 4: dispatch + adapters

**Files:**
- Modify: `apps/bench/src/bench-app.tsx` (imports ~32–48; dispatch after the `interactionRun` chain ~465–575; `measuredRuns` table ~776–800)
- Modify: `apps/bench/src/tanstack-adapter.tsx` (~268–271), `apps/bench/src/ag-grid-adapter.tsx` (~222–236), `apps/bench/src/mui-adapter.tsx` (~224–236)
- Test: `apps/bench/src/__tests__/bench-app.test.tsx`, adapter tests

- [ ] **Step 1: Failing tests.**
  - `bench-app.test.tsx`: mirror the existing interaction dispatch tests (the group-expand mode-at-call-time test around 388–448) with a `filter-keystrokes` case asserting: the run publishes a summary whose metrics include `keystroke_commits_observed`, and the pretable adapter received the plans IN ORDER (each new `interactionPlan` prop value's filter value is the next prefix). If the existing tests observe `setQuery`/plan props, assert the sequence of filter values seen is strictly lengthening prefixes ending in `"Bonjour"`.
  - `tanstack-adapter.test.tsx` (and ag-grid/mui equivalents): copy the existing "applies the filter model on filter-text" test with `mode: "filter-keystrokes"`, asserting `setColumnFilters`/`setFilterModel` is called with the prefix value and `contains` semantics.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pretable/app-bench test 2>&1 | tail -20`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `bench-app.tsx` imports: add `createBenchFilterKeystrokePlans` (from `./interaction-plan`) and `measureBenchFilterKeystrokesRun` (from `./bench-runtime`).
  - After the `group-expand` arm of the interaction chain (keep the existing chain untouched), add:

```tsx
      const filterKeystrokesRun =
        scriptName === "filter-keystrokes"
          ? await (() => {
              const steps = createBenchFilterKeystrokePlans(dataset);

              if (!steps) {
                return Promise.resolve(null);
              }

              return measureBenchFilterKeystrokesRun(
                viewportRef.current ?? document.body,
                query.adapterId,
                steps.map((step) => ({ value: step.value, plan: step.plan })),
                query.adapterId === "pretable"
                  ? () =>
                      createBenchInteractionStateFromTelemetry(
                        pretableTelemetryRef.current,
                        dataset.rows.length,
                      )
                  : undefined,
                (index) => {
                  // Each step publishes a fresh plan object; every adapter's
                  // interaction effect re-fires on plan identity, which is what
                  // turns one state write into one native filter commit.
                  setInteractionPlanOverride({
                    plan: steps[index]!.plan,
                    search,
                  });
                },
              );
            })()
          : null;
```

  - `measuredRuns` table: add BEFORE the `{ matches: true, run: interactionRun, ... }` catch-all:

```tsx
        {
          matches: scriptName === "filter-keystrokes",
          run: filterKeystrokesRun,
        },
```

  (Without this row the mount-only fallback publishes a green run that measured nothing — the map's item 16 trap.)
  - `tanstack-adapter.tsx` filter effect (~268): extend to `interactionPlan.mode === "filter-metadata" || interactionPlan.mode === "filter-text" || interactionPlan.mode === "filter-keystrokes"`. Verify line ~110's `filterFn` ternary leaves non-metadata modes on `"auto"` (contains) — no change needed there; add the mode to any mode-typed unions if present.
  - `ag-grid-adapter.tsx` / `mui-adapter.tsx`: extend the same disjunction; the existing `type: mode === "filter-metadata" ? "equals" : "contains"` ternaries already give `contains`.
  - `pretable-adapter.tsx`: NO change (mode-agnostic via `plan.filters`); the bench-app test's in-order assertion is what proves successive `setQuery` commits fire.

- [ ] **Step 4: Run tests to verify pass** — `pnpm --filter @pretable/app-bench test 2>&1 | tail -8`, then `pnpm --filter @pretable/app-bench typecheck 2>&1 | tail -3` and `pnpm --filter @pretable/app-bench lint 2>&1 | tail -3`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add apps/bench && git commit -m "feat(bench): dispatch filter-keystrokes + comparator filter wiring"`

---

### Task 5: Playwright spec + real end-to-end runs

**Files:**
- Modify: `apps/bench/tests/bench.spec.ts` (interaction branch ~200–207; assertion block ~304–341)

- [ ] **Step 1: Extend the spec.** Add `scriptName === "filter-keystrokes"` to the `interactionScript` disjunction. In the completed-interaction assertion block, add (guarded on the script):

```ts
if (scriptName === "filter-keystrokes" && result.status === "completed") {
  expect(result.metrics.keystroke_commits_observed).toBeGreaterThanOrEqual(2);
  expect(result.metrics.keystroke_first_total_ms).toBeGreaterThan(0);
  expect(result.metrics.keystroke_warm_total_p50_ms).toBeGreaterThan(0);
  expect(result.metrics.keystroke_warm_total_p95_ms).toBeGreaterThanOrEqual(
    result.metrics.keystroke_warm_total_p50_ms!,
  );
  expect(result.metrics.keystroke_warm_total_max_ms).toBeGreaterThanOrEqual(
    result.metrics.keystroke_warm_total_p95_ms!,
  );
}
```

  Match the block's existing style (some assertions live in a `toMatchObject`; follow it).

- [ ] **Step 2: Build and run for real — pretable, dev scale.**

```bash
pnpm --filter @pretable/app-bench build 2>&1 | tail -3
lsof -i :4173 || true   # MUST be empty; if held, STOP and report — never kill the holder
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev \
  PRETABLE_BENCH_SCRIPT=filter-keystrokes pnpm bench:e2e > /tmp/keystrokes-pretable-dev.log 2>&1
echo "exit: $?"
```

  Expected: exit 0. Then Read the newest `status/chromium-pretable-default-s2-dev-filter-keystrokes-*.summary.json`: `status: "completed"`, `keystroke_commits_observed ≥ 2`, per-commit notes present, `post_interaction_blank_gap_frames: 0`, cold (`keystroke_first_total_ms`) ≥ warm p50 — plausibility, not a gate.

- [ ] **Step 3: Same for tanstack** (`PRETABLE_BENCH_ADAPTER=tanstack`, log to `/tmp/keystrokes-tanstack-dev.log`). Expected: completed summary with the same shape. If the DOM-default state reader never sees the count change for tanstack, debug `data-bench-result-row-count` publication before touching the measurement.

- [ ] **Step 4: Confirm no collateral** — `node --test scripts/__tests__/bench-matrix.test.mjs > /tmp/bench-matrix-test.log 2>&1; echo "exit: $?"` (expected 0), and `pnpm --filter @pretable-internal/bench-runner test 2>&1 | tail -4`.

- [ ] **Step 5: Commit** — `git add apps/bench/tests/bench.spec.ts && git commit -m "test(bench): filter-keystrokes e2e coverage"`. Delete any stray `status/*.summary.json` artifacts from the working tree before committing (`git status --short status/` — bench artifacts are not part of this change; check whether `status/` is gitignored and leave it as found).

---

### Task 6: measurement round at hypothesis + target, results doc, PR

- [ ] **Step 1: Hypothesis + target rounds, pretable + tanstack.** Same env-var invocations at `PRETABLE_BENCH_SCALE=hypothesis` and `=target`, S2, 3 repeats each (re-run the command 3 times; medians by hand), each redirected to its own log file with exit codes checked. Machine-load caveat: record `uptime` in the results doc; TanStack same-run cells are the fitness arbiter, not absolute numbers.

- [ ] **Step 2: Results doc** — `docs/superpowers/specs/2026-08-27-filter-keystrokes-bench-results.md`: table per scale × adapter of `keystroke_commits_observed`, cold, warm p50/p95/max, blank frames; the observed cold-vs-warm ratio; explicit statement of what the instrument can now see that the single-commit scripts cannot; load + fitness note. No budget claims.

- [ ] **Step 3: Self-review the diff** against the design doc's "Seams touched" list; run the full app-bench + bench-runner suites once more; `pnpm build 2>&1 | tail -3` at root to prove no downstream break (bench packages are internal — no `.api.md` drift expected; if `pnpm api` reports drift, something leaked and must be fixed, not committed).

- [ ] **Step 4: Push + PR** titled `feat(bench): filter-keystrokes — the filter-as-you-type script (closes #489)`, body covering: the structural gap (cold-fill invisibility, columnar revert), the cold/warm split, sequence-validity rule, what's deliberately absent (evaluator/budgets), and the measured numbers. Arm auto-merge (squash). Verify merge with `gh pr view` before recording it anywhere.
