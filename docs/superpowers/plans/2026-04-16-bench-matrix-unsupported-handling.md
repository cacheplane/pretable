# Bench Matrix Unsupported-Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `pnpm bench:matrix` include competitor adapters alongside interaction scripts in a single invocation by persisting an `unsupported` summary for every bench:e2e run.

**Architecture:** The fix is at one seam: `apps/bench/tests/bench.spec.ts`. The test currently writes summary + trace only on the supported path. We restructure so the summary write happens on both paths, and tracing is stopped (without saving) on the unsupported path. No changes to `bench-matrix.mjs` or `bench-runner`.

**Tech Stack:** Playwright, Node.js `fs/promises`, `@pretable-internal/bench-runner`

---

### Task 1: Lock-in test for hypothesis aggregation with unsupported entries

**Files:**

- Modify: `scripts/__tests__/bench-matrix.test.mjs`

This test locks in that `createHypothesisReport` already handles `status: "unsupported"` runs without throwing. It is not a red-green test — it should pass immediately — but it guards the aggregation path that the spec change depends on.

- [ ] **Step 1: Write the lock-in test**

Add this test after the existing `createHypothesisReport` tests (after line 1253 in `scripts/__tests__/bench-matrix.test.mjs`):

```javascript
test("createHypothesisReport includes unsupported entries without erroring", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-16t10-00-00-000z",
    generatedAt: "2026-04-16T10:02:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-sort-2026-04-16t10-00-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-sort-2026-04-16t10-00-30-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-16T10:00:30.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 24,
          settle_duration_ms: 18,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
        },
      },
      {
        adapterId: "ag-grid",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-16T10:00:45.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "unsupported",
        notes: [],
        unsupported: {
          adapterId: "ag-grid",
          scenarioId: "S2",
          profile: "default",
          scriptName: "sort",
          reason: "Unsupported adapter for interaction script sort: ag-grid",
        },
      },
    ],
  });

  const h6 = report.hypotheses.find((hypothesis) => hypothesis.id === "H6");

  assert.ok(h6);
  assert.equal(h6.status, "satisfied");
});
```

- [ ] **Step 2: Run test to verify it passes (lock-in)**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: all tests pass including the new one.

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/bench-matrix.test.mjs
git commit -m "test: lock in hypothesis aggregation for unsupported entries"
```

---

### Task 2: Red test — bench spec must persist a summary on the unsupported path

**Files:**

- Modify: `apps/bench/tests/bench.spec.ts`

Add a file-existence assertion on the unsupported branch. This must fail before the fix.

- [ ] **Step 1: Add the stat import and summary-path assertion**

In `apps/bench/tests/bench.spec.ts`, add `stat` to the `node:fs/promises` import on line 1:

```typescript
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
```

Then, inside the `if (interactionScript && !interactionSupported)` block (lines 47-56), add a summary-path assertion and `return` AFTER the new assertion. Replace the block at lines 47-57:

```typescript
if (interactionScript && !interactionSupported) {
  expect(result).toMatchObject({
    status: "unsupported",
    unsupported: {
      adapterId,
      scenarioId,
      scriptName,
    },
  });

  const cwd = process.cwd();
  const summaryPath = path.join(
    cwd,
    "status",
    `${createRunArtifactFileStem(result)}.summary.json`,
  );

  await expect(stat(summaryPath)).resolves.toBeTruthy();
  return;
}
```

- [ ] **Step 2: Run the spec against an unsupported combination to verify it fails (red)**

Run: `PRETABLE_BENCH_ADAPTER=ag-grid PRETABLE_BENCH_SCRIPT=sort PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev pnpm bench:e2e -- --project=chromium`

Expected: FAIL — the `stat(summaryPath)` rejects because no summary file was written.

- [ ] **Step 3: Commit the red test**

```bash
git add apps/bench/tests/bench.spec.ts
git commit -m "test(red): assert summary file exists on unsupported path"
```

---

### Task 3: Green — restructure bench.spec.ts to persist on both paths

**Files:**

- Modify: `apps/bench/tests/bench.spec.ts`

Move the summary write and tracing stop above the unsupported/measured branch point. For unsupported runs: write the summary, stop tracing without saving, skip dashboard. For measured runs: write the summary, save the trace, update the dashboard.

- [ ] **Step 1: Restructure the test body**

Replace the entire content of `apps/bench/tests/bench.spec.ts` with:

```typescript
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import {
  createDashboardIndex,
  createRunArtifactFileStem,
  type BenchRunSummary,
} from "@pretable-internal/bench-runner";

