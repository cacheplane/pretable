import { describe, expect, test } from "vitest";

import type { BenchMetricId, BenchRunRequest } from "../index";
import {
  benchMetricIds,
  benchScriptNames,
  createArtifactFileStem,
  createBenchRunSummary,
  createDashboardIndex,
  createRunArtifactFileStem,
  getBenchAdapterFamily,
  validateSupportedP0aRequest,
} from "../index";

const baseRequest = {
  adapterId: "pretable" as const,
  profile: "default" as const,
  scenarioId: "S1" as const,
  scale: "dev" as const,
  scriptName: "initial" as const,
  browserName: "chromium" as const,
  browserVersion: "123.0",
  seed: 101,
  rowCount: 2_000,
  viewport: { width: 1440, height: 900 },
  fontStack: '"IBM Plex Sans", system-ui, sans-serif',
  deviceScaleFactor: 1,
};

// Shared request-builder helper for tests that only need to vary a couple of
// fields off the baseline P0a request.
function createRequest(overrides: Partial<BenchRunRequest> = {}): BenchRunRequest {
  return { ...baseRequest, ...overrides };
}

const TS = "2026-08-27T00:00:00.000Z";

// Everything a completed sort/filter/group interaction run owes. Extracted so
// the filter-keystrokes tests (which owe this family's metrics PLUS the
// keystroke-distribution set) don't hand-roll a second copy that could drift
// from the sort/filter/group fixtures.
const COMPLETED_INTERACTION_METRICS = {
  interaction_latency_ms: 14,
  settle_duration_ms: 16,
  post_interaction_blank_gap_frames: 0,
  post_interaction_anchor_shift_px: 0,
  post_interaction_row_height_error_p95_px: 0,
  post_interaction_row_height_error_measurable_rows: 11,
  result_row_count: 754,
  selected_row_preserved: 1,
  focused_row_preserved: 1,
  dom_nodes_peak: 900,
} satisfies Partial<Record<BenchMetricId, number>>;

