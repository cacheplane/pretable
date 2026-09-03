import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ScenarioRow } from "@pretable-internal/scenario-data";
import { createScenarioDataset } from "@pretable-internal/scenario-data";

const pretableAdapterSpy = vi.hoisted(() => vi.fn());

vi.mock("../pretable-adapter", () => ({
  PretableAdapter: (props: unknown) => {
    pretableAdapterSpy(props);
    return <div data-testid="pretable-adapter" />;
  },
}));

import { BenchApp } from "../bench-app";
import { BENCH_RESULT_KEY } from "../bench-runtime";
import * as benchRuntime from "../bench-runtime";
import type { BenchInteractionPlan } from "../interaction-plan";
import {
  createBenchFilterKeystrokePlans,
  KEYSTROKE_FILTER_NEEDLE,
  createBenchInteractionPlan,
} from "../interaction-plan";

describe("BenchApp interaction planning", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    pretableAdapterSpy.mockClear();
    delete window[BENCH_RESULT_KEY];
  });

  test("does not pre-apply sort interaction state before a run starts", () => {
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=dev&script=sort"
        browserVersion="123.0"
      />,
    );

    expect(pretableAdapterSpy).toHaveBeenCalled();
    expect(pretableAdapterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      interactionPlan: null,
    });
  });

  test("does not pre-apply the resident window before a replace run starts", () => {
    // `initialRows` narrows the surface to the run's resident window. Applying it
    // at idle would make the lab page a different grid from the one every other
    // script measures.
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S1&scale=dev&script=replace"
        browserVersion="123.0"
      />,
    );

    expect(pretableAdapterSpy).toHaveBeenCalled();
    expect(pretableAdapterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      initialRows: undefined,
      interactionPlan: null,
    });
  });

  test("commits each keystroke step's plan to the adapter, in order, ending on the full needle", async () => {
    // The trigger is the only thing standing between the measurement loop and
    // the adapter: each call must publish that step's OWN plan object (adapters
    // re-fire their interaction effect on plan identity). Observed through the
    // adapter's props rather than the trigger's arguments, so a dispatch that
    // published the wrong step — or the same plan N times — fails here.
    const observedPlans: (BenchInteractionPlan | null)[] = [];

    vi.spyOn(
      benchRuntime,
      "measureBenchFilterKeystrokesRun",
    ).mockImplementation(
      async (_root, _adapterId, steps, _override, triggerStep) => {
        for (let index = 0; index < steps.length; index += 1) {
          triggerStep(index);
          // The trigger sets React state; wait for the adapter to re-render
          // holding this step's filter value before committing the next one —
          // the same settled-sequential contract the real measurement enforces.
          await waitFor(() => {
            const plan = (
              pretableAdapterSpy.mock.calls.at(-1)?.[0] as {
                interactionPlan?: BenchInteractionPlan | null;
              }
            ).interactionPlan;
            expect(plan?.filters["col_0"]?.value).toBe(steps[index]!.value);
          });
          observedPlans.push(
            (
              pretableAdapterSpy.mock.calls.at(-1)?.[0] as {
                interactionPlan: BenchInteractionPlan | null;
              }
            ).interactionPlan,
          );
        }

        return {
          status: "completed",
          notes: ["interaction mode: filter-keystrokes"],
          metrics: {
            interaction_latency_ms: 4,
            settle_duration_ms: 6,
            post_interaction_blank_gap_frames: 0,
            post_interaction_anchor_shift_px: 0,
            post_interaction_row_height_error_p95_px: 0,
            post_interaction_row_height_error_measurable_rows: 11,
            result_row_count: steps.at(-1)!.plan.resultRowCount,
            selected_row_preserved: 1,
            focused_row_preserved: 1,
            dom_nodes_peak: 400,
            rendered_rows_peak: 11,
            rendered_cells_peak: 440,
            keystroke_commits_observed: steps.length,
            keystroke_first_total_ms: 10,
            keystroke_warm_total_p50_ms: 5,
            keystroke_warm_total_p95_ms: 5,
            keystroke_warm_total_max_ms: 5,
          },
        };
      },
    );

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=smoke&script=filter-keystrokes&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          status: "completed",
          scriptName: "filter-keystrokes",
          metrics: { keystroke_commits_observed: observedPlans.length },
        });
      },
      { timeout: 15_000 },
    );

    // The adapter saw strictly-lengthening prefixes ending on the full needle.
    const values = observedPlans.map((plan) =>
      String(plan?.filters["col_0"]?.value ?? ""),
    );
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values.at(-1)).toBe(KEYSTROKE_FILTER_NEEDLE);
    for (const [index, value] of values.entries()) {
      expect(KEYSTROKE_FILTER_NEEDLE.startsWith(value)).toBe(true);
      if (index > 0) {
        expect(value.length).toBeGreaterThan(values[index - 1]!.length);
      }
    }
    // Every commit carried the keystroke mode and a distinct plan object —
    // identity is what re-fires each adapter's interaction effect.
    for (const plan of observedPlans) {
      expect(plan?.mode).toBe("filter-keystrokes");
    }
    expect(new Set(observedPlans).size).toBe(observedPlans.length);
  }, 20_000);

  test("does not pre-apply the grouping before a group run starts", () => {
    // `group` measures the grouping being applied, so the grid must still be
    // ungrouped when the run begins. (`group-expand` is the opposite — see
    // bench-app.test.tsx.)
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=dev&script=group"
        browserVersion="123.0"
      />,
    );

    expect(pretableAdapterSpy).toHaveBeenCalled();
    expect(pretableAdapterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      interactionPlan: null,
    });
  });
});

