import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

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
    expect(values.at(-1)).toBe("Bonjour");
    for (const [index, value] of values.entries()) {
      expect("Bonjour".startsWith(value)).toBe(true);
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

describe("createBenchFilterKeystrokePlans", () => {
  // counts by hand: "B":5, "Bo":4, "Bon":3, "Bonj":2, "Bonjo":2 (dropped),
  // "Bonjou":2 (dropped), "Bonjour":2 — equal to last kept ("Bonj"), so it
  // REPLACES it. Expected steps: B:5, Bo:4, Bon:3, Bonjour:2.
  const dataset = {
    rows: keystrokeRows([
      "Bxx",
      "Boq",
      "Bonjour say",
      "Bonzz",
      "hello",
      "Bonjour encore",
    ]),
  };

  test("keystroke steps strictly narrow the row count and end at the full needle", () => {
    const steps = createBenchFilterKeystrokePlans(dataset);
    expect(steps).not.toBeNull();
    const counts = steps!.map((step) => step.plan.resultRowCount);
    expect(counts.every((count, i) => i === 0 || count < counts[i - 1]!)).toBe(
      true,
    );
    expect(steps!.at(-1)!.value).toBe("Bonjour");
    // every step's plan carries the mode and the contains filter for its prefix
    for (const step of steps!) {
      expect(step.plan.mode).toBe("filter-keystrokes");
      expect(step.plan.filters["col_0"]).toEqual({
        operator: "contains",
        value: step.value,
      });
    }
  });

  test("a prefix that does not change the count is dropped, the full needle survives", () => {
    const localDataset = {
      // counts: "B":2, "Bo":2 (dropped), "Bon":1, "Bonj".."Bonjou":1 (dropped),
      // "Bonjour":1 — equal to last kept ("Bon"), so it REPLACES it.
      rows: keystrokeRows(["Bonjour ici", "Boxx", "hello"]),
    };
    const steps = createBenchFilterKeystrokePlans(localDataset)!;
    expect(steps.map((step) => step.value)).toEqual(["B", "Bonjour"]);
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
    // computed from the FIRST step's rows instead of the final step's: the
    // first kept step ("B") has rows [row-0, row-1, row-2, row-3, row-5],
    // whose midpoint floor(5/2)=2 lands on row-2 — a value that *coincidentally*
    // survives to the final set too, so an assertion that only checks
    // "is in the final set" cannot tell the two sources apart. The final
    // filtered set ("Bonjour") is [row-2, row-5] in source order (filterRows
    // preserves it), so its true midpoint floor(2/2)=1 is row-5.
    expect(steps.at(-1)!.plan.selectedRowId).toBe("row-5");
    expect(steps.at(-1)!.plan.focusedRowId).toBe("row-5");
  });

  test("createBenchInteractionPlan returns null for filter-keystrokes (sequence scripts use the step builder)", () => {
    expect(
      createBenchInteractionPlan(
        dataset as unknown as ScenarioDataset,
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
