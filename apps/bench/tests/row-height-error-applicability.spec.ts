import { expect, test, type Page } from "@playwright/test";

/**
 * `row_height_error_p95_px` compares a row's rendered box against its tallest
 * cell's content height. `cell.scrollHeight` is floored at `cell.clientHeight`,
 * so the only way a wrong row height reaches that comparison is by pushing
 * content past the box — and content can only be pushed past the box when the
 * box can change how many lines the text takes. Under `white-space: nowrap` it
 * cannot, so the metric returned the same box-model constant on every row of
 * every frame no matter how the grid laid out. Three comparators rendered
 * exactly that way and published the result as a score (#414).
 *
 * The fix reports NOT APPLICABLE instead of `0` there. That is only worth
 * anything if the applicable case can still fail — otherwise a metric that
 * cannot fail has been replaced by a status that cannot fail. So this file
 * proves both halves, in a real browser, because every claim here is a layout
 * fact and jsdom has no layout: `getBoundingClientRect()` returns zeros,
 * `scrollHeight` is always 0, and `getComputedStyle().whiteSpace` is undefined,
 * so all three inputs to the rule are absent there.
 *
 *  1. S1 (`wrapped_columns: 0`) reports not applicable: the count of measurable
 *     rows is 0, the p95 is ABSENT rather than 0, and a note says why.
 *  2. S2 (`wrapped_columns: 3`) reports a real number, and it is small.
 *  3. THE GATE: the same S2 run with one row height forced wrong reports a
 *     large number. Same grid, same scenario, same code path — only the layout
 *     is broken, and the metric catches it.
 *  4. The determination is per RUN, not per adapter: AG Grid switches between
 *     the two answers across S1 and S2, exactly as pretable does.
 *  5. Forcing `white-space: nowrap` onto a wrapping grid flips a measured S2
 *     run to not applicable, which is the applicability rule asserted in
 *     isolation from the scenario.
 */

interface RowHeightErrorReport {
  status: string;
  measurableRows: number | undefined;
  p95: number | undefined;
  notApplicableNote: boolean;
}

/**
 * Injected before any of the app's own script runs, so the mutated CSS is in
 * force for the first frame the harness measures rather than from some point
 * midway through it.
 */
async function forceStyle(page: Page, css: string) {
  await page.addInitScript((source: string) => {
    const install = () => {
      const style = document.createElement("style");
      style.textContent = source;
      document.head.append(style);
    };

    if (document.head) {
      install();
    } else {
      document.addEventListener("DOMContentLoaded", install);
    }
  }, css);
}

async function runBench(
  page: Page,
  options: {
    adapter: string;
    scenario: string;
    script: string;
    metricPrefix: "row_height_error" | "post_interaction_row_height_error";
  },
): Promise<RowHeightErrorReport> {
  await page.goto(
    `/?adapter=${options.adapter}&scenario=${options.scenario}&scale=dev&script=${options.script}&autorun=1`,
  );
  await page.waitForFunction(() => Boolean(window.__PRETABLE_BENCH_RESULT__), {
    timeout: 60_000,
  });

  return page.evaluate((metricPrefix) => {
    const result = window.__PRETABLE_BENCH_RESULT__;
    const metrics = (result as { metrics?: Record<string, number> } | undefined)
      ?.metrics;

    return {
      status: result?.status ?? "(absent)",
      measurableRows: metrics?.[`${metricPrefix}_measurable_rows`],
      p95: metrics?.[`${metricPrefix}_p95_px`],
      notApplicableNote: (result?.notes ?? []).some((note) =>
        note.startsWith(`${metricPrefix}_p95_px not applicable`),
      ),
    };
  }, options.metricPrefix);
}

test("a grid whose cells cannot wrap reports no opinion, not a zero", async ({
  page,
}) => {
  // S1 is `wrapped_columns: 0`, so every cell computes `white-space: nowrap`.
  const report = await runBench(page, {
    adapter: "pretable",
    scenario: "S1",
    script: "scroll",
    metricPrefix: "row_height_error",
  });

  expect(report.status).toBe("completed");
  expect(report.measurableRows).toBe(0);
  // Not `toBe(0)`. The whole defect is that 0 reads as a passing grade.
  expect(report.p95).toBeUndefined();
  expect(report.notApplicableNote).toBe(true);

  // ...and the reason is the one claimed, not an accident of the run finding no
  // rows: the grid rendered plenty, and none of their cells can wrap.
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-pretable-cell]")].map(
      (cell) => getComputedStyle(cell).whiteSpace,
    ),
  );
  expect(cells.length).toBeGreaterThan(10);
  expect(new Set(cells)).toEqual(new Set(["nowrap"]));
});