const keystrokeRows = (values: string[]) =>
  values.map(
    (value, index) => ({ id: `row-${index}`, col_0: value }) as ScenarioRow,
  );

describe("the group-expand plan's collapse target", () => {
  test("names the sorted-first group and its row count", () => {
    const dataset = createScenarioDataset("S2", { scale: "dev" });
    const plan = createBenchInteractionPlan(dataset, "group-expand");
    expect(plan).not.toBeNull();
    // Sorted-first key of the grouping column, computed independently of the
    // builder so this test can disagree with it.
    const groupColumnId = plan!.rowGroups[0]!;
    const keys = [
      ...new Set(dataset.rows.map((row) => String(row[groupColumnId] ?? ""))),
    ].sort();
    expect(plan!.collapsedGroupKey).toBe(keys[0]);
    expect(plan!.collapsedGroupRowCount).toBe(
      dataset.rows.filter((row) => String(row[groupColumnId] ?? "") === keys[0])
        .length,
    );
    // Data that can disprove: an empty collapsed group would make the
    // toggle measure nothing.
    expect(plan!.collapsedGroupRowCount).toBeGreaterThan(0);
  });

  test("every other mode carries no collapse target", () => {
    const dataset = createScenarioDataset("S2", { scale: "dev" });
    const groupPlan = createBenchInteractionPlan(dataset, "group");
    expect(groupPlan!.collapsedGroupKey).toBeNull();
    expect(groupPlan!.collapsedGroupRowCount).toBe(0);
  });
});

