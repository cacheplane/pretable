import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import {
  createDashboardIndex,
  createRunArtifactFileStem,
  type BenchRunSummary,
} from "@pretable-internal/bench-runner";
import { createAdapterVersionsRecord } from "../../../shared/bench-adapter-packages.js";

/**
 * This spec drives `context.tracing` itself — it writes the run's trace zip to
 * `status/traces/` as a benchmark artifact, and the summary points at it. The
 * runner's own `trace` mode starts tracing on the same context before the test
 * body runs, and the second `tracing.start()` below then throws
 * `Tracing has been already started`. Under `trace: "on-first-retry"` that turns
 * every retry of this spec into a guaranteed failure, so the retry can never
 * recover a genuinely flaky run — the opt-out has to live here, next to the
 * `tracing.start()` that conflicts.
 */
test.use({ trace: "off" });

const perfTraceEnabled = process.env.PLAYWRIGHT_PERF_TRACE === "1";

const adapterId = process.env.PRETABLE_BENCH_ADAPTER ?? "pretable";
const scale = process.env.PRETABLE_BENCH_SCALE ?? "dev";
const scenarioId = process.env.PRETABLE_BENCH_SCENARIO ?? "S1";
const scriptName = process.env.PRETABLE_BENCH_SCRIPT ?? "initial";
const updateRatePerSec = process.env.PRETABLE_BENCH_UPDATE_RATE_PER_SEC;
const diagnostics = process.env.PRETABLE_BENCH_DIAGNOSTICS;
const transitionBudgetMs = process.env.PRETABLE_BENCH_TRANSITION_BUDGET_MS;
const seed = process.env.PRETABLE_BENCH_SEED;
/**
 * Prove the page under test is the build in this checkout.
 *
 * A benchmark number is only worth something if it names a commit. These stopped
 * doing that silently: with another worktree holding port 4173, `bench:matrix`
 * printed `Error: Port 4173 is already in use` and ran the whole suite against
 * that server anyway, writing artifacts that looked ordinary while describing a
 * different branch's code. Post-fix runs read as failures for hours because
 * they were measuring pre-fix code.
 *
 * `vite build` writes a fresh id into `dist/` and injects the same value into
 * the bundle, so the two agree only when the server is serving THIS build. That
 * also catches a stale `dist/` and a forgotten rebuild.
 *
 * Set `PRETABLE_BENCH_SKIP_BUILD_CHECK=1` when the target is deliberately not
 * a local build (a deployed bench, someone else's preview).
 */
const skipBuildCheck = process.env.PRETABLE_BENCH_SKIP_BUILD_CHECK === "1";
const BUILD_ID_PATH = path.join(
  import.meta.dirname,
  "..",
  "dist",
  "bench-build-id.txt",
);

async function expectServedBuildMatchesCheckout(page: {
  getAttribute: (name: string) => Promise<string | null>;
}): Promise<void> {
  if (skipBuildCheck) return;

  let expected: string;
  try {
    expected = (await readFile(BUILD_ID_PATH, "utf8")).trim();
  } catch {
    throw new Error(
      `No ${BUILD_ID_PATH}. Build the bench before measuring it ` +
        "(`pnpm --filter @pretable/app-bench build`), or set " +
        "PRETABLE_BENCH_SKIP_BUILD_CHECK=1 if the target is deliberately not " +
        "a local build.",
    );
  }

  const served = await page.getAttribute("data-bench-build-id");
  expect(
    served,
    [
      "The page under test is not the build in this checkout, so every number",
      "this run produces describes code you did not build.",
      "",
      `  expected (dist/): ${expected}`,
      `  served  (page):   ${served ?? "(absent)"}`,
      "",
      "Usual cause: something else already holds the port, and the run",
      "attached to it instead of failing — check `lsof -ti:4173` for another",
      "worktree's `preview:bench`. An absent id means the server is serving a",
      "build from before this check existed, or a `vite dev` server.",
    ].join("\n"),
  ).toBe(expected);
}

const adapterLabel =
  adapterId === "ag-grid"
    ? "AG Grid Community adapter"
    : adapterId === "tanstack"
      ? "TanStack Table adapter"
      : adapterId === "mui"
        ? "MUI X DataGrid adapter"
        : "Pretable React adapter";

