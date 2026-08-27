import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { BENCH_RESULT_KEY } from "../bench-runtime";
import * as benchRuntime from "../bench-runtime";
import { BenchApp } from "../bench-app";

describe("BenchApp", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // The published result is a global and nothing else clears it, so a test
    // that waits for one can match the PREVIOUS test's result and assert
    // against it — passing or failing on a run that never happened.
    delete window[BENCH_RESULT_KEY];
  });

  test("renders selected scenario metadata and publishes a terminal result", async () => {
    render(<BenchApp search="?scenario=S2" browserVersion="123.0" />);

    expect(screen.getAllByText("wrap-auto-height")).toHaveLength(2);
    expect(screen.getAllByText("Primary wedge benchmark.")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Run Initial" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        adapterId: "pretable",
        scenarioId: "S2",
        profile: "default",
        scale: "dev",
        scriptName: "initial",
      });
    });
  }, 15_000);

  /**
   * The other half of the drift guard in `bench-runtime.test.ts`: that test
   * proves `createBenchRequest` reads its argument, this one proves the app
   * hands it the element the run is measured through. Passing `null` — or any
   * other element — records `document.body`'s font instead, which is how a
   * summary comes to name a font the grid never rendered.
   */
  test("publishes the font stack of the surface the run measured", async () => {
    const { container } = render(
      <BenchApp search="?scenario=S2" browserVersion="123.0" />,
    );
    const surface = container.querySelector<HTMLElement>(".viewport-card")!;
    // jsdom applies no stylesheet, so the rendered font has to be stated here
    // for there to be anything to tell apart from the document's.
    surface.style.fontFamily = '"Inter Variable", ui-sans-serif, sans-serif';

    fireEvent.click(screen.getByRole("button", { name: "Run Initial" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        fontStack: getComputedStyle(surface).fontFamily,
      });
    });
    expect(window[BENCH_RESULT_KEY]?.fontStack).not.toBe(
      getComputedStyle(document.body).fontFamily,
    );
  }, 15_000);

  test("autorun completes without a lifecycle flushSync warning", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <BenchApp
        search="?scenario=S1&script=initial&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        scenarioId: "S1",
        scale: "dev",
        scriptName: "initial",
      });
    });

    expect(
      consoleError.mock.calls.some((call) =>
        call
          .map((value) => String(value))
          .join(" ")
          .includes("flushSync was called from inside a lifecycle method"),
      ),
    ).toBe(false);
  });

  // The three surface tests below assert WHICH adapter renders, which is
  // scale-independent — so they run at `scale=smoke`, as the jsdom wrapped-scale
  // rule requires of any comparator on a wrapped scenario. See
  // comparator-wrapped-scale-rule.ts for why `dev` is refused here.
  //
  // The ag-grid one is the reason the rule is worth having. It never awaits, so
  // its own reported duration was ~100-230ms and looked cheap; measured with a
  // drain, the mount it queues blocks the event loop for 23235-25282ms and
  // leaves 19803 DOM nodes at `dev`, against 91-2515ms and 1603-4053 nodes at
  // smoke. That cost was not absent, it was being paid by whichever tests ran
  // next in this file.
  test("renders the requested ag-grid competitor surface instead of relabeling Pretable", async () => {
    render(
      <BenchApp
        search="?adapter=ag-grid&scenario=S2&scale=smoke"
        browserVersion="123.0"
      />,
    );

    expect(screen.getByText("AG Grid Community harness")).toBeTruthy();
    expect(screen.getByLabelText("AG Grid Community adapter")).toBeTruthy();
    expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
  });

  test("renders the requested tanstack competitor surface", async () => {
    render(
      <BenchApp
        search="?adapter=tanstack&scenario=S2&scale=smoke"
        browserVersion="123.0"
      />,
    );

    expect(screen.getByText("TanStack Table harness")).toBeTruthy();
    expect(screen.getByLabelText("TanStack Table adapter")).toBeTruthy();
    expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
  });

  // This one keeps an explicit ceiling, and the reason is worth stating because
  // it is NOT the reason the other two moved to smoke.
  //
  // Measured paired, both scales in one process: MUI materialises 5094 DOM
  // nodes and blocks the event loop for ~2ms at BOTH 120 and 750 rows. Its
  // virtualizer caps the rendered window either way, so `scale=smoke` does not
  // meaningfully speed this test up — the ~1-2s is MUI X DataGrid's mount cost
  // under jsdom, which is inherent and scale-independent. It runs at smoke
  // anyway because the wrapped-scale rule applies to every comparator and there
  // is no reason to pay for 750 rows nobody asserts on.
  //
  // That inherent 1-2s triples on a loaded runner — it was seen at 5981ms
  // during a 10-repeat loop with this machine at load 77 — so the ceiling is
  // kept rather than re-rolling the dice on the 5000ms default. It is 15_000
  // rather than the old 30_000: the wrapped-scale trap that justified the wider
  // ceiling is gone, and a ceiling that generous stops reporting regressions.
  test("renders the requested mui competitor surface", async () => {
    render(
      <BenchApp
        search="?adapter=mui&scenario=S2&scale=smoke"
        browserVersion="123.0"
      />,
    );

    expect(screen.getByText("MUI X DataGrid Community harness")).toBeTruthy();
    expect(screen.getByLabelText("MUI X DataGrid adapter")).toBeTruthy();
    expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
  }, 15_000);

  test("keeps the Pretable benchmark wrapper distinct while exposing the shared renderer markers", async () => {
    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2"
        browserVersion="123.0"
      />,
    );

    const adapter = screen
      .getByRole("grid", {
        name: "Pretable React adapter",
      })
      .closest("[data-benchmark-adapter]");

    expect(adapter?.getAttribute("data-benchmark-adapter")).toBe("pretable");
    expect(
      adapter?.querySelector("[data-pretable-scroll-viewport]"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(adapter?.querySelector("[data-pretable-row]")).toBeTruthy(),
    );
  });

  test("publishes a failed terminal result when scroll measurement throws", async () => {
    vi.spyOn(benchRuntime, "measureBenchScrollRun").mockRejectedValueOnce(
      new Error("scroll probe exploded"),
    );

    render(
      <BenchApp search="?scenario=S2&script=scroll" browserVersion="123.0" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run Scroll" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "failed",
        adapterId: "pretable",
        scenarioId: "S2",
        scriptName: "scroll",
        error: {
          name: "Error",
          message: "scroll probe exploded",
        },
      });
    });
  });

  test("runs the sort script through the interaction probe instead of mount-only metrics", async () => {
    vi.spyOn(benchRuntime, "measureBenchInteractionRun").mockResolvedValueOnce({
      status: "completed",
      notes: ["interaction mode: sort"],
      metrics: {
        interaction_latency_ms: 24,
        settle_duration_ms: 18,
        post_interaction_blank_gap_frames: 0,
        post_interaction_anchor_shift_px: 0,
        post_interaction_row_height_error_p95_px: 0,
        post_interaction_row_height_error_measurable_rows: 11,
        result_row_count: 750,
        selected_row_preserved: 1,
        focused_row_preserved: 1,
        dom_nodes_peak: 400,
        rendered_rows_peak: 11,
        rendered_cells_peak: 440,
      },
    });

    render(
      <BenchApp search="?scenario=S2&script=sort" browserVersion="123.0" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run Sort" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        adapterId: "pretable",
        scenarioId: "S2",
        scriptName: "sort",
        metrics: {
          interaction_latency_ms: 24,
          settle_duration_ms: 18,
          result_row_count: 750,
        },
      });
    });
  });

  test("dispatches grouped update autoruns through the existing update measurement", async () => {
    const updatesSpy = vi
      .spyOn(benchRuntime, "measureBenchUpdatesRun")
      .mockResolvedValueOnce({
        status: "completed",
        notes: [
          "updates total: 3000",
          "update rate per sec: 1000",
          "updates per tick: 50",
        ],
        metrics: {
          scroll_frame_p95_ms: 12,
          long_tasks_count: 0,
          dom_nodes_peak: 200,
          scroll_position_drift_px: 0,
          visible_row_count_drift: 0,
        },
      });

    render(
      <BenchApp
        search="?scenario=S5&scale=smoke&script=updates-grouped&updateRatePerSec=1000&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        adapterId: "pretable",
        scenarioId: "S5",
        scale: "smoke",
        scriptName: "updates-grouped",
      });
    });

    expect(updatesSpy).toHaveBeenCalledTimes(1);
    expect(updatesSpy).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "pretable",
      expect.any(Function),
      expect.any(Object),
      {
        updateRatePerSec: 1_000,
        seed: 505,
        grouped: true,
        diagnostics: null,
      },
    );
  });

  /**
   * TanStack, not AG Grid — #434 proposed restoring AG Grid at `scale=smoke`,
   * and that was measured and rejected. Do not restore it.
   *
   * What this test is about is bench-app's DISPATCH: that a non-pretable
   * adapter reaches `measureBenchInteractionRun` and is handed `undefined` for
   * the telemetry override. That branch keys on `adapterId === "pretable"`
   * (bench-app.tsx), so any comparator proves it; the measurement function is
   * mocked here and never invokes the apply callback, so no adapter's native
   * sort API is exercised either way. AG Grid buys no assertion TanStack does
   * not already make.
   *
   * It does buy cost. Paired A/B on the surface-test path, both scales in one
   * process, measuring the deferred drain rather than just `render()` — the
   * correction lands after mount returns, which is why this test's old 181ms
   * looked safe while it was really queueing work for later tests in the file:
   *
   *   adapter   scale   event loop blocked   DOM nodes after drain
   *   ag-grid   dev         23235-25282ms                   19803
   *   ag-grid   smoke           91-2515ms             1603-4053
   *   tanstack  dev                  ~2ms                     135
   *   tanstack  smoke                ~2ms                     135
   *
   * `smoke` cuts AG Grid by ~10x, which is why the wrapped-scale rule exists —
   * but 2.5s of blocking is still enough to starve `waitFor` on a loaded
   * runner, and a 10-repeat loop on this file timed this test out at 6047ms
   * once. TanStack's `measureElement` is inert under jsdom at either scale, so
   * it is the comparator that makes this assertion for ~2ms.
   *
   * The wrapped AG Grid path keeps its real coverage where layout exists:
   * apps/bench/tests/ag-grid-wrap-auto-height.spec.ts (Chromium) asserts the
   * rows actually grow, vary, fit their content and use the matrix's leading.
   */
  test("dispatches comparator interaction scripts through measureBenchInteractionRun (B2 #5b)", async () => {
    const interactionSpy = vi
      .spyOn(benchRuntime, "measureBenchInteractionRun")
      .mockResolvedValueOnce({
        status: "completed",
        notes: ["interaction mode: sort"],
        metrics: {
          interaction_latency_ms: 32,
          settle_duration_ms: 24,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          post_interaction_row_height_error_measurable_rows: 11,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 600,
          rendered_rows_peak: 11,
          rendered_cells_peak: 440,
        },
      });

    render(
      <BenchApp
        search="?adapter=tanstack&scenario=S2&scale=smoke&script=sort"
        browserVersion="123.0"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run Sort" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        adapterId: "tanstack",
        scenarioId: "S2",
        scriptName: "sort",
      });
    });

    expect(interactionSpy).toHaveBeenCalledTimes(1);
    // Comparators pass undefined for the telemetry override; pretable
    // gets a closure (see bench-app.tsx).
    expect(interactionSpy.mock.calls[0]?.[4]).toBeUndefined();
  });

  test("dispatches filter-keystrokes through measureBenchFilterKeystrokesRun with strictly-lengthening prefix steps", async () => {
    const keystrokesSpy = vi
      .spyOn(benchRuntime, "measureBenchFilterKeystrokesRun")
      .mockResolvedValueOnce({
        status: "completed",
        notes: [
          "interaction mode: filter-keystrokes",
          'keystroke 1/2 ("B"): latency 4.0 ms, settle 6.0 ms, 100 rows',
          'keystroke 2/2 ("Bonjour"): latency 2.0 ms, settle 3.0 ms, 20 rows',
        ],
        metrics: {
          interaction_latency_ms: 4,
          settle_duration_ms: 6,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          post_interaction_row_height_error_measurable_rows: 11,
          result_row_count: 20,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
          rendered_rows_peak: 11,
          rendered_cells_peak: 440,
          keystroke_commits_observed: 2,
          keystroke_first_total_ms: 10,
          keystroke_warm_total_p50_ms: 5,
          keystroke_warm_total_p95_ms: 5,
          keystroke_warm_total_max_ms: 5,
        },
      });

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
          adapterId: "pretable",
          scenarioId: "S2",
          scriptName: "filter-keystrokes",
          metrics: {
            keystroke_commits_observed: 2,
            keystroke_first_total_ms: 10,
          },
        });
      },
      { timeout: 15_000 },
    );

    expect(keystrokesSpy).toHaveBeenCalledTimes(1);
    const [, adapterId, steps, telemetryOverride, trigger] =
      keystrokesSpy.mock.calls[0]!;
    expect(adapterId).toBe("pretable");
    // Pretable gets the telemetry closure; the trigger is what commits a step.
    expect(telemetryOverride).toBeTypeOf("function");
    expect(trigger).toBeTypeOf("function");

    // The step sequence the measurement was handed: strictly-lengthening
    // prefixes of the needle, ending on the full needle — the trigger commits
    // them in exactly this order (pinned end-to-end in
    // bench-app-interaction-plan.test.tsx).
    const values = steps.map((step) => step.value);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values.at(-1)).toBe("Bonjour");
    for (const [index, value] of values.entries()) {
      expect("Bonjour".startsWith(value)).toBe(true);
      if (index > 0) {
        expect(value.length).toBeGreaterThan(values[index - 1]!.length);
      }
    }
  }, 20_000);

  test("groups the grid BEFORE the group-expand measurement window opens", async () => {
    // The whole point of group-expand is that only the expansion toggle sits
    // inside the measured window. If applying the grouping landed inside it,
    // the recompute would swamp the toggle and the script would measure
    // nothing — so assert the grouped row model is already painted at the
    // moment measureBenchInteractionRun is entered.
    let groupRowsAtCallTime = -1;
    let modeAtCallTime: string | null = null;

    vi.spyOn(benchRuntime, "measureBenchInteractionRun").mockImplementation(
      async (_root, _adapterId, mode) => {
        modeAtCallTime = mode;
        groupRowsAtCallTime = document.querySelectorAll(
          "[data-pretable-group-row]",
        ).length;

        return {
          status: "completed",
          notes: [`interaction mode: ${mode}`],
          metrics: {
            interaction_latency_ms: 9,
            settle_duration_ms: 8,
            post_interaction_blank_gap_frames: 0,
            post_interaction_anchor_shift_px: 0,
            post_interaction_row_height_error_p95_px: 0,
            post_interaction_row_height_error_measurable_rows: 11,
            result_row_count: 40,
            selected_row_preserved: 1,
            focused_row_preserved: 1,
            dom_nodes_peak: 400,
            rendered_rows_peak: 11,
            rendered_cells_peak: 440,
          },
        };
      },
    );

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=smoke&script=group-expand&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          status: "completed",
          adapterId: "pretable",
          scenarioId: "S2",
          scriptName: "group-expand",
        });
      },
      { timeout: 15_000 },
    );

    expect(modeAtCallTime).toBe("group-expand");
    // Row virtualization means only the group rows inside the viewport are in
    // the DOM, so this is "at least one", not "all four".
    expect(groupRowsAtCallTime).toBeGreaterThan(0);
  }, 20_000);

  test("declines to measure group-expand when the grouping never paints", async () => {
    // The CI failure this pins: the row MODEL settles several frames before
    // React commits the paint, so gating the wait on the model alone opened the
    // measurement window with zero group rows on screen — folding the grouping
    // render into a number that is supposed to measure only the toggle.
    //
    // Withholding the paint FOREVER is what makes this discriminate. Gating on
    // the model (the old behaviour) ignores the DOM entirely and still reports
    // `completed`; gating on the paint runs out its frame budget and reports
    // `partial`, which is the honest answer when the precondition never held.
    const realQuery = Element.prototype.querySelectorAll;
    // Both prototypes: the app queries `viewportRef.current ?? document`, and
    // Document does not inherit Element's method — stubbing only Element left
    // the fallback path live, which is why this first passed alone and failed
    // in the suite.
    const realDocumentQuery = Document.prototype.querySelectorAll;
    const hide = (selector: string) =>
      selector === "[data-pretable-group-row]"
        ? "[data-nonexistent-so-this-is-empty]"
        : selector;

    vi.spyOn(Element.prototype, "querySelectorAll").mockImplementation(
      function (this: Element, selector: string) {
        return realQuery.call(this, hide(selector));
      } as typeof Element.prototype.querySelectorAll,
    );
    vi.spyOn(Document.prototype, "querySelectorAll").mockImplementation(
      function (this: Document, selector: string) {
        return realDocumentQuery.call(this, hide(selector));
      } as typeof Document.prototype.querySelectorAll,
    );

    const measureSpy = vi
      .spyOn(benchRuntime, "measureBenchInteractionRun")
      .mockResolvedValue({
        status: "completed",
        notes: ["interaction mode: group-expand"],
        metrics: {
          interaction_latency_ms: 9,
          settle_duration_ms: 8,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          post_interaction_row_height_error_measurable_rows: 11,
          result_row_count: 40,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
          rendered_rows_peak: 11,
          rendered_cells_peak: 440,
        },
      });

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=smoke&script=group-expand&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          adapterId: "pretable",
        });
      },
      { timeout: 20_000 },
    );

    expect(window[BENCH_RESULT_KEY]).toMatchObject({ status: "partial" });
    expect(measureSpy).not.toHaveBeenCalled();
  }, 30_000);

  test("runs the group script through the interaction probe with the grouping applied by the trigger", async () => {
    const interactionSpy = vi
      .spyOn(benchRuntime, "measureBenchInteractionRun")
      .mockResolvedValueOnce({
        status: "completed",
        notes: ["interaction mode: group"],
        metrics: {
          interaction_latency_ms: 21,
          settle_duration_ms: 17,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          post_interaction_row_height_error_measurable_rows: 11,
          result_row_count: 124,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
          rendered_rows_peak: 11,
          rendered_cells_peak: 440,
        },
      });

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S2&scale=smoke&script=group&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          status: "completed",
          scriptName: "group",
        });
      },
      { timeout: 15_000 },
    );

    expect(interactionSpy).toHaveBeenCalledTimes(1);
    expect(interactionSpy.mock.calls[0]?.[2]).toBe("group");
    // Unlike group-expand, the grouping IS the measured interaction here, so
    // it must ride in on the plan the trigger applies.
    expect(interactionSpy.mock.calls[0]?.[3]).toMatchObject({
      rowGroups: ["col_5"],
    });
  }, 20_000);
  test("paints and selects the resident window BEFORE the replace window opens", async () => {
    // Everything the app owes the measurement is owed by the time it is invoked, so
    // all of it is read at call time: the adapter must be holding the 200-row resident
    // window rather than S1/dev's 2 000, and the plan's probe row must already be the
    // selected row. `selected_row_preserved` is only a claim about the update if
    // something was selected before it landed; with no selection it compares two nulls
    // and scores 1.
    //
    // What this test cannot see is the measurement's own quiet gate — it holds the
    // window shut until selection and focus stop MOVING (`createStabilityKey`), and
    // this test replaces `measureBenchDataUpdateRun` wholesale. That gate is covered
    // in bench-runtime.test.ts ("waits for a surface still in motion at hand-over").
    let modeAtCallTime: string | null = null;
    let residentRowCountAtCallTime: string | null = null;
    let selectedRowIdAtCallTime: string | null = null;
    let planAtCallTime: unknown = null;

    vi.spyOn(benchRuntime, "measureBenchDataUpdateRun").mockImplementation(
      async (_root, _adapterId, mode, plan) => {
        const adapter = document.querySelector<HTMLElement>(
          "[data-benchmark-adapter='pretable']",
        );
        modeAtCallTime = mode;
        planAtCallTime = plan;
        residentRowCountAtCallTime =
          adapter?.dataset.benchResultRowCount ?? null;
        selectedRowIdAtCallTime = adapter?.dataset.benchSelectedRowId ?? null;

        return {
          status: "completed",
          notes: [`data update mode: ${mode}`],
          metrics: {
            interaction_latency_ms: 11,
            settle_duration_ms: 9,
            post_interaction_blank_gap_frames: 0,
            post_interaction_anchor_shift_px: 0,
            post_interaction_row_height_error_p95_px: 0,
            post_interaction_row_height_error_measurable_rows: 11,
            scroll_position_drift_px: 0,
            result_row_count: 200,
            selected_row_preserved: 1,
            focused_row_preserved: 1,
            grid_instance_reconstructed: 0,
            dom_nodes_peak: 400,
            rendered_rows_peak: 11,
            rendered_cells_peak: 440,
          },
        };
      },
    );

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S1&scale=dev&script=replace&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          status: "completed",
          adapterId: "pretable",
          scenarioId: "S1",
          scriptName: "replace",
          metrics: {
            interaction_latency_ms: 11,
            grid_instance_reconstructed: 0,
          },
        });
      },
      { timeout: 20_000 },
    );

    expect(modeAtCallTime).toBe("replace");
    // The resident window, not S1 dev's 2 000 rows.
    expect(residentRowCountAtCallTime).toBe("200");
    expect(planAtCallTime).toMatchObject({ mode: "replace" });
    // Asserted before the comparison below, which an empty id on both sides would
    // otherwise satisfy without either a probe row or a selection existing.
    expect(
      (planAtCallTime as { selectedRowId: string | null }).selectedRowId,
    ).toBeTruthy();
    expect(selectedRowIdAtCallTime).toBe(
      (planAtCallTime as { selectedRowId: string }).selectedRowId,
    );
  }, 30_000);

  test("records an aborted replace as a failed run carrying the cause, never as a thrown harness error", async () => {
    // A real replace measurement taken to one of its abort paths — the instance-id probe
    // reading nothing — rather than a stubbed return, because what is under test is the
    // whole path from the abort to the published artifact.
    //
    // bench-runner refuses to record a `partial` replace at all, so an abort that stayed
    // `partial` reaches createBenchRunSummary's guard and the throw lands in executeRun's
    // catch: a run recorded as failed whose error says only that the status was wrong.
    // The cause the measurement already knew is gone by then, and the harness spends a
    // full run to publish nothing about why it stopped.
    vi.spyOn(benchRuntime, "readBenchGridInstanceId").mockReturnValue(null);

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S1&scale=dev&script=replace&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          status: "failed",
          adapterId: "pretable",
          scenarioId: "S1",
          scriptName: "replace",
          error: {
            message: expect.stringContaining(
              "grid instance id unavailable before the update",
            ),
          },
        });
      },
      { timeout: 30_000 },
    );

    // The measurement's own notes survive onto the failed artifact; they are the only
    // record of which script and which mode stopped.
    expect(window[BENCH_RESULT_KEY]?.notes).toContain(
      "data update mode: replace",
    );
  }, 40_000);

  test("reports a dataset too small for either row-set shape as unsupported", async () => {
    const dataUpdateSpy = vi.spyOn(benchRuntime, "measureBenchDataUpdateRun");

    render(
      <BenchApp
        search="?adapter=pretable&scenario=S1&scale=smoke&script=append&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "unsupported",
        scriptName: "append",
      });
    });

    // Mount-only metrics under the `append` name would be worse than no run.
    expect(dataUpdateSpy).not.toHaveBeenCalled();
  }, 20_000);

  test("reports the row-set scripts as unsupported on an adapter with no setRows path", async () => {
    const dataUpdateSpy = vi.spyOn(benchRuntime, "measureBenchDataUpdateRun");

    // Only pretable wires `onDataApiReady`, so on any other adapter the trigger would
    // be dead and the measurement would time a call into nothing. The rejection comes
    // from `validateSupportedP0aRequest`, which the app consults before it builds a
    // plan — this pins that a hand-typed lab-page URL cannot reach the measurement.
    render(
      <BenchApp
        search="?adapter=ag-grid&scenario=S1&scale=dev&script=replace&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(
      () => {
        expect(window[BENCH_RESULT_KEY]).toMatchObject({
          status: "unsupported",
          adapterId: "ag-grid",
          scriptName: "replace",
        });
      },
      { timeout: 20_000 },
    );

    expect(dataUpdateSpy).not.toHaveBeenCalled();
  }, 30_000);
});