/**
 * The control for the gate below. Same adapter, scenario, script and code path;
 * the only difference is that the layout is intact.
 *
 * The bound is deliberately loose. This asserts that an intact wrapping grid
 * lands in single digits, not that it lands at any particular value — S2's
 * measured p95 depends on scale, font and viewport (4px at `dev` here, 1px on
 * the published `hypothesis` runset), and pinning it would make this a
 * row-height regression test rather than a proof that the metric distinguishes
 * a correct grid from a broken one. The distance to the gate's number is the
 * point: 4 against 150.
 */
test("a wrapping grid that lays rows out correctly reports a small, earned number", async ({
  page,
}) => {
  const report = await runBench(page, {
    adapter: "pretable",
    scenario: "S2",
    script: "scroll",
    metricPrefix: "row_height_error",
  });

  expect(report.status).toBe("completed");
  // Earned, not vacuous: a hundred-odd row samples could have carried an error.
  expect(report.measurableRows).toBeGreaterThan(10);
  expect(report.p95).toBeDefined();
  expect(report.p95!).toBeLessThan(10);
});

/**
 * The gate. Everything above is satisfied by a metric hardwired to return
 * `undefined` on S1 and `0` on S2, which would be the same bug in a new hat.
 * This is the run that would fail such an implementation.
 *
 * `height: 34px !important` beats pretable's inline row height, so the row box
 * is ~34px while its wrapped text still needs the ~90-140px the engine planned
 * for. Nothing else about the run changes: same adapter, same scenario, same
 * script, same measurement code.
 */
test("a wrapping grid that mislays its rows is caught, at the size of the mistake", async ({
  page,
}) => {
  await forceStyle(
    page,
    "[data-pretable-row] { height: 34px !important; min-height: 34px !important; max-height: 34px !important; }",
  );

  const report = await runBench(page, {
    adapter: "pretable",
    scenario: "S2",
    script: "scroll",
    metricPrefix: "row_height_error",
  });

  expect(report.status).toBe("completed");
  expect(report.measurableRows).toBeGreaterThan(10);
  expect(report.p95).toBeDefined();
  // Measured: 150px here against the control's 4px, on rows the engine planned
  // at 113-181px. 50 is far outside any rounding or sub-pixel story and far
  // below the observed value, so this fails loudly if the metric ever goes back
  // to reporting a box-model constant instead of the layout.
  expect(report.p95!).toBeGreaterThan(50);
});

test("the determination is per run, not a per-adapter constant", async ({
  page,
}) => {
  // Same adapter, both answers. A flag hung off the adapter id could not
  // produce this, and neither could reading the scenario's `wrapped_columns`
  // instead of the DOM — that is what said the comparators wrapped when they
  // did not (#400).
  const unwrapped = await runBench(page, {
    adapter: "ag-grid",
    scenario: "S1",
    script: "scroll",
    metricPrefix: "row_height_error",
  });
  expect(unwrapped.measurableRows).toBe(0);
  expect(unwrapped.p95).toBeUndefined();

  const wrapped = await runBench(page, {
    adapter: "ag-grid",
    scenario: "S2",
    script: "scroll",
    metricPrefix: "row_height_error",
  });
  expect(wrapped.measurableRows).toBeGreaterThan(10);
  expect(wrapped.p95).toBeDefined();
});

test("the post-interaction metric follows the same rule, and it follows the cells", async ({
  page,
}) => {
  // The interaction scripts only run on S2 and S7, both of which wrap, so the
  // not-applicable branch of `post_interaction_row_height_error_p95_px` is not
  // reachable by choosing a scenario. Forcing the cells to `nowrap` reaches it
  // from the other side, and in doing so isolates the rule from the scenario:
  // the only thing that changed between these two runs is whether a cell can
  // break a line.
  const measured = await runBench(page, {
    adapter: "pretable",
    scenario: "S2",
    script: "sort",
    metricPrefix: "post_interaction_row_height_error",
  });
  expect(measured.status).toBe("completed");
  expect(measured.measurableRows).toBeGreaterThan(0);
  expect(measured.p95).toBeDefined();
  expect(measured.notApplicableNote).toBe(false);

  await forceStyle(
    page,
    "[data-pretable-cell] { white-space: nowrap !important; }",
  );

  const notApplicable = await runBench(page, {
    adapter: "pretable",
    scenario: "S2",
    script: "sort",
    metricPrefix: "post_interaction_row_height_error",
  });
  // Still a completed run — `packages/bench-runner` requires the count, not the
  // p95, so a not-applicable measurement is recorded rather than refused.
  expect(notApplicable.status).toBe("completed");
  expect(notApplicable.measurableRows).toBe(0);
  expect(notApplicable.p95).toBeUndefined();
  expect(notApplicable.notApplicableNote).toBe(true);
});