test("writes benchmark artifacts for the selected Pretable run", async ({
  page,
}) => {
  await page.context().tracing.start({
    screenshots: true,
    snapshots: true,
  });

  const rateParam = updateRatePerSec
    ? `&updateRatePerSec=${updateRatePerSec}`
    : "";
  const triggerParam = perfTraceEnabled ? "&waitForTrigger=1" : "";
  const diagnosticsParam = diagnostics
    ? `&diagnostics=${encodeURIComponent(diagnostics)}`
    : "";
  const transitionBudgetParam = transitionBudgetMs
    ? `&transitionBudgetMs=${encodeURIComponent(transitionBudgetMs)}`
    : "";
  const seedParam = seed ? `&seed=${encodeURIComponent(seed)}` : "";
  await page.goto(
    `/?adapter=${adapterId}&scenario=${scenarioId}&scale=${scale}&script=${scriptName}${rateParam}${diagnosticsParam}${transitionBudgetParam}${seedParam}&autorun=1${triggerParam}`,
  );

  // Before anything is measured: is this even our build?
  await expectServedBuildMatchesCheckout(page.locator("html"));

  await expect(page.getByLabel(adapterLabel).first()).toBeVisible();

  let cdpSession: Awaited<
    ReturnType<typeof page.context.prototype.newCDPSession>
  > | null = null;
  const cdpEvents: unknown[] = [];

  if (perfTraceEnabled) {
    try {
      cdpSession = await page.context().newCDPSession(page);
      cdpSession.on(
        "Tracing.dataCollected",
        (payload: { value: unknown[] }) => {
          for (const event of payload.value) cdpEvents.push(event);
        },
      );
      await cdpSession.send("Tracing.start", {
        categories: [
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-devtools.timeline.frame",
          "v8",
          "disabled-by-default-v8.cpu_profiler",
          "blink.user_timing",
        ].join(","),
        options: "sampling-frequency=10000",
      });
    } catch (err) {
      console.warn(
        `[bench.spec] CDP tracing start failed (best-effort, ignoring):`,
        err,
      );
      cdpSession = null;
    }
  }

  if (perfTraceEnabled) {
    await page.evaluate(() => {
      (
        window as Window & { __PRETABLE_BENCH_START__?: boolean }
      ).__PRETABLE_BENCH_START__ = true;
    });
  }

  await page.waitForFunction(() => Boolean(window.__PRETABLE_BENCH_RESULT__));

  const result = await page.evaluate(() => window.__PRETABLE_BENCH_RESULT__);

  if (perfTraceEnabled && cdpSession) {
    try {
      const session = cdpSession;
      const tracingComplete = new Promise<void>((resolve) => {
        session.once("Tracing.tracingComplete", () => resolve());
      });
      await session.send("Tracing.end");
      await tracingComplete;
      const traceRelPath =
        typeof result?.tracePath === "string"
          ? result.tracePath
          : `status/traces/${createRunArtifactFileStem(result)}.trace.zip`;
      const cdpPath = path
        .join(process.cwd(), traceRelPath)
        .replace(/\.trace\.zip$/, ".cdp.json");
      await mkdir(path.dirname(cdpPath), { recursive: true });
      await writeFile(
        cdpPath,
        JSON.stringify({ traceEvents: cdpEvents }, null, 0) + "\n",
      );
    } catch (err) {
      console.warn(
        `[bench.spec] CDP tracing stop/write failed (best-effort, ignoring):`,
        err,
      );
    }
  }

  const interactionScript =
    scriptName === "sort" ||
    scriptName === "filter-metadata" ||
    scriptName === "filter-text" ||
    // Row grouping runs the same measurement shape, so it owes the same
    // metrics and notes (see measureBenchInteractionRun).
    scriptName === "group" ||
    scriptName === "group-expand" ||
    // The typing sequence reports the interaction family set (commit 1's
    // latency/settle plus the keystroke distribution on top of it), so it owes
    // the same metrics and notes (see measureBenchFilterKeystrokesRun).
    scriptName === "filter-keystrokes";
  const updatesScript =
    scriptName === "updates" ||
    scriptName === "updates-grouped" ||
    scriptName === "group-updates" ||
    scriptName === "group-updates-stable-keys";
  const dataUpdateScript = scriptName === "replace" || scriptName === "append";

  const cwd = process.cwd();
  const summaryPath = path.join(
    cwd,
    "status",
    `${createRunArtifactFileStem(result)}.summary.json`,
  );

  // Stamp what this run measured through. The measurement happens in the page
  // and a page cannot read a package manifest, so the version comes from disk
  // here — resolved, never typed by hand. Unconditional: a summary that says
  // nothing about its comparator's version is the exact artifact that let three
  // comparator majors land on top of the May 2026 numbers unnoticed.
  const summary = {
    ...result,
    adapterVersions: createAdapterVersionsRecord([result.adapterId]),
  };

  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  // The bench-runner gates which (adapter × scenario × script) combos it
  // supports (e.g. interactions only on pretable + S2/S7, updates only on
  // pretable + S5). When a combo isn't supported, the app reports
  // status: "unsupported" — accept that and bail before the completed-run
  // assertions.
  if (result?.status === "unsupported") {
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
    if (adapterId === "pretable") {
      expect(result.notes).toContain("contain: none");
      expect(result.notes).toContain("content visibility: visible");
      expect(result.notes).toContain("contain intrinsic size: none");
      expect(result.notes).toContain("scroll anchoring: none");
      expect(result.notes).toContain("overscroll behavior: contain");
      expect(result.notes).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^internal telemetry rendered rows: \d+$/),
          expect.stringMatching(/^internal telemetry visible rows: \d+$/),
          // Fractional, not integral. A variable-height plan sums MEASURED row
          // heights, which are rarely whole pixels. This asserted `\d+` and
          // passed for years only because the scroll pass aimed at a
          // `scrollHeight` sampled before any measurement had happened, so it
          // never scrolled deep enough to pull real heights into the plan
          // (#400). The assertion was green for the same reason the benchmark
          // was wrong.
          expect.stringMatching(
            /^internal telemetry planned height: \d+(?:\.\d+)?$/,
          ),
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
          expect.stringMatching(/^internal telemetry loaded rows: \d+$/),
          // Fractional, not integral. A variable-height plan sums MEASURED row
          // heights, which are rarely whole pixels. This asserted `\d+` and
          // passed for years only because the scroll pass aimed at a
          // `scrollHeight` sampled before any measurement had happened, so it
          // never scrolled deep enough to pull real heights into the plan
          // (#400). The assertion was green for the same reason the benchmark
          // was wrong.
          expect.stringMatching(
            /^internal telemetry planned height: \d+(?:\.\d+)?$/,
          ),
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
      post_interaction_row_height_error_measurable_rows: expect.any(Number),
      result_row_count: expect.any(Number),
      selected_row_preserved: expect.any(Number),
      focused_row_preserved: expect.any(Number),
      dom_nodes_peak: expect.any(Number),
      rendered_rows_peak: expect.any(Number),
      rendered_cells_peak: expect.any(Number),
    });

    // The p95 is ABSENT, not zero, when nothing measurable wrapped — the rule
    // `row-height-error-applicability.spec.ts` proves both halves of, and the
    // one `summarizeRowHeightError` implements. Asserting the number here
    // unconditionally failed every S8 interaction script that reaches only
    // nowrap data cells (`sort`, `filter-metadata`, `filter-text`), on runs
    // whose summaries were correct and `completed`. Which branch applies is a
    // property of what the run rendered, so it is read off the run.
    const measurableRows =
      result.metrics.post_interaction_row_height_error_measurable_rows;
    const notApplicableNote = result.notes.some((note) =>
      note.startsWith(
        "post_interaction_row_height_error_p95_px not applicable",
      ),
    );
    if (measurableRows > 0) {
      expect(result.metrics).toMatchObject({
        post_interaction_row_height_error_p95_px: expect.any(Number),
      });
      expect(notApplicableNote).toBe(false);
    } else {
      expect(
        result.metrics.post_interaction_row_height_error_p95_px,
      ).toBeUndefined();
      expect(notApplicableNote).toBe(true);
    }

    if (
      adapterId === "pretable" &&
      scriptName === "group" &&
      diagnostics === "row-model"
    ) {
      const queryTransition = result.rowModel?.queryTransition;
      expect(queryTransition).toMatchObject({
        status: "completed",
        durationMs: expect.any(Number),
        preModelHandoffMs: expect.any(Number),
        postModelSurfaceMs: expect.any(Number),
        rowsEvaluated: expect.any(Number),
        sliceCount: expect.any(Number),
        schedulerWaitCount: expect.any(Number),
      });
      for (const field of [
        "durationMs",
        "preModelHandoffMs",
        "postModelSurfaceMs",
        "rowsEvaluated",
        "transitionRows",
        "sliceCount",
        "sliceTotalMs",
        "sliceP95Ms",
        "sliceMaxMs",
        "schedulerWaitCount",
        "schedulerWaitTotalMs",
        "schedulerWaitP95Ms",
        "schedulerWaitMaxMs",
        "residualMs",
      ] as const) {
        expect(Number.isFinite(queryTransition[field])).toBe(true);
        expect(queryTransition[field]).toBeGreaterThanOrEqual(0);
      }
      expect(
        queryTransition.preModelHandoffMs +
          queryTransition.durationMs +
          queryTransition.postModelSurfaceMs,
      ).toBeCloseTo(
        result.metrics.interaction_latency_ms! +
          result.metrics.settle_duration_ms!,
        5,
      );
      if (transitionBudgetMs) {
        expect(result.notes).toContain(
          `requested row model transition budget ms: ${Number(transitionBudgetMs)}`,
        );
      }
    }
  }

  if (scriptName === "filter-keystrokes" && result.status === "completed") {
    // The distribution the script exists for: at least a cold commit plus one
    // warm commit (dev/smoke scales collapse the sequence to exactly two), and
    // the warm percentiles ordered the only way percentiles can be.
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

  if (updatesScript) {
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^updates total: \d+$/),
        expect.stringMatching(/^update rate per sec: \d+$/),
        expect.stringMatching(/^updates per tick: \d+$/),
        expect.stringMatching(/^batch interval ms: \d+$/),
      ]),
    );
    expect(result.metrics).toMatchObject({
      scroll_frame_p95_ms: expect.any(Number),
      long_tasks_count: expect.any(Number),
      scroll_position_drift_px: expect.any(Number),
      visible_row_count_drift: expect.any(Number),
    });
    if (diagnostics === "row-model") {
      expect(result.metrics).toMatchObject({
        row_model_commit_p95_ms: expect.any(Number),
        rebuild_slice_max_ms: expect.any(Number),
      });
      expect(result.rowModel).toMatchObject({
        diagnostics: true,
        acceptedPatchCount: 3_000,
        checksumAcceptedPatchCount: 3_000,
        finalChecksum: expect.any(String),
        expectedFinalChecksum: expect.any(String),
      });
      expect(result.rowModel.finalChecksum).toBe(
        result.rowModel.expectedFinalChecksum,
      );
    }
  }

  if (dataUpdateScript) {
    expect(result.notes).toContain(`data update mode: ${scriptName}`);
    expect(result.metrics).toMatchObject({
      interaction_latency_ms: expect.any(Number),
      settle_duration_ms: expect.any(Number),
      scroll_position_drift_px: expect.any(Number),
      grid_instance_reconstructed: expect.any(Number),
      result_row_count: expect.any(Number),
    });
    // The engine absorbed the change; it did not rebuild. Note the polarity: this
    // metric passes at 0, the inverse of the preservation metrics below it.
    expect(result.metrics.grid_instance_reconstructed).toBe(0);
    expect(result.metrics.selected_row_preserved).toBe(1);
    expect(result.metrics.focused_row_preserved).toBe(1);
    // Both timings are differences between rAF timestamps and so are integer
    // multiples of the frame interval. The artifact has to carry the frame counts or
    // a reader cannot tell a measurement from the one-frame floor.
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^frame interval median ms: [\d.]+$/),
        expect.stringMatching(/^frames to first change: \d+$/),
        expect.stringMatching(/^frames to settle: \d+ \(floor \d+\)$/),
        // These scripts hold a WINDOW of the scenario, not all of it, and the
        // artifact is filed under the scenario's own scale.
        expect.stringMatching(
          /^resident rows: \d+ to \d+ \(scenario holds \d+\)$/,
        ),
        expect.stringMatching(/^probe column: \S+$/),
      ]),
    );

    const arrivedNote = result.notes.find((note) =>
      note.startsWith("rows newly rendered by the update: "),
    );
    const arrivedRows = Number(arrivedNote?.split(": ")[1]);

    if (scriptName === "append") {
      // The append is measured from a viewport parked at the tail of the resident
      // set. If its new rows never enter the DOM, blank-gap frames, anchor shift and
      // row-height error are all computed over rows the append never touched and
      // score perfectly for having rendered nothing.
      expect(arrivedRows).toBeGreaterThan(0);
    } else {
      // A replace reuses every id, so nothing is "new" — the same assertion inverted
      // is what proves the count tracks arrivals rather than repaints.
      expect(arrivedRows).toBe(0);
    }
  }

  const dashboardPath = path.join(cwd, "status", "dashboard.json");
  const tracePath = path.join(cwd, result.tracePath);

  await mkdir(path.dirname(tracePath), { recursive: true });
  await page.context().tracing.stop({ path: tracePath });

  const existingDashboard = await readDashboard(dashboardPath);
  const nextDashboard = createDashboardIndex([
    ...existingDashboard.runs,
    summary,
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
