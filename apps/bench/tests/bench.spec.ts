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
const updateRatePerSec = process.env.PRETABLE_BENCH_UPDATE_RATE_PER_SEC;
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
  await page.goto(
    `/?adapter=${adapterId}&scenario=${scenarioId}&scale=${scale}&script=${scriptName}${rateParam}&autorun=1`,
  );

  await expect(page.getByText(adapterLabel)).toBeVisible();

  await page.waitForFunction(() => Boolean(window.__PRETABLE_BENCH_RESULT__));

  const result = await page.evaluate(() => window.__PRETABLE_BENCH_RESULT__);

  const interactionScript =
    scriptName === "sort" ||
    scriptName === "filter-metadata" ||
    scriptName === "filter-text";

  const cwd = process.cwd();
  const summaryPath = path.join(
    cwd,
    "status",
    `${createRunArtifactFileStem(result)}.summary.json`,
  );

  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(result, null, 2)}\n`);

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
