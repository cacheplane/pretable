import { cleanup, render } from "@testing-library/react";
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
import {
  createBenchFilterKeystrokePlans,
  createBenchInteractionPlan,
} from "../interaction-plan";

describe("BenchApp interaction planning", () => {
  afterEach(() => {
    cleanup();
    pretableAdapterSpy.mockClear();
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
    // No row contains "b" at all: every prefix (including the full needle)
    // stays at count 0, so nothing ever moves the count and the sole
    // surviving "step" is the full-needle replacement — below the 2-step
    // floor a warm tail requires.
    const noMatchDataset = {
      rows: keystrokeRows(["hello", "world", "foo"]),
    };
    expect(createBenchFilterKeystrokePlans(noMatchDataset)).toBeNull();
  });
});