describe("bench-runner contract", () => {
  test("reserves the full benchmark metric and script schema", () => {
    expect(benchMetricIds).toEqual(
      expect.arrayContaining([
        "mount_ms",
        "first_stable_viewport_ms",
        "scroll_frame_p95_ms",
        "blank_gap_frames",
        "long_tasks_count",
        "long_tasks_ms",
        "dom_nodes_peak",
        "scroll_viewport_nodes_peak",
        "rendered_rows_peak",
        "rendered_cells_peak",
        "heap_delta_mb",
        "ua_memory_mb",
        "interaction_latency_ms",
        "settle_duration_ms",
        "post_interaction_blank_gap_frames",
        "post_interaction_anchor_shift_px",
        "post_interaction_row_height_error_p95_px",
        "post_interaction_row_height_error_measurable_rows",
        "result_row_count",
        "selected_row_preserved",
        "focused_row_preserved",
        "row_height_error_p95_px",
        "row_height_error_measurable_rows",
        "autosize_error_p95_px",
        "update_latency_p95_ms",
        "autosize_runtime_ms",
        "scroll_anchor_shift_px",
        "scroll_anchor_shift_forward_p95_px",
        "scroll_anchor_shift_backward_p95_px",
        "grid_instance_reconstructed",
        "keystroke_commits_observed",
        "keystroke_first_total_ms",
        "keystroke_warm_total_p50_ms",
        "keystroke_warm_total_p95_ms",
        "keystroke_warm_total_max_ms",
      ]),
    );

    expect(benchScriptNames).toEqual([
      "initial",
      "scroll",
      "sort",
      "filter-metadata",
      "filter-text",
      "filter-keystrokes",
      "updates",
      "updates-grouped",
      "autosize",
      "select-range-extend",
      "keyboard-nav-row",
      "select-all",
      "scroll-with-format",
      "scroll-with-render",
      "scroll-with-heavy-render",
      "group",
      "group-expand",
      "group-updates",
      "group-updates-stable-keys",
      "replace",
      "append",
    ]);
  });

  test("requires the replace/append metrics D1-PERF-04 measures separately", () => {
    for (const scriptName of ["replace", "append"] as const) {
      expect(() =>
        createBenchRunSummary({
          request: { ...baseRequest, scriptName },
          status: "completed",
          timestamp: "2026-08-10T00:00:00.000Z",
          tracePath: "traces/row-set-change.json",
          metrics: { dom_nodes_peak: 1 },
          notes: [],
        }),
      ).toThrow(/Missing required metric: interaction_latency_ms/);
    }
  });

  // Everything a completed replace or append owes, so a test can drop exactly
  // one entry and watch that one be named.
  const rowSetChangeMetrics = {
    dom_nodes_peak: 1,
    interaction_latency_ms: 12,
    settle_duration_ms: 18,
    post_interaction_blank_gap_frames: 0,
    post_interaction_anchor_shift_px: 0,
    post_interaction_row_height_error_p95_px: 0,
    post_interaction_row_height_error_measurable_rows: 11,
    result_row_count: 200,
    selected_row_preserved: 1,
    focused_row_preserved: 1,
    scroll_position_drift_px: 0,
    grid_instance_reconstructed: 0,
  } satisfies Partial<Record<BenchMetricId, number>>;

  // Dropping ONE metric at a time is the only shape that pins the whole list.
  // A single object missing everything proves only that the FIRST entry throws,
  // so every entry after it could be deleted with the suite still green.
  test("names every replace/append metric that goes missing on its own", () => {
    for (const scriptName of ["replace", "append"] as const) {
      const request = { ...baseRequest, scriptName };
      const input = {
        request,
        status: "completed" as const,
        timestamp: "2026-08-10T00:00:00.000Z",
        tracePath: `traces/${scriptName}.json`,
        notes: [],
      };

      expect(
        createBenchRunSummary({ ...input, metrics: rowSetChangeMetrics }),
      ).toMatchObject({ status: "completed", scriptName });

      for (const metricId of Object.keys(rowSetChangeMetrics)) {
        expect(() =>
          createBenchRunSummary({
            ...input,
            metrics: Object.fromEntries(
              Object.entries(rowSetChangeMetrics).filter(
                ([id]) => id !== metricId,
              ),
            ) as Partial<Record<BenchMetricId, number>>,
          }),
        ).toThrow(`Missing required metric: ${metricId}`);
      }
    }
  });

  // 0 is the PASSING value for grid_instance_reconstructed and for
  // scroll_position_drift_px — the opposite of the *_preserved pair they are
  // required alongside. compactMetrics drops undefined, not falsy, so a passing
  // run must still carry both rather than reading as a run that omitted them.
  test("keeps the passing zero of both replace/append budget metrics", () => {
    expect(
      createBenchRunSummary({
        request: { ...baseRequest, scriptName: "replace" },
        status: "completed",
        timestamp: "2026-08-10T00:00:00.000Z",
        tracePath: "traces/replace.json",
        metrics: rowSetChangeMetrics,
        notes: [],
      }),
    ).toMatchObject({
      metrics: { grid_instance_reconstructed: 0, scroll_position_drift_px: 0 },
    });
  });

  // A row-height error p95 means nothing without the count of rows it could
  // have been wrong on: `scrollHeight` is floored at `clientHeight`, so a grid
  // rendering `white-space: nowrap` scores 0 no matter how badly it lays rows
  // out (#414). The two metrics have to agree in BOTH directions, and both
  // directions are asserted here — a check that only refused the p95-without-
  // measurement half would let "not applicable" become a cheaper way to satisfy
  // every requirement above than measuring.
  describe("row-height error is reported with the count of rows it could fail on", () => {
    const scrollMetrics = {
      dom_nodes_peak: 400,
      scroll_frame_p95_ms: 9.7,
      long_tasks_count: 0,
      long_tasks_ms: 0,
    } satisfies Partial<Record<BenchMetricId, number>>;

    const scrollRun = (metrics: Partial<Record<BenchMetricId, number>>) =>
      createBenchRunSummary({
        request: { ...baseRequest, scriptName: "scroll" as const },
        status: "completed",
        timestamp: "2026-08-12T00:00:00.000Z",
        tracePath: "traces/scroll.json",
        metrics: { ...scrollMetrics, ...metrics },
        notes: [],
      });

    test("refuses a p95 the run had nothing to measure it on", () => {
      expect(() =>
        scrollRun({
          row_height_error_measurable_rows: 0,
          row_height_error_p95_px: 0,
        }),
      ).toThrow(
        /row_height_error_p95_px was reported with row_height_error_measurable_rows: 0/,
      );
    });

    test("refuses a missing p95 once a row could have failed it", () => {
      expect(() =>
        scrollRun({ row_height_error_measurable_rows: 264 }),
      ).toThrow(/Missing required metric: row_height_error_p95_px/);
    });

    test("keeps a not-applicable run, with the count and without the p95", () => {
      const summary = scrollRun({ row_height_error_measurable_rows: 0 });

      expect(summary).toMatchObject({
        status: "completed",
        metrics: { row_height_error_measurable_rows: 0 },
      });
      expect(
        (summary as { metrics: Record<string, number> }).metrics
          .row_height_error_p95_px,
      ).toBeUndefined();
    });

    test("keeps an earned zero", () => {
      expect(
        scrollRun({
          row_height_error_measurable_rows: 264,
          row_height_error_p95_px: 0,
        }),
      ).toMatchObject({
        metrics: {
          row_height_error_measurable_rows: 264,
          row_height_error_p95_px: 0,
        },
      });
    });

    // The post-interaction pair runs the same rule; asserted separately because
    // it is a separate call, and one of the two could be deleted in silence.
    test("holds the post-interaction pair to the same rule", () => {
      expect(() =>
        createBenchRunSummary({
          request: {
            ...baseRequest,
            scenarioId: "S2" as const,
            scriptName: "sort" as const,
          },
          status: "completed",
          timestamp: "2026-08-12T00:00:00.000Z",
          tracePath: "traces/sort.json",
          metrics: {
            dom_nodes_peak: 400,
            interaction_latency_ms: 24,
            settle_duration_ms: 18,
            post_interaction_blank_gap_frames: 0,
            post_interaction_anchor_shift_px: 0,
            post_interaction_row_height_error_measurable_rows: 0,
            post_interaction_row_height_error_p95_px: 0,
            result_row_count: 750,
            selected_row_preserved: 1,
            focused_row_preserved: 1,
          },
          notes: [],
        }),
      ).toThrow(
        /post_interaction_row_height_error_p95_px was reported with post_interaction_row_height_error_measurable_rows: 0/,
      );
    });
  });

  // A `partial` owes only dom_nodes_peak, and scripts/check-bench-budgets.mjs
  // skips every non-completed run — so a partial replace would let a budget
  // report come back green having measured nothing. Refusing the status is what
  // makes an unmeasurable run stop the bench instead of quietly thinning the
  // ledger.
  test("refuses a partial replace or append rather than banking an unmeasured run", () => {
    for (const scriptName of ["replace", "append"] as const) {
      expect(() =>
        createBenchRunSummary({
          request: { ...baseRequest, scriptName },
          status: "partial",
          timestamp: "2026-08-10T00:00:00.000Z",
          tracePath: `traces/${scriptName}.json`,
          metrics: rowSetChangeMetrics,
          notes: [],
        }),
      ).toThrow(
        `Partial runs cannot substantiate the ${scriptName} budget: record it as failed`,
      );
    }

    // Deliberate asymmetry, not a new global rule: the interaction family still
    // banks a partial, because its numbers are comparative rather than a single
    // budgeted figure.
    expect(
      createBenchRunSummary({
        request: { ...baseRequest, scriptName: "sort", scenarioId: "S2" },
        status: "partial",
        timestamp: "2026-08-10T00:00:00.000Z",
        tracePath: "traces/sort.json",
        metrics: { dom_nodes_peak: 1 },
        notes: [],
      }),
    ).toMatchObject({ status: "partial", scriptName: "sort" });
  });

  // The other half of the rule above: refusing the status is only tolerable
  // because the run has somewhere to go. A `failed` replace records without
  // meeting the metric list, and keeps both the error and the notes the
  // measurement collected before it stopped — the only two places the cause can
  // live, since a failed summary carries no metrics.
  test("records a stopped replace with the reason it stopped", () => {
    expect(
      createBenchRunSummary({
        request: { ...baseRequest, scriptName: "replace" },
        status: "failed",
        timestamp: "2026-08-10T00:00:00.000Z",
        tracePath: "traces/replace.json",
        notes: ["data update mode: replace", "frames to first change: 0"],
        error: {
          name: "BenchDataUpdateAbort",
          message:
            "data update mode: replace: no frame changed the watched signature within 60 frames after the trigger",
        },
      }),
    ).toMatchObject({
      status: "failed",
      scriptName: "replace",
      notes: ["data update mode: replace", "frames to first change: 0"],
      error: {
        message: expect.stringContaining("no frame changed the watched"),
      },
    });
  });

  test("enforces the explicit P0a support matrix", () => {
    expect(validateSupportedP0aRequest(baseRequest)).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "ag-grid",
        scenarioId: "S2",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "tanstack",
        scenarioId: "S2",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "mui",
        scenarioId: "S2",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "pretable",
        scenarioId: "S2",
        scriptName: "sort",
      }),
    ).toEqual({ ok: true });
    // B2 follow-up #5b: sort + filter scripts now support all four
    // adapters on S2/S7. Each adapter wires its native sort/filter API
    // in apps/bench/src/*-adapter.tsx.
    for (const adapterId of [
      "pretable",
      "ag-grid",
      "tanstack",
      "mui",
    ] as const) {
      for (const scriptName of [
        "sort",
        "filter-metadata",
        "filter-text",
      ] as const) {
        expect(
          validateSupportedP0aRequest({
            ...baseRequest,
            adapterId,
            scenarioId: "S2",
            scriptName,
          }),
        ).toEqual({ ok: true });
      }
    }
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "pretable",
        scenarioId: "S1",
        scriptName: "filter-text",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S3",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });

    // S3 does NOT support interaction scripts
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S3",
        scriptName: "sort",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S5",
        scriptName: "updates",
      }),
    ).toEqual({ ok: true });

    // S5 does NOT support interaction scripts
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S5",
        scriptName: "sort",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    // updates script supports all four adapters on S5 — comparative claim
    // shipped in PR #15 → comparative promotion (each adapter wires its
    // own idiomatic streaming path in apps/bench/src/*-adapter.tsx).
    for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          adapterId,
          scenarioId: "S5",
          scriptName: "updates",
        }),
      ).toEqual({ ok: true });
    }

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "pretable",
        scenarioId: "S5",
        scriptName: "updates-grouped",
      }),
    ).toEqual({ ok: true });

    for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          adapterId,
          scenarioId: "S5",
          scriptName: "updates-grouped",
        }),
      ).toEqual({
        ok: false,
        reason: expect.stringContaining("adapter"),
      });
    }

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "pretable",
        scenarioId: "S2",
        scriptName: "updates-grouped",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    // updates script is S5-only
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S2",
        scriptName: "updates",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    // Cell-renderer scripts are supported across all four adapters on S2
    // (each adapter wires scriptName-driven render branches in
    // apps/bench/src/*-adapter.tsx). B2 follow-up #5a opened the gate that
    // had previously kept these pretable-only.
    for (const adapterId of [
      "pretable",
      "ag-grid",
      "tanstack",
      "mui",
    ] as const) {
      for (const scriptName of [
        "scroll-with-format",
        "scroll-with-render",
        "scroll-with-heavy-render",
      ] as const) {
        expect(
          validateSupportedP0aRequest({
            ...baseRequest,
            adapterId,
            scenarioId: "S2",
            scriptName,
          }),
        ).toEqual({ ok: true });
      }
    }

    // Cell-renderer scripts are still S2-only.
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S5",
        scriptName: "scroll-with-format",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    // Selection scripts remain pretable-only (Community-tier paid in AG
    // Grid + MUI; not native in TanStack).
    for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          adapterId,
          scenarioId: "S2",
          scriptName: "select-range-extend",
        }),
      ).toEqual({
        ok: false,
        reason: expect.stringContaining("adapter"),
      });
    }

    // Row-grouping scripts: accepted for pretable on their own scenarios.
    for (const scenarioId of ["S2", "S7"] as const) {
      for (const scriptName of ["group", "group-expand"] as const) {
        expect(
          validateSupportedP0aRequest({
            ...baseRequest,
            adapterId: "pretable",
            scenarioId,
            scriptName,
          }),
        ).toEqual({ ok: true });
      }
    }

    for (const scriptName of [
      "group-updates",
      "group-updates-stable-keys",
    ] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          adapterId: "pretable",
          scenarioId: "S5",
          scriptName,
        }),
      ).toEqual({ ok: true });
    }

    // `group` is COMPARATIVE against TanStack: v9 ships the grouping row
    // model, aggregation and expansion in the free package, and the tanstack
    // adapter registers them with aggregation parity. AG Grid and MUI stay
    // excluded on tier (Enterprise / Premium respectively).
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "tanstack",
        scenarioId: "S2",
        scriptName: "group",
      }),
    ).toEqual({ ok: true });
    for (const adapterId of ["ag-grid", "mui"] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          adapterId,
          scenarioId: "S2",
          scriptName: "group",
        }),
      ).toEqual({
        ok: false,
        reason: expect.stringContaining("Enterprise"),
      });
    }
    // `group-expand` stays pretable-only for a PLUMBING reason (bench-app's
    // setup/trigger machinery), which the tanstack rejection must state —
    // repeating the stale "absent from TanStack" claim here is exactly what
    // this test previously did.
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "tanstack",
        scenarioId: "S2",
        scriptName: "group-expand",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("plumbing"),
    });
    for (const adapterId of ["ag-grid", "mui"] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          adapterId,
          scenarioId: "S2",
          scriptName: "group-expand",
        }),
      ).toEqual({
        ok: false,
        reason: expect.stringContaining("adapter"),
      });
    }
    for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
      for (const scriptName of [
        "group-updates",
        "group-updates-stable-keys",
      ] as const) {
        expect(
          validateSupportedP0aRequest({
            ...baseRequest,
            adapterId,
            scenarioId: "S5",
            scriptName,
          }),
        ).toEqual({
          ok: false,
          reason: expect.stringContaining("adapter"),
        });
      }
    }

    // The adapter gate fires ahead of the scenario gate, so a comparator gets
    // told the real reason rather than a scenario red herring.
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "ag-grid",
        scenarioId: "S1",
        scriptName: "group",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("adapter"),
    });

    // group / group-expand are S2/S7-only; both streaming variants are
    // S5-only.
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S5",
        scriptName: "group",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S1",
        scriptName: "group-expand",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    for (const scriptName of [
      "group-updates",
      "group-updates-stable-keys",
    ] as const) {
      expect(
        validateSupportedP0aRequest({
          ...baseRequest,
          scenarioId: "S2",
          scriptName,
        }),
      ).toEqual({
        ok: false,
        reason: expect.stringContaining("scenario"),
      });
    }

    // replace/append drive `setRows(rows, meta)` on a preserved instance —
    // a pretable primitive, so no other adapter can run them.
    for (const scriptName of ["replace", "append"] as const) {
      expect(
        validateSupportedP0aRequest({ ...baseRequest, scriptName }),
      ).toEqual({ ok: true });

      for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
        expect(
          validateSupportedP0aRequest({
            ...baseRequest,
            adapterId,
            scriptName,
          }),
        ).toEqual({
          ok: false,
          reason: expect.stringContaining("pretable-only"),
        });
      }
    }

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        profile: "tuned",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("profile"),
    });

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S6",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("scenario"),
    });

    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scriptName: "autosize",
      }),
    ).toEqual({
      ok: false,
      reason: expect.stringContaining("script"),
    });

    expect(
      createBenchRunSummary({
        request: {
          ...baseRequest,
          adapterId: "mui",
          scenarioId: "S2",
          scriptName: "scroll",
        },
        status: "completed",
        timestamp: "2026-04-10T13:00:00.000Z",
        tracePath: "status/traces/mui-s2-default-scroll.trace.zip",
        metrics: {
          scroll_frame_p95_ms: 18,
          blank_gap_frames: 0,
          long_tasks_count: 0,
          long_tasks_ms: 0,
          dom_nodes_peak: 64,
        },
      }),
    ).toMatchObject({ status: "completed", adapterId: "mui" });

    expect(() =>
      createBenchRunSummary({
        request: {
          ...baseRequest,
          scenarioId: "S2",
          scriptName: "sort",
        },
        status: "completed",
        timestamp: "2026-04-10T13:00:00.000Z",
        tracePath: "status/traces/pretable-s2-default-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 24,
          dom_nodes_peak: 64,
        },
      }),
    ).toThrow(/settle_duration_ms/);
  });

  test("accepts S7 for scroll and interaction scripts", () => {
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S7",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S7",
        scriptName: "sort",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S7",
        scriptName: "filter-metadata",
      }),
    ).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        scenarioId: "S7",
        scriptName: "filter-text",
      }),
    ).toEqual({ ok: true });
  });

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
      ...COMPLETED_INTERACTION_METRICS,
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

  test("serializes unsupported, partial, and completed runs with stable fields", () => {
    expect(
      createBenchRunSummary({
        request: {
          ...baseRequest,
          scenarioId: "S4",
          scriptName: "autosize",
        },
        status: "unsupported",
        reason: "autosize is not runnable in P0a",
        timestamp: "2026-04-10T13:00:00.000Z",
      }),
    ).toMatchObject({
      status: "unsupported",
      unsupported: {
        adapterId: "pretable",
        scenarioId: "S4",
        profile: "default",
        scriptName: "autosize",
        reason: "autosize is not runnable in P0a",
      },
    });

    expect(
      createBenchRunSummary({
        request: {
          ...baseRequest,
          scriptName: "scroll",
        },
        status: "partial",
        timestamp: "2026-04-10T13:00:00.000Z",
        tracePath: "status/traces/pretable-s1-default-scroll.trace.zip",
        notes: ["observer metrics unavailable in current runtime"],
        metrics: {
          dom_nodes_peak: 64,
        },
      }),
    ).toMatchObject({
      status: "partial",
      metrics: {
        dom_nodes_peak: 64,
      },
      tracePath: "status/traces/pretable-s1-default-scroll.trace.zip",
    });

    expect(() =>
      createBenchRunSummary({
        request: baseRequest,
        status: "completed",
        timestamp: "2026-04-10T13:00:00.000Z",
        tracePath: "status/traces/pretable-s1-default-initial.trace.zip",
        metrics: {
          mount_ms: 12,
          dom_nodes_peak: 20,
        },
      }),
    ).toThrow(/first_stable_viewport_ms/);

    expect(() =>
      createBenchRunSummary({
        request: baseRequest,
        status: "completed",
        timestamp: "2026-04-10T13:00:00.000Z",
        tracePath: "status/traces/pretable-s1-default-initial.trace.zip",
        metrics: {
          mount_ms: Number.NaN,
          first_stable_viewport_ms: 18,
          dom_nodes_peak: 20,
        },
      }),
    ).toThrow(/finite/);
  });

  test("holds the row-grouping scripts to their measurement shape's metrics", () => {
    const groupingInteractionMetrics = {
      interaction_latency_ms: 14,
      settle_duration_ms: 16,
      post_interaction_blank_gap_frames: 0,
      post_interaction_anchor_shift_px: 0,
      post_interaction_row_height_error_p95_px: 0,
      post_interaction_row_height_error_measurable_rows: 11,
      result_row_count: 754,
      selected_row_preserved: 1,
      focused_row_preserved: 1,
      dom_nodes_peak: 900,
    };

    for (const scriptName of ["group", "group-expand"] as const) {
      const request = {
        ...baseRequest,
        scenarioId: "S2" as const,
        scriptName,
      };

      expect(
        createBenchRunSummary({
          request,
          status: "completed",
          timestamp: "2026-08-10T13:00:00.000Z",
          tracePath: `status/traces/pretable-s2-default-${scriptName}.trace.zip`,
          metrics: groupingInteractionMetrics,
        }),
      ).toMatchObject({ status: "completed", scriptName });

      // Same shape as sort / filter-metadata: every interaction metric is
      // required, so a silently missing one cannot pass as a result.
      expect(() =>
        createBenchRunSummary({
          request,
          status: "completed",
          timestamp: "2026-08-10T13:00:00.000Z",
          tracePath: `status/traces/pretable-s2-default-${scriptName}.trace.zip`,
          metrics: {
            ...groupingInteractionMetrics,
            interaction_latency_ms: undefined,
          },
        }),
      ).toThrow(/interaction_latency_ms/);
    }

    const groupUpdatesMetrics = {
      scroll_frame_p95_ms: 8.4,
      long_tasks_count: 2,
      long_tasks_ms: 90,
      streaming_cls: 0,
      frame_max_ms: 21,
      frame_budget_overruns_count: 3,
      long_tasks_max_ms: 60,
      scroll_position_drift_px: 0,
      visible_row_count_drift: 0,
      dom_nodes_peak: 900,
    };

    // Both grouped streaming variants owe the same metric set — that is what
    // makes the churn-free one readable against the churning one.
    for (const scriptName of [
      "group-updates",
      "group-updates-stable-keys",
    ] as const) {
      const groupUpdatesRequest = {
        ...baseRequest,
        scenarioId: "S5" as const,
        scriptName,
      };
      const tracePath = `status/traces/pretable-s5-default-${scriptName}.trace.zip`;

      expect(
        createBenchRunSummary({
          request: groupUpdatesRequest,
          status: "completed",
          timestamp: "2026-08-10T13:00:00.000Z",
          tracePath,
          metrics: groupUpdatesMetrics,
        }),
      ).toMatchObject({ status: "completed", scriptName });

      expect(() =>
        createBenchRunSummary({
          request: groupUpdatesRequest,
          status: "completed",
          timestamp: "2026-08-10T13:00:00.000Z",
          tracePath,
          metrics: { ...groupUpdatesMetrics, streaming_cls: undefined },
        }),
      ).toThrow(/streaming_cls/);
    }
  });

  test("serializes failed runs and aggregates dashboard entries deterministically", () => {
    expect(getBenchAdapterFamily("pretable")).toBe("candidate");
    expect(getBenchAdapterFamily("ag-grid")).toBe("full-grid");
    expect(getBenchAdapterFamily("tanstack")).toBe("virtualization-primitive");
    expect(getBenchAdapterFamily("mui")).toBe("full-grid");

    const failed = createBenchRunSummary({
      request: baseRequest,
      status: "failed",
      timestamp: "2026-04-10T13:00:00.000Z",
      tracePath: "status/traces/pretable-s1-default-initial.trace.zip",
      error: {
        name: "AdapterError",
        message: "benchmark mount failed",
      },
    });

    expect(failed).toMatchObject({
      status: "failed",
      error: {
        name: "AdapterError",
        message: "benchmark mount failed",
      },
    });

    expect(createArtifactFileStem(baseRequest)).toBe(
      "chromium-pretable-default-s1-dev-initial",
    );

    expect(
      createRunArtifactFileStem({
        ...baseRequest,
        timestamp: "2026-04-10T13:00:00.000Z",
      }),
    ).toBe("chromium-pretable-default-s1-dev-initial-2026-04-10t13-00-00-000z");

    const completed = createBenchRunSummary({
      request: baseRequest,
      status: "completed",
      timestamp: "2026-04-10T13:00:00.000Z",
      tracePath: "status/traces/pretable-s1-default-initial.trace.zip",
      metrics: {
        mount_ms: 12,
        first_stable_viewport_ms: 18,
        dom_nodes_peak: 20,
      },
    });

    expect(completed).toMatchObject({
      scale: "dev",
      rowCount: 2_000,
    });

    const secondCompleted = createBenchRunSummary({
      request: {
        ...baseRequest,
        scenarioId: "S2",
      },
      status: "completed",
      timestamp: "2026-04-10T13:00:00.000Z",
      tracePath: "status/traces/pretable-s2-default-initial.trace.zip",
      metrics: {
        mount_ms: 22,
        first_stable_viewport_ms: 28,
        dom_nodes_peak: 24,
      },
    });

    expect(
      createDashboardIndex([secondCompleted, completed, failed]),
    ).toMatchObject({
      adapters: [
        {
          adapterId: "pretable",
          adapterFamily: "candidate",
        },
      ],
      runs: [failed, secondCompleted],
    });

    const refreshedCompleted = createBenchRunSummary({
      request: baseRequest,
      status: "completed",
      timestamp: "2026-04-10T13:05:00.000Z",
      tracePath:
        "status/traces/chromium-pretable-default-s1-initial-2026-04-10t13-05-00-000z.trace.zip",
      metrics: {
        mount_ms: 10,
        first_stable_viewport_ms: 16,
        dom_nodes_peak: 18,
      },
    });

    expect(
      createDashboardIndex([completed, refreshedCompleted, secondCompleted]),
    ).toMatchObject({
      adapters: [
        {
          adapterId: "pretable",
          adapterFamily: "candidate",
        },
      ],
      runs: [secondCompleted, refreshedCompleted],
    });

    const gridAlphaCompleted = createBenchRunSummary({
      request: {
        ...baseRequest,
        adapterId: "ag-grid",
        scenarioId: "S2",
      },
      status: "completed",
      timestamp: "2026-04-10T13:06:00.000Z",
      tracePath:
        "status/traces/chromium-ag-grid-default-s2-dev-initial-2026-04-10t13-06-00-000z.trace.zip",
      metrics: {
        mount_ms: 30,
        first_stable_viewport_ms: 34,
        dom_nodes_peak: 48,
      },
    });

    expect(
      createDashboardIndex([completed, refreshedCompleted, gridAlphaCompleted]),
    ).toMatchObject({
      adapters: [
        {
          adapterId: "ag-grid",
          adapterFamily: "full-grid",
        },
        {
          adapterId: "pretable",
          adapterFamily: "candidate",
        },
      ],
      runs: [refreshedCompleted, gridAlphaCompleted],
    });
  });
});