describe("createBenchFilterKeystrokePlans", () => {
  // Fixture graded against the FULL needle "Bonjour depuis Pretable token-123"
  // (#509). Counts by hand (case-insensitive contains): "B":6 (all but
  // "hello"), "Bo":5 (drops "Bxx"), "Bon":4 (drops "Boq"), "Bonj" through
  // "…token-" all tie at 4 (dropped), "…token-1":3 (drops the token-9 row),
  // "…token-12":2 (drops token-15), "…token-123":1 (only token-1234 contains
  // it). Expected steps: B:6, Bo:5, Bon:4, …token-1:3, …token-12:2,
  // …token-123:1 — strictly decreasing, ending at the full needle.
  const dataset = {
    rows: keystrokeRows([
      "Bxx",
      "Boq",
      "Bonjour depuis Pretable token-9 x",
      "Bonjour depuis Pretable token-15",
      "Bonjour depuis Pretable token-124",
      "Bonjour depuis Pretable token-1234",
      "hello",
    ]),
  };

  test("keystroke steps strictly narrow the row count and end at the full needle", () => {
    const steps = createBenchFilterKeystrokePlans(dataset);
    expect(steps).not.toBeNull();
    const counts = steps!.map((step) => step.plan.resultRowCount);
    expect(counts).toEqual([6, 5, 4, 3, 2, 1]);
    expect(steps!.at(-1)!.value).toBe(KEYSTROKE_FILTER_NEEDLE);
    // every step's plan carries the mode and the contains filter for its prefix
    for (const step of steps!) {
      expect(step.plan.mode).toBe("filter-keystrokes");
      expect(KEYSTROKE_FILTER_NEEDLE.startsWith(step.value)).toBe(true);
      expect(step.plan.filters["col_0"]).toEqual({
        operator: "contains",
        value: step.value,
      });
    }
  });

  test("a prefix that does not change the count is dropped, the full needle survives", () => {
    const localDataset = {
      // counts: "B":2, "Bo":1 (drops "Bxx"), every later prefix ties at 1
      // (the one matching row carries the whole needle plus a suffix) —
      // dropped — and the full needle's count 1 equals the last kept
      // ("Bo":1), so it REPLACES it.
      rows: keystrokeRows([
        "Bonjour depuis Pretable token-123 suffix",
        "Bxx",
        "hello",
      ]),
    };
    const steps = createBenchFilterKeystrokePlans(localDataset)!;
    expect(steps.map((step) => step.value)).toEqual([
      "B",
      KEYSTROKE_FILTER_NEEDLE,
    ]);
    expect(steps.map((step) => step.plan.resultRowCount)).toEqual([2, 1]);
  });

  test("probes come from the final filtered set and are stable across every step", () => {
    const steps = createBenchFilterKeystrokePlans(dataset)!;
    const finalIds = new Set(
      steps.at(-1)!.plan.rows.map((row) => String(row.id)),
    );
    for (const step of steps) {
      expect(step.plan.selectedRowId).toBe(steps.at(-1)!.plan.selectedRowId);
      expect(step.plan.focusedRowId).toBe(steps.at(-1)!.plan.focusedRowId);
      expect(finalIds.has(step.plan.selectedRowId!)).toBe(true);
    }
    // Pin the exact probe identity so this test cannot pass on a probe
    // computed from an EARLIER step's rows instead of the final step's: the
    // first kept step ("B") spans rows 0–5, whose midpoint floor(6/2)=3 lands
    // on row-3 — while the final set is exactly [row-5] ("token-1234"), so
    // its midpoint floor(1/2)=0 is row-5. Only the final-set source yields it.
    expect(steps.at(-1)!.plan.selectedRowId).toBe("row-5");
    expect(steps.at(-1)!.plan.focusedRowId).toBe("row-5");
  });

  test("createBenchInteractionPlan returns null for filter-keystrokes (sequence scripts use the step builder)", () => {
    // A real dataset: the plan builder now reads `roles` off it, and the
    // count-grading fixture above is a bare row bag by design.
    expect(
      createBenchInteractionPlan(
        createScenarioDataset("S5", { scale: "smoke" }),
        "filter-keystrokes",
      ),
    ).toBeNull();
  });

  test("a sequence collapsing to fewer than 2 surviving steps returns null", () => {
    // Only the first prefix moves the count ("B": 3 → 0); every later prefix
    // ties it at 0, so the full needle replaces that sole kept step — leaving
    // 1 step, below the 2-step floor a warm tail requires.
    const noMatchDataset = {
      rows: keystrokeRows(["hello", "world", "foo"]),
    };
    expect(createBenchFilterKeystrokePlans(noMatchDataset)).toBeNull();
  });
});
