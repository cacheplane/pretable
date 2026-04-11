import { describe, expect, test } from "vitest";

import {
  benchMetricIds,
  benchScriptNames,
  createArtifactFileStem,
  createBenchRunSummary,
  createDashboardIndex,
  createRunArtifactFileStem,
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
        "interaction_latency_p95_ms",
        "row_height_error_p95_px",
        "autosize_error_p95_px",
        "update_latency_p95_ms",
        "autosize_runtime_ms",
        "scroll_anchor_shift_px",
        "scroll_anchor_shift_forward_p95_px",
        "scroll_anchor_shift_backward_p95_px",
      ]),
    );

    expect(benchScriptNames).toEqual([
      "initial",
      "scroll",
      "sort",
      "filter",
      "updates",
      "autosize",
    ]);
  });

  test("enforces the explicit P0a support matrix", () => {
    expect(validateSupportedP0aRequest(baseRequest)).toEqual({ ok: true });
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "gridalpha",
        scenarioId: "S2",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });

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
        scenarioId: "S4",
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

    expect(() =>
      createBenchRunSummary({
        request: {
          ...baseRequest,
          adapterId: "gridgamma",
          scenarioId: "S2",
          scriptName: "scroll",
        },
        status: "completed",
        timestamp: "2026-04-10T13:00:00.000Z",
        tracePath: "status/traces/gridgamma-s2-default-scroll.trace.zip",
        metrics: {
          scroll_frame_p95_ms: 18,
          blank_gap_frames: 0,
          long_tasks_count: 0,
          long_tasks_ms: 0,
          dom_nodes_peak: 64,
        },
      }),
    ).toThrow(/Unsupported/);
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

  test("serializes failed runs and aggregates dashboard entries deterministically", () => {
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

    expect(createDashboardIndex([secondCompleted, completed, failed])).toMatchObject({
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

    expect(createDashboardIndex([completed, refreshedCompleted, secondCompleted])).toMatchObject({
      runs: [secondCompleted, refreshedCompleted],
    });
  });
});