const adapterId = process.env.PRETABLE_BENCH_ADAPTER ?? "pretable";
const scale = process.env.PRETABLE_BENCH_SCALE ?? "dev";
const scenarioId = process.env.PRETABLE_BENCH_SCENARIO ?? "S1";
const scriptName = process.env.PRETABLE_BENCH_SCRIPT ?? "initial";
const adapterLabel =
  adapterId === "ag-grid"
    ? "AG Grid Community adapter"
    : adapterId === "tanstack"
      ? "TanStack Virtual adapter"
      : "Pretable React adapter";

test("writes benchmark artifacts for the selected Pretable run", async ({
  page,
}) => {
  await page.context().tracing.start({
    screenshots: true,
    snapshots: true,
  });

  await page.goto(
    `/?adapter=${adapterId}&scenario=${scenarioId}&scale=${scale}&script=${scriptName}&autorun=1`,
  );

  await expect(page.getByText(adapterLabel)).toBeVisible();

  await page.waitForFunction(() => Boolean(window.__PRETABLE_BENCH_RESULT__));

  const result = await page.evaluate(() => window.__PRETABLE_BENCH_RESULT__);

  const interactionScript =
    scriptName === "sort" ||
    scriptName === "filter-metadata" ||
    scriptName === "filter-text";
  const interactionSupported =
    interactionScript && adapterId === "pretable" && scenarioId === "S2";

  const cwd = process.cwd();
  const summaryPath = path.join(
    cwd,
    "status",
    `${createRunArtifactFileStem(result)}.summary.json`,
  );

  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(result, null, 2)}\n`);

  if (interactionScript && !interactionSupported) {
    expect(result).toMatchObject({
      status: "unsupported",
      unsupported: {
        adapterId,
        scenarioId,
        scriptName,
      },
    });

    await page.context().tracing.stop();
    await expect(stat(summaryPath)).resolves.toBeTruthy();
    return;
  }

  expect(result).toMatchObject({
    status: "completed",
    adapterId,
    scenarioId,
    profile: "default",
    scale,
    scriptName,
    tracePath: expect.stringContaining("status/traces/"),
  });

  if (scriptName === "scroll") {
    expect(result.notes).toContain("contain: none");
    expect(result.notes).toContain("content visibility: visible");
    expect(result.notes).toContain("contain intrinsic size: none");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    if (adapterId === "pretable") {
      expect(result.notes).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^internal telemetry rendered rows: \d+$/),
          expect.stringMatching(/^internal telemetry visible rows: \d+$/),
          expect.stringMatching(/^internal telemetry planned height: \d+$/),
          expect.stringMatching(/^internal telemetry viewport range: \d+-\d+$/),
          expect.stringMatching(/^internal telemetry selected row: .+$/),
        ]),
      );
    }
    expect(result.metrics).toMatchObject({
      scroll_frame_p95_ms: expect.any(Number),
      blank_gap_frames: expect.any(Number),
      long_tasks_count: expect.any(Number),
      long_tasks_ms: expect.any(Number),
      dom_nodes_peak: expect.any(Number),
      scroll_viewport_nodes_peak: expect.any(Number),
      rendered_rows_peak: expect.any(Number),
      rendered_cells_peak: expect.any(Number),
    });
    expect(result.metrics.blank_gap_frames).toBeGreaterThanOrEqual(0);
  }

  if (interactionScript) {
    expect(result.notes).toContain(`interaction mode: ${scriptName}`);
    if (adapterId === "pretable") {
      expect(result.notes).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^internal telemetry rendered rows: \d+$/),
          expect.stringMatching(/^internal telemetry visible rows: \d+$/),
          expect.stringMatching(/^internal telemetry total rows: \d+$/),
          expect.stringMatching(/^internal telemetry planned height: \d+$/),
          expect.stringMatching(/^internal telemetry viewport range: \d+-\d+$/),
          expect.stringMatching(/^internal telemetry selected row: .+$/),
          expect.stringMatching(/^internal telemetry focused row: .+$/),
        ]),
      );
    }
    expect(result.metrics).toMatchObject({
      interaction_latency_ms: expect.any(Number),
      settle_duration_ms: expect.any(Number),
      post_interaction_blank_gap_frames: expect.any(Number),
      post_interaction_anchor_shift_px: expect.any(Number),
      post_interaction_row_height_error_p95_px: expect.any(Number),
      result_row_count: expect.any(Number),
      selected_row_preserved: expect.any(Number),
      focused_row_preserved: expect.any(Number),
      dom_nodes_peak: expect.any(Number),
      rendered_rows_peak: expect.any(Number),
      rendered_cells_peak: expect.any(Number),
    });
  }

  const dashboardPath = path.join(cwd, "status", "dashboard.json");
  const tracePath = path.join(cwd, result.tracePath);

  await mkdir(path.dirname(tracePath), { recursive: true });
  await page.context().tracing.stop({ path: tracePath });

  const existingDashboard = await readDashboard(dashboardPath);
  const nextDashboard = createDashboardIndex([
    ...existingDashboard.runs,
    result,
  ]);

  await writeFile(dashboardPath, `${JSON.stringify(nextDashboard, null, 2)}\n`);
});

async function readDashboard(dashboardPath: string) {
  try {
    const raw = await readFile(dashboardPath, "utf8");
    return JSON.parse(raw) as {
      runs: BenchRunSummary[];
    };
  } catch {
    return { runs: [] };
  }
}
```

Key changes from the original:

1. `stat` added to `node:fs/promises` import.
2. `summaryPath` computed and `mkdir` + `writeFile` moved above the unsupported branch (lines ~49-55 in the new version). This happens for ALL runs.
3. The unsupported branch now calls `page.context().tracing.stop()` (no path — discards recording), asserts the summary exists via `stat`, and returns.
4. The measured branch calls `page.context().tracing.stop({ path: tracePath })` and updates the dashboard as before.
5. Dashboard update is skipped for unsupported runs.

- [ ] **Step 2: Run the spec against the unsupported combination to verify it passes (green)**

Run: `PRETABLE_BENCH_ADAPTER=ag-grid PRETABLE_BENCH_SCRIPT=sort PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev pnpm bench:e2e -- --project=chromium`

Expected: PASS — the summary file is now written before the unsupported branch.

- [ ] **Step 3: Run the spec against a supported combination to verify no regression**

Run: `pnpm bench:e2e -- --project=chromium`

Expected: PASS — the default pretable/S1/initial path still writes summary, trace, and dashboard.

- [ ] **Step 4: Commit**

```bash
git add apps/bench/tests/bench.spec.ts
git commit -m "fix: persist unsupported summary in bench spec for matrix compatibility"
```

---

### Task 4: Run full verification

**Files:** none (verification only)

- [ ] **Step 1: Run unit tests for bench-matrix scripts**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs scripts/__tests__/bench-e2e.test.mjs`

Expected: all pass (22+ tests).

- [ ] **Step 2: Run unit tests for affected packages**

Run: `pnpm --filter @pretable/app-bench test && pnpm --filter @pretable-internal/bench-runner test`

Expected: bench 34/34, bench-runner 4/4 pass.

- [ ] **Step 3: Run typecheck**

Run: `pnpm -r typecheck`

Expected: clean.

- [ ] **Step 4: Run the combined bench:matrix that previously failed**

Run: `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=scroll,sort,filter-metadata,filter-text --scale=hypothesis --repeats=3`

Expected: completes without error. Produces one `*.hypotheses.json` runset under `status/runsets/`.

- [ ] **Step 5: Inspect the hypothesis output**

Run:

```bash
node -e "
const d=require('./' + require('child_process').execSync('ls -t status/runsets/*.hypotheses.json | head -1').toString().trim());
for (const h of d.hypotheses) console.log(h.id, h.status);
"
```

Expected:

```
H1 satisfied
H3 satisfied
H6 satisfied
H7 satisfied
H8 satisfied
H5 satisfied
```

- [ ] **Step 6: Commit the spec and plan docs**

```bash
git add docs/superpowers/specs/2026-04-16-bench-matrix-unsupported-handling-design.md docs/superpowers/plans/2026-04-16-bench-matrix-unsupported-handling.md
git commit -m "docs: add bench-matrix unsupported-handling spec and plan"
```
