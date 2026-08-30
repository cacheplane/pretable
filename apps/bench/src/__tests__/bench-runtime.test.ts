import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  BENCH_RESULT_KEY,
  createBenchInteractionStateFromTelemetry,
  getMaxInteractionFrames,
  createPretableTelemetryNotes,
  createBenchRequest,
  createInitialRunOutcome,
  detectBlankGapFrame,
  measureBenchAutosizeRun,
  measureBenchDataUpdateRun,
  measureBenchFilterKeystrokesRun,
  measureBenchInteractionRun,
  measureBenchKeySequenceRun,
  measureBenchScrollRun,
  measureBenchUpdatesRun,
  measurePretableScrollRun,
  publishBenchResult,
  waitForRenderedRowBaseline,
  readBenchGridInstanceId,
  readRenderedFontStack,
  scrollRuntimeProfiles,
  UNREADABLE_FONT_STACK,
} from "../bench-runtime";
import { benchUpdatesExcludedColumnIds } from "../interaction-plan";
import type { BenchQueryState } from "../bench-types";

describe("bench runtime", () => {
  test("waits for a stable rendered-row baseline instead of sampling zero", async () => {
    document.body.innerHTML = `<div data-testid="root"></div>`;
    const root = document.querySelector<HTMLElement>('[data-testid="root"]')!;
    let frame = 0;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frame += 1;
        if (frame === 1) {
          root.innerHTML = Array.from(
            { length: 8 },
            (_, index) => `<div data-pretable-row="${index}"></div>`,
          ).join("");
        }
        callback(frame * 16);
        return frame;
      },
    });

    await expect(
      waitForRenderedRowBaseline(root, "[data-pretable-row]", 10),
    ).resolves.toBe(8);
    expect(frame).toBe(3);
  });

  test("creates a reproducible bench request from query state and scenario data", () => {
    const dataset = createScenarioDataset("S1", { scale: "dev" });
    const query: BenchQueryState = {
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scale: "dev",
      scriptName: "initial",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
      diagnostics: false,
      seed: 505,
    };

    document.body.innerHTML = `<div data-testid="surface"></div>`;
    const surface = document.querySelector<HTMLElement>(
      '[data-testid="surface"]',
    )!;
    surface.style.fontFamily = '"Inter Variable", ui-sans-serif, sans-serif';

    expect(createBenchRequest(query, dataset, "123.0", surface)).toMatchObject({
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scale: "dev",
      scriptName: "initial",
      browserName: "chromium",
      browserVersion: "123.0",
      seed: 101,
      rowCount: 2_000,
      viewport: {
        width: 1440,
        height: 900,
      },
      fontStack: getComputedStyle(surface).fontFamily,
      deviceScaleFactor: 1,
    });
  });

  /**
   * The drift guard. `fontStack` was a hardcoded `"IBM Plex Sans", …` while the
   * bench app rendered `--pt-font-sans` — so every summary under `status/` named
   * a font that was never under test, and nothing could tell.
   *
   * Asserting a specific string here would rebuild exactly that failure: it
   * would pass forever no matter what the surface renders. These assert the
   * RELATION instead — recorded equals rendered — which is the only claim that
   * survives someone editing `packages/ui/src/tokens.css`.
   */
  test("records the font stack the surface actually renders, and follows it when it changes", () => {
    const dataset = createScenarioDataset("S1", { scale: "dev" });
    const query: BenchQueryState = {
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scale: "dev",
      scriptName: "initial",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
      diagnostics: false,
      seed: 505,
    };
    document.body.innerHTML = `<div data-testid="surface"></div>`;
    const surface = document.querySelector<HTMLElement>(
      '[data-testid="surface"]',
    )!;

    surface.style.fontFamily = '"Inter Variable", ui-sans-serif, sans-serif';
    const first = createBenchRequest(query, dataset, "123.0", surface);
    expect(first.fontStack).toBe(getComputedStyle(surface).fontFamily);

    // A different rendered font must produce a different recorded one. A
    // constant — of any value, including today's correct one — fails here.
    surface.style.fontFamily = '"Fraunces Variable", Georgia, serif';
    const second = createBenchRequest(query, dataset, "123.0", surface);
    expect(second.fontStack).toBe(getComputedStyle(surface).fontFamily);
    expect(second.fontStack).not.toBe(first.fontStack);
  });

  test("reads the font off the surface the run measures, not off the document", () => {
    // `font-family` inherits, so the viewport card answers for the grid inside
    // it — but a run handed one element must not report another's font.
    document.body.innerHTML = `<div data-testid="surface"><span data-testid="cell">x</span></div>`;
    document.body.style.fontFamily = "Comic Sans MS, cursive";
    const surface = document.querySelector<HTMLElement>(
      '[data-testid="surface"]',
    )!;
    surface.style.fontFamily = '"Inter Variable", ui-sans-serif, sans-serif';
    const cell = document.querySelector<HTMLElement>('[data-testid="cell"]')!;

    expect(readRenderedFontStack(surface)).toBe(
      getComputedStyle(cell).fontFamily,
    );
    expect(readRenderedFontStack(surface)).not.toBe(
      getComputedStyle(document.body).fontFamily,
    );
    document.body.style.fontFamily = "";
  });

  test("says so rather than inventing a font when nothing is readable", () => {
    const surface = document.createElement("div");
    const originalGetComputedStyle = globalThis.getComputedStyle;
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({ fontFamily: "   " }),
    });

    try {
      expect(readRenderedFontStack(surface)).toBe(UNREADABLE_FONT_STACK);
    } finally {
      Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        value: originalGetComputedStyle,
      });
    }
  });

  test("publishes only terminal benchmark results on window", () => {
    const result = {
      status: "unsupported" as const,
      adapterId: "pretable" as const,
      scenarioId: "S4" as const,
      profile: "default" as const,
      scale: "smoke" as const,
      scriptName: "autosize" as const,
      browserName: "chromium" as const,
      browserVersion: "123.0",
      timestamp: "2026-04-10T13:00:00.000Z",
      seed: 404,
      rowCount: 120,
      viewport: {
        width: 1440,
        height: 900,
      },
      fontStack: '"IBM Plex Sans", system-ui, sans-serif',
      deviceScaleFactor: 1,
      notes: [],
      unsupported: {
        adapterId: "pretable" as const,
        scenarioId: "S4" as const,
        profile: "default" as const,
        scale: "smoke" as const,
        scriptName: "autosize" as const,
        reason: "unsupported in P0a",
      },
    };

    expect(publishBenchResult(result)).toBe(result);
    expect(window[BENCH_RESULT_KEY]).toBe(result);
  });

  test("formats internal pretable telemetry as notes without changing benchmark metrics", () => {
    expect(
      createPretableTelemetryNotes({
        focusedRowId: null,
        rowModelRowCount: 750,
        renderedRowCount: 8,
        selectedRowId: "evt-dev-0001",
        loadedRowCount: 750,
        totalRowCount: 750,
        totalHeight: 59010,
        visibleRowCount: 6,
        visibleRowRange: {
          start: 0,
          end: 6,
        },
      }),
    ).toEqual([
      "internal telemetry rendered rows: 8",
      "internal telemetry visible rows: 6",
      "internal telemetry loaded rows: 750",
      "internal telemetry planned height: 59010",
      "internal telemetry viewport range: 0-6",
      "internal telemetry selected row: evt-dev-0001",
      "internal telemetry focused row: none",
    ]);

    expect(createPretableTelemetryNotes(null)).toEqual([]);
  });

  test("derives interaction state directly from pretable telemetry", () => {
    expect(
      createBenchInteractionStateFromTelemetry(
        {
          focusedRowId: "evt-002",
          rowModelRowCount: 187,
          renderedRowCount: 7,
          selectedRowId: "evt-002",
          loadedRowCount: 750,
          totalRowCount: 750,
          totalHeight: 24115,
          visibleRowCount: 3,
          visibleRowRange: {
            start: 0,
            end: 3,
          },
        },
        750,
      ),
    ).toEqual({
      focusedRowId: "evt-002",
      resultRowCount: 187,
      selectedRowId: "evt-002",
    });

    expect(createBenchInteractionStateFromTelemetry(null, 750)).toEqual({
      focusedRowId: null,
      resultRowCount: 750,
      selectedRowId: null,
    });
  });

  test("extends the interaction settle budget for wrapped-text filtering", () => {
    expect(getMaxInteractionFrames(4, "sort")).toBe(48);
    expect(getMaxInteractionFrames(4, "filter-metadata")).toBe(48);
    expect(getMaxInteractionFrames(4, "filter-text")).toBe(96);
  });

  test("does not count the first intentional filter jump as post-interaction anchor drift", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <section data-benchmark-adapter="pretable">
          <div data-pretable-scroll-viewport="">
            <div data-pretable-row="" data-pretable-row-id="row-a" data-pretable-row-index="0">
              <div data-pretable-cell="">row a</div>
            </div>
            <div data-pretable-row="" data-pretable-row-id="row-b" data-pretable-row-index="1">
              <div data-pretable-cell="">row b</div>
            </div>
          </div>
        </section>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    const rows = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const cells = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    let phase: "baseline" | "filtered" = "baseline";
    let frame = 0;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(cells).toHaveLength(2);

    Object.defineProperties(viewport!, {
      clientTop: { value: 0, configurable: true },
      clientHeight: { value: 120, configurable: true },
      scrollHeight: { value: 240, configurable: true },
      scrollTop: {
        configurable: true,
        get() {
          return 0;
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 220,
      });

    rows[0]!.getBoundingClientRect = () =>
      phase === "baseline"
        ? createRect({ top: 100, bottom: 160 })
        : createRect({ top: 0, bottom: 0 });
    rows[1]!.getBoundingClientRect = () =>
      phase === "baseline"
        ? createRect({ top: 160, bottom: 220 })
        : createRect({ top: 100, bottom: 160 });

    for (const cell of cells) {
      Object.defineProperty(cell, "scrollHeight", {
        configurable: true,
        value: 60,
      });
    }

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frame += 1;
        callback(frame * 16);
        return frame;
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
        paddingTop: "0",
        paddingBottom: "0",
        borderBottomWidth: "0",
      }),
    });

    const result = await measureBenchInteractionRun(
      root!,
      "pretable",
      "filter-text",
      {
        focusedRowId: "row-b",
        resultRowCount: 1,
        selectedRowId: "row-b",
      },
      () => ({
        focusedRowId: "row-b",
        resultRowCount: phase === "baseline" ? 2 : 1,
        selectedRowId: "row-b",
      }),
      () => {
        phase = "filtered";
      },
    );

    expect(result.status).toBe("completed");
    expect(result.metrics.post_interaction_anchor_shift_px).toBe(0);
  });

  test("cell styles are resolved only on frames whose height errors are recorded", async () => {
    // #455: `sampleVisibleRows` resolved `getComputedStyle` on EVERY cell of
    // EVERY visible row on EVERY polled frame — including the pre-trigger quiet
    // wait and the trigger frame, whose height errors are then discarded. That
    // put the harness's observation cost inside the window it measures, scaled
    // by how much DOM the adapter renders: 72 style reads per poll for
    // pretable, 640 for tanstack, 943 for mui. The height-error measurement
    // must run exactly on the frames `recordRowHeightErrors` keeps.
    //
    // The metric itself must survive — see the companion assertion at the
    // bottom. A fix that silences the styles by silencing the measurement
    // would pass the counting half alone.
    const { layoutRow, root, viewport } = createDataUpdateHarness();
    const rows = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const pending = {
      frames: 3,
      apply: () => {
        for (const [index, row] of rows.entries()) {
          layoutRow(row, index - 1);
        }
      },
    };
    let triggered = false;
    const cellStyleReads = { beforeTrigger: 0, afterTrigger: 0 };
    const restore = installFrameStub(pending);
    const stubStyle = globalThis.getComputedStyle;
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: (element: Element) => {
        if (element.hasAttribute("data-pretable-cell")) {
          if (triggered) {
            cellStyleReads.afterTrigger += 1;
          } else {
            cellStyleReads.beforeTrigger += 1;
          }
        }
        return stubStyle(element);
      },
    });

    try {
      const result = await measureBenchInteractionRun(
        root,
        "pretable",
        "filter-metadata",
        {
          focusedRowId: null,
          resultRowCount: 3,
          selectedRowId: null,
        },
        () => ({
          focusedRowId: null,
          resultRowCount: 3,
          selectedRowId: null,
        }),
        () => {
          triggered = true;
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("completed");
      // The pre-trigger quiet wait polls the surface for stability. Its height
      // errors are never recorded, so it must not resolve a single cell style.
      expect(cellStyleReads.beforeTrigger).toBe(0);
      // ...while the measured window still resolves them, on the recorded
      // frames. Without this arm, deleting the measurement outright would pass.
      expect(cellStyleReads.afterTrigger).toBeGreaterThan(0);
      // And the metric the styles feed still reports. `measurable_rows` is the
      // count the gate requires; a fix that starved it would read 0 here.
      expect(
        result.metrics.post_interaction_row_height_error_measurable_rows,
      ).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  test("main-thread long tasks are measured from the trigger, not before it", async () => {
    // #458: the interaction path measured no main-thread blocking at all, so a
    // synchronous engine that blocks for its whole sort and a cooperative one
    // that never blocks reported indistinguishable results. The observer must
    // attach AT the trigger — a long task during the pre-trigger quiet wait is
    // mount tail, not the interaction's.
    const { layoutRow, root, viewport } = createDataUpdateHarness();
    const rows = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const pending: {
      frames: number;
      apply: () => void;
      onFrame?: (frame: number) => void;
    } = {
      frames: 3,
      apply: () => {
        for (const [index, row] of rows.entries()) {
          layoutRow(row, index - 1);
        }
      },
    };
    const restore = installFrameStub(pending);

    // jsdom has no PerformanceObserver; the stub records the callbacks the
    // harness registers for `longtask` so the test can play entries into them
    // at controlled moments.
    const longTaskCallbacks: Array<(list: unknown) => void> = [];
    const previousObserver = (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    class StubObserver {
      static supportedEntryTypes = ["longtask"];
      #callback: (list: unknown) => void;
      constructor(callback: (list: unknown) => void) {
        this.#callback = callback;
      }
      observe() {
        longTaskCallbacks.push(this.#callback);
      }
      disconnect() {
        const index = longTaskCallbacks.indexOf(this.#callback);
        if (index >= 0) longTaskCallbacks.splice(index, 1);
      }
    }
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: StubObserver,
    });
    const emit = (duration: number) => {
      for (const callback of [...longTaskCallbacks]) {
        callback({ getEntries: () => [{ duration }] });
      }
    };

    // Emitted DURING the run's own pre-trigger quiet wait (frame 1 is consumed
    // by waitForQuietSurface), not merely before the call — an observer
    // attached at function entry instead of at the trigger is listening by
    // then, and this is the emission that catches it.
    pending.onFrame = (frame: number) => {
      if (frame === 1) emit(120);
    };

    try {
      const result = await measureBenchInteractionRun(
        root,
        "pretable",
        "filter-metadata",
        {
          focusedRowId: null,
          resultRowCount: 3,
          selectedRowId: null,
        },
        () => ({
          focusedRowId: null,
          resultRowCount: 3,
          selectedRowId: null,
        }),
        () => {
          // The trigger IS the interaction: a synchronous engine blocks right
          // here. Two tasks so count and total are distinguishable.
          emit(80);
          emit(35);
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("completed");
      expect(result.metrics.post_interaction_long_tasks_count).toBe(2);
      expect(result.metrics.post_interaction_long_tasks_ms).toBe(115);
      // The run must also stop listening when it finishes.
      expect(longTaskCallbacks).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, "PerformanceObserver", {
        configurable: true,
        value: previousObserver,
      });
      restore();
    }
  });

  test("refuses to complete an interaction whose row count never reached the plan", async () => {
    const { layoutRow, root, viewport } = createDataUpdateHarness();
    const rows = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    // The contaminated ag-grid filter runs recorded in status/milestones: the
    // surface moved, so the settle detector latched and the run reported a
    // latency, but the filter never applied and the row count stayed unfiltered.
    const pending = {
      frames: 0,
      apply: () => {
        for (const [index, row] of rows.entries()) {
          layoutRow(row, index - 1);
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchInteractionRun(
        root,
        "pretable",
        "filter-metadata",
        {
          focusedRowId: "row-1",
          resultRowCount: 1,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        () => {
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("partial");
      expect(result.notes).toContain(
        "result row count settled at 3, not the 1 rows the plan handed the surface",
      );
    } finally {
      restore();
    }
  });

  test("measureBenchFilterKeystrokesRun measures every step and splits cold from warm", async () => {
    const { root } = createDataUpdateHarness();
    const restore = installFrameStub({ frames: 0, apply: () => {} });
    // Which step's trigger has fired; the telemetry override reports the
    // committed step's count, so the count change alone drives each latch.
    let committed = -1;
    const counts = [40, 12, 3];
    const calls: number[] = [];
    // Commit 1 is made genuinely SLOWER than the warm rest: after
    // triggerStep(0) fires, the override keeps reporting the pre-step count for
    // three more sampled frames before flipping — steps 1 and 2 flip
    // immediately. Under the frame stub every commit otherwise latches in the
    // same number of frames, and a mutation reading the LAST commit's total as
    // `keystroke_first_total_ms` would be indistinguishable from the truth.
    // Gated on `committed === 0`, not on overall call count: the override is
    // sampled during the pre-trigger baseline too, and a countdown that burns
    // there erases the asymmetry.
    let coldHoldSamples = 0;

    try {
      const result = await measureBenchFilterKeystrokesRun(
        root,
        "pretable",
        counts.map((resultRowCount, index) => ({
          value: "Bonjour".slice(0, index + 1),
          plan: {
            focusedRowId: "row-b",
            resultRowCount,
            selectedRowId: "row-b",
          },
        })),
        () => {
          if (committed === 0 && coldHoldSamples > 0) {
            coldHoldSamples -= 1;
            return {
              focusedRowId: "row-b",
              resultRowCount: 100,
              selectedRowId: "row-b",
            };
          }
          return {
            focusedRowId: "row-b",
            resultRowCount: committed < 0 ? 100 : counts[committed]!,
            selectedRowId: "row-b",
          };
        },
        (index) => {
          calls.push(index);
          committed = index;
          if (index === 0) {
            coldHoldSamples = 3;
          }
        },
      );

      expect(result.status).toBe("completed");
      expect(calls).toEqual([0, 1, 2]);
      expect(result.metrics.keystroke_commits_observed).toBe(3);
      expect(result.metrics.keystroke_first_total_ms).toBeGreaterThan(0);
      expect(result.metrics.keystroke_warm_total_p50_ms).toBeGreaterThan(0);
      expect(result.metrics.keystroke_warm_total_max_ms).toBeGreaterThanOrEqual(
        result.metrics.keystroke_warm_total_p50_ms!,
      );
      // The cold commit held back for three extra frames, so its total must
      // strictly exceed every warm total — this is what pins the first/warm
      // split to COMMIT 1 rather than to whichever commit came last.
      expect(result.metrics.keystroke_first_total_ms).toBeGreaterThan(
        result.metrics.keystroke_warm_total_max_ms!,
      );
      // Commit 1 is the cold one and doubles as the family's interaction
      // latency, so filter-keystrokes reads beside filter-text.
      expect(result.metrics.interaction_latency_ms).toBeGreaterThan(0);
      expect(result.metrics.keystroke_first_total_ms).toBe(
        result.metrics.interaction_latency_ms! +
          result.metrics.settle_duration_ms!,
      );
      expect(result.metrics.result_row_count).toBe(3);
    } finally {
      restore();
    }
  });

  test("a step that settles at the wrong count downgrades the whole run to partial and strips timings", async () => {
    // Step 2's telemetry never reaches its plan's count: the override reports
    // counts [40, 99, 3] while the plans expect [40, 12, 3]; the surface goes
    // stable at 99 so measureRowSetChange latches the stall and the sequence
    // must void itself at keystroke 2.
    const { root } = createDataUpdateHarness();
    const restore = installFrameStub({ frames: 0, apply: () => {} });
    let committed = -1;
    const reported = [40, 99, 3];

    try {
      const result = await measureBenchFilterKeystrokesRun(
        root,
        "pretable",
        [40, 12, 3].map((resultRowCount, index) => ({
          value: "Bonjour".slice(0, index + 1),
          plan: {
            focusedRowId: "row-b",
            resultRowCount,
            selectedRowId: "row-b",
          },
        })),
        () => ({
          focusedRowId: "row-b",
          resultRowCount: committed < 0 ? 100 : reported[committed]!,
          selectedRowId: "row-b",
        }),
        (index) => {
          committed = index;
        },
      );

      expect(result.status).toBe("partial");
      expect(result.notes.join(" ")).toContain("keystroke 2");
      expect(result.metrics.keystroke_first_total_ms).toBeUndefined();
      expect(result.metrics.interaction_latency_ms).toBeUndefined();
    } finally {
      restore();
    }
  });

  test("fewer than two steps is refused as partial (a sequence needs a warm tail)", async () => {
    const { root } = createDataUpdateHarness();
    const restore = installFrameStub({ frames: 0, apply: () => {} });

    try {
      const result = await measureBenchFilterKeystrokesRun(
        root,
        "pretable",
        [
          {
            value: "B",
            plan: {
              focusedRowId: null,
              resultRowCount: 40,
              selectedRowId: null,
            },
          },
        ],
        () => ({
          focusedRowId: null,
          resultRowCount: 100,
          selectedRowId: null,
        }),
        () => {},
      );

      expect(result.status).toBe("partial");
    } finally {
      restore();
    }
  });

  test("detects interior viewport gaps instead of only top and bottom misses", () => {
    document.body.innerHTML = `
      <div data-testid="viewport">
        <div data-pretable-row="" data-row-index="0"></div>
        <div data-pretable-row="" data-row-index="1"></div>
        <div data-pretable-row="" data-row-index="2"></div>
      </div>
    `;

    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="viewport"]',
    );
    const rows = [
      ...document.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];

    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(3);

    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 0,
        bottom: 120,
      });
    rows[0]!.getBoundingClientRect = () =>
      createRect({
        top: 0,
        bottom: 40,
      });
    rows[1]!.getBoundingClientRect = () =>
      createRect({
        top: 60,
        bottom: 90,
      });
    rows[2]!.getBoundingClientRect = () =>
      createRect({
        top: 90,
        bottom: 120,
      });

    expect(detectBlankGapFrame(viewport!)).toBe(true);
  });

  test("does not count viewport borders as blank gaps", () => {
    document.body.innerHTML = `
      <div data-testid="viewport">
        <div data-pretable-row="" data-row-index="0"></div>
      </div>
    `;

    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="viewport"]',
    );
    const row = document.querySelector<HTMLElement>("[data-pretable-row]");

    expect(viewport).toBeTruthy();
    expect(row).toBeTruthy();

    Object.defineProperties(viewport!, {
      clientTop: { value: 1, configurable: true },
      clientHeight: { value: 318, configurable: true },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 420,
      });
    row!.getBoundingClientRect = () =>
      createRect({
        top: 101,
        bottom: 419,
      });

    expect(detectBlankGapFrame(viewport!)).toBe(false);
  });

  test("does not count a sticky header as a blank gap before the first row", () => {
    document.body.innerHTML = `
      <div data-testid="viewport">
        <div data-testid="sticky-header"></div>
        <div data-pretable-row="" data-row-index="0"></div>
      </div>
    `;

    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="viewport"]',
    );
    const stickyHeader = document.querySelector<HTMLElement>(
      '[data-testid="sticky-header"]',
    );
    const row = document.querySelector<HTMLElement>("[data-pretable-row]");

    expect(viewport).toBeTruthy();
    expect(stickyHeader).toBeTruthy();
    expect(row).toBeTruthy();

    Object.defineProperties(viewport!, {
      clientTop: { value: 0, configurable: true },
      clientHeight: { value: 318, configurable: true },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 418,
      });
    stickyHeader!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 152,
      });
    row!.getBoundingClientRect = () =>
      createRect({
        top: 152,
        bottom: 418,
      });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: (element: Element) => ({
        position: element === stickyHeader ? "sticky" : "static",
      }),
    });

    expect(detectBlankGapFrame(viewport!)).toBe(false);
  });

  test("records viewport policy notes when a scroll viewport exists but is not scrollable", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="0" data-row-height="44">
            <div data-pretable-cell="">row 0</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();

    Object.defineProperties(viewport!, {
      clientHeight: { value: 320, configurable: true },
      scrollHeight: { value: 320, configurable: true },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "content",
        containIntrinsicSize: "auto 320px",
        contentVisibility: "auto",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    const result = await measurePretableScrollRun(root!);

    expect(result.status).toBe("partial");
    // The viewport is present and the content simply never exceeds the fold.
    // Saying "unavailable" here sent readers hunting for a missing element.
    expect(result.notes).toContain(
      "scroll viewport for pretable never became scrollable: 320px of content in a 320px viewport",
    );
    expect(result.notes).not.toContain(
      "scroll viewport unavailable for pretable in current runtime",
    );
    expect(result.notes).toContain("contain: content");
    expect(result.notes).toContain("content visibility: auto");
    expect(result.notes).toContain("contain intrinsic size: auto 320px");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
  });

  test("refuses to complete a mount run that rendered no rows", () => {
    const empty = createInitialRunOutcome({
      renderedRowCount: 0,
      mountMs: 12.5,
      domNodesPeak: 51,
    });

    expect(empty.status).toBe("partial");
    expect(empty.notes).toContain(
      "mount rendered 0 rows: the timings below measure a grid that never painted a row",
    );
    // bench-runner requires both for `initial` at any status, so they stay —
    // which is exactly why the status and the row count have to carry the truth.
    expect(empty.metrics.mount_ms).toBe(12.5);
    expect(empty.metrics.rendered_rows_peak).toBe(0);

    const painted = createInitialRunOutcome({
      renderedRowCount: 11,
      mountMs: 12.5,
      domNodesPeak: 400,
    });

    expect(painted.status).toBe("completed");
    expect(painted.notes).toEqual([]);
    expect(painted.metrics.rendered_rows_peak).toBe(11);
  });

  test("waits for a grid that mounts past the old 12-frame budget instead of calling it unavailable", async () => {
    // The incremental row model lands its first virtual window later than the
    // one-to-two frames executeRun waits after the remount. The Playwright trace
    // of a failing run shows the grid fully rendered (aria-rowcount 121, rows at
    // real heights) — the measurement simply looked too early.
    document.body.innerHTML = `<div data-testid="root"></div>`;
    const root = document.querySelector<HTMLElement>('[data-testid="root"]')!;
    const MOUNT_FRAME = 40;
    let frame = 0;

    const mountGrid = () => {
      root.innerHTML = `
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="0" data-row-height="60">
            <div data-pretable-cell="">row 0</div>
          </div>
          <div data-pretable-row="" data-row-index="1" data-row-height="60">
            <div data-pretable-cell="">row 1</div>
          </div>
        </div>
      `;
      const viewport = root.querySelector<HTMLElement>(
        "[data-pretable-scroll-viewport]",
      )!;
      Object.defineProperties(viewport, {
        clientTop: { value: 0, configurable: true },
        clientHeight: { value: 118, configurable: true },
        scrollHeight: { value: 360, configurable: true },
        scrollTop: {
          configurable: true,
          get() {
            return Number(this.dataset.scrollTop ?? "0");
          },
          set(value: number) {
            this.dataset.scrollTop = String(value);
          },
        },
      });
      viewport.getBoundingClientRect = () =>
        createRect({ top: 100, bottom: 218 });
      for (const [index, row] of [
        ...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]"),
      ].entries()) {
        row.getBoundingClientRect = () =>
          createRect({ top: 100 + index * 60, bottom: 160 + index * 60 });
        for (const cell of row.querySelectorAll<HTMLElement>(
          "[data-pretable-cell]",
        )) {
          Object.defineProperty(cell, "scrollHeight", {
            configurable: true,
            value: 60,
          });
        }
      }
    };

    const previousRaf = globalThis.requestAnimationFrame;
    const previousGetComputedStyle = globalThis.getComputedStyle;
    const previousPerformanceObserver = globalThis.PerformanceObserver;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frame += 1;
        if (frame === MOUNT_FRAME) mountGrid();
        callback(frame * 16);
        return frame;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class PerformanceObserver {
        static supportedEntryTypes = ["longtask"];
        observe() {}
        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
        paddingTop: "0",
        paddingBottom: "0",
        borderBottomWidth: "0",
      }),
    });

    try {
      const result = await measureBenchScrollRun(root, "pretable");

      expect(result.notes).not.toContain(
        "scroll viewport unavailable for pretable in current runtime",
      );
      expect(result.status).toBe("completed");
      expect(result.metrics.rendered_rows_peak).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: previousRaf,
      });
      Object.defineProperty(globalThis, "getComputedStyle", {
        configurable: true,
        value: previousGetComputedStyle,
      });
      Object.defineProperty(globalThis, "PerformanceObserver", {
        configurable: true,
        value: previousPerformanceObserver,
      });
    }
  });

  test("measures scroll anchor shift and row-height error for a scroll viewport", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="0" data-row-height="60">
            <div data-pretable-cell="">short</div>
          </div>
          <div data-pretable-row="" data-row-index="1" data-row-height="60">
            <div data-pretable-cell="">a much longer row with more content</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    const rows = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const cells = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    const rafTimestamps = [0, 16, 32, 48, 64, 80];
    let rafIndex = 0;
    const OriginalPerformanceObserver = globalThis.PerformanceObserver;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(cells).toHaveLength(2);

    Object.defineProperties(viewport!, {
      clientTop: { value: 1, configurable: true },
      clientHeight: { value: 118, configurable: true },
      scrollHeight: { value: 180, configurable: true },
      scrollTop: {
        configurable: true,
        get() {
          return Number(this.dataset.scrollTop ?? "0");
        },
        set(value: number) {
          this.dataset.scrollTop = String(value);
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 220,
      });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const timestamp = rafTimestamps[rafIndex] ?? rafTimestamps.at(-1) ?? 0;
        rafIndex += 1;
        callback(timestamp);
        return rafIndex;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class PerformanceObserver {
        static supportedEntryTypes = ["longtask"];

        observe() {}

        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    rows[0]!.getBoundingClientRect = () =>
      createRect({
        top: 101 - viewport!.scrollTop,
        bottom: 161 - viewport!.scrollTop,
      });
    rows[1]!.getBoundingClientRect = () =>
      createRect({
        top: 161 - viewport!.scrollTop,
        bottom: 221 - viewport!.scrollTop,
      });
    Object.defineProperty(cells[0]!, "scrollHeight", {
      configurable: true,
      value: 60,
    });
    Object.defineProperty(cells[1]!, "scrollHeight", {
      configurable: true,
      value: 84,
    });

    const result = await measurePretableScrollRun(root!);

    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: OriginalPerformanceObserver,
    });

    expect(result.status).toBe("completed");
    expect(result.notes).toContain("contain: none");
    expect(result.notes).toContain("content visibility: visible");
    expect(result.notes).toContain("contain intrinsic size: none");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
    expect(result.metrics.rendered_rows_peak).toBeGreaterThanOrEqual(2);
    expect(result.metrics.rendered_cells_peak).toBeGreaterThanOrEqual(2);
    expect(result.metrics.scroll_anchor_shift_px).toEqual(expect.any(Number));
    expect(result.metrics.scroll_anchor_shift_forward_p95_px).toEqual(
      expect.any(Number),
    );
    expect(result.metrics.scroll_anchor_shift_backward_p95_px).toEqual(
      expect.any(Number),
    );
    expect(result.metrics.row_height_error_p95_px).toEqual(expect.any(Number));
    expect(result.metrics.row_height_error_p95_px).toBeGreaterThanOrEqual(0);
  });

  test("waits for Pretable to settle its virtual window before sampling scroll gaps", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="32" data-row-height="60">
            <div data-pretable-cell="">row 32</div>
          </div>
          <div data-pretable-row="" data-row-index="33" data-row-height="60">
            <div data-pretable-cell="">row 33</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    const rows = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const cells = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    const OriginalPerformanceObserver = globalThis.PerformanceObserver;
    let animationFrameCount = 0;
    let settledScrollTop = 0;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(cells).toHaveLength(2);

    Object.defineProperties(viewport!, {
      clientTop: { value: 1, configurable: true },
      clientHeight: { value: 118, configurable: true },
      scrollHeight: { value: 360, configurable: true },
      scrollTop: {
        configurable: true,
        get() {
          return Number(this.dataset.scrollTop ?? "0");
        },
        set(value: number) {
          this.dataset.scrollTop = String(value);
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 220,
      });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        animationFrameCount += 1;

        if (animationFrameCount % 2 === 0) {
          settledScrollTop = viewport!.scrollTop;
        }

        callback(animationFrameCount * 16);
        return animationFrameCount;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class PerformanceObserver {
        static supportedEntryTypes = ["longtask"];

        observe() {}

        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    rows[0]!.getBoundingClientRect = () => {
      const settled = settledScrollTop === viewport!.scrollTop;

      return createRect(
        settled
          ? {
              top: 101,
              bottom: 161,
            }
          : {
              top: 101,
              bottom: 141,
            },
      );
    };
    rows[1]!.getBoundingClientRect = () => {
      const settled = settledScrollTop === viewport!.scrollTop;

      return createRect(
        settled
          ? {
              top: 161,
              bottom: 221,
            }
          : {
              top: 161,
              bottom: 201,
            },
      );
    };
    Object.defineProperty(cells[0]!, "scrollHeight", {
      configurable: true,
      value: 60,
    });
    Object.defineProperty(cells[1]!, "scrollHeight", {
      configurable: true,
      value: 60,
    });

    const result = await measurePretableScrollRun(root!);

    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: OriginalPerformanceObserver,
    });

    expect(result.status).toBe("completed");
    expect(result.notes).toContain("contain: none");
    expect(result.notes).toContain("content visibility: visible");
    expect(result.notes).toContain("contain intrinsic size: none");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
    expect(result.metrics.scroll_frame_p95_ms).toBe(16);
    expect(result.metrics.blank_gap_frames).toBe(0);
  });

  test("keeps waiting until the Pretable virtual window stabilizes before sampling", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="48" data-row-height="60">
            <div data-pretable-cell="">row 48</div>
          </div>
          <div data-pretable-row="" data-row-index="49" data-row-height="60">
            <div data-pretable-cell="">row 49</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    const rows = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-row]"),
    ];
    const cells = [
      ...root!.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    const OriginalPerformanceObserver = globalThis.PerformanceObserver;
    let animationFrameCount = 0;
    let settledScrollTop = 0;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(cells).toHaveLength(2);

    Object.defineProperties(viewport!, {
      clientTop: { value: 1, configurable: true },
      clientHeight: { value: 118, configurable: true },
      scrollHeight: { value: 360, configurable: true },
      scrollTop: {
        configurable: true,
        get() {
          return Number(this.dataset.scrollTop ?? "0");
        },
        set(value: number) {
          this.dataset.scrollTop = String(value);
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 220,
      });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        animationFrameCount += 1;

        if (animationFrameCount % 3 === 0) {
          settledScrollTop = viewport!.scrollTop;
        }

        callback(animationFrameCount * 16);
        return animationFrameCount;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class PerformanceObserver {
        static supportedEntryTypes = ["longtask"];

        observe() {}

        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    rows[0]!.getBoundingClientRect = () => {
      const settled = settledScrollTop === viewport!.scrollTop;

      return createRect(
        settled
          ? {
              top: 101,
              bottom: 161,
            }
          : {
              top: 101,
              bottom: 141,
            },
      );
    };
    rows[1]!.getBoundingClientRect = () => {
      const settled = settledScrollTop === viewport!.scrollTop;

      return createRect(
        settled
          ? {
              top: 161,
              bottom: 221,
            }
          : {
              top: 161,
              bottom: 201,
            },
      );
    };
    Object.defineProperty(cells[0]!, "scrollHeight", {
      configurable: true,
      value: 60,
    });
    Object.defineProperty(cells[1]!, "scrollHeight", {
      configurable: true,
      value: 60,
    });

    const result = await measurePretableScrollRun(root!);

    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: OriginalPerformanceObserver,
    });

    expect(result.status).toBe("completed");
    expect(result.notes).toContain("contain: none");
    expect(result.notes).toContain("content visibility: visible");
    expect(result.notes).toContain("contain intrinsic size: none");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
    expect(result.metrics.blank_gap_frames).toBe(0);
  });

  // This fixture is hand-built, and that is fine for what it measures — the
  // scroll ALGORITHM, which needs a DOM whose scrollTop, rects and rAF timing
  // are all controllable. It is not, and must not be read as, a check that AG
  // Grid still emits these class names: a fixture this file constructs will
  // keep passing for a selector the library has deleted, which is exactly what
  // happened when AG Grid 36 dropped `.ag-body-viewport` (#306). The selectors
  // are held against the real installed adapter in
  // `comparator-dom-contract.test.tsx`.
  test("measures AG Grid scroll runs from the live viewport and row selectors", async () => {
    document.body.innerHTML = `
        <div data-testid="root">
        <div aria-label="AG Grid Community adapter">
          <div class="ag-grid-viewport">
            <div class="ag-row" data-row-index="0" data-row-height="60">
              <div class="ag-cell">row 0</div>
            </div>
            <div class="ag-row" data-row-index="1" data-row-height="60">
              <div class="ag-cell">row 1</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(".ag-grid-viewport");
    const rows = [...root!.querySelectorAll<HTMLElement>(".ag-row")];
    const rafTimestamps = [0, 16, 32, 48, 64, 80];
    let rafIndex = 0;
    const OriginalPerformanceObserver = globalThis.PerformanceObserver;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(2);

    Object.defineProperties(viewport!, {
      clientTop: { value: 1, configurable: true },
      clientHeight: { value: 118, configurable: true },
      scrollHeight: { value: 180, configurable: true },
      scrollTop: {
        configurable: true,
        get() {
          return Number(this.dataset.scrollTop ?? "0");
        },
        set(value: number) {
          this.dataset.scrollTop = String(value);
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 220,
      });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const timestamp = rafTimestamps[rafIndex] ?? rafTimestamps.at(-1) ?? 0;
        rafIndex += 1;
        callback(timestamp);
        return rafIndex;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class PerformanceObserver {
        static supportedEntryTypes = ["longtask"];

        observe() {}

        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    rows[0]!.getBoundingClientRect = () =>
      createRect({
        top: 101 - viewport!.scrollTop,
        bottom: 161 - viewport!.scrollTop,
      });
    rows[1]!.getBoundingClientRect = () =>
      createRect({
        top: 161 - viewport!.scrollTop,
        bottom: 221 - viewport!.scrollTop,
      });

    const result = await measureBenchScrollRun(root!, "ag-grid");

    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: OriginalPerformanceObserver,
    });

    expect(result.status).toBe("completed");
    expect(result.notes).toContain("contain: none");
    expect(result.notes).toContain("content visibility: visible");
    expect(result.notes).toContain("contain intrinsic size: none");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
    expect(result.metrics.rendered_rows_peak).toBeGreaterThanOrEqual(2);
    expect(result.metrics.rendered_cells_peak).toBeGreaterThanOrEqual(2);
    expect(result.metrics.scroll_frame_p95_ms).toEqual(expect.any(Number));
    expect(result.metrics.blank_gap_frames).toBeGreaterThanOrEqual(0);
    expect(result.metrics.dom_nodes_peak).toEqual(expect.any(Number));
  });

  test("measures TanStack Table scroll runs from the live viewport and row selectors", async () => {
    document.body.innerHTML = `
        <div data-testid="root">
          <div aria-label="TanStack Table adapter">
            <div data-pretable-bench-tanstack-viewport="">
              <div data-tanstack-row="" data-row-index="0" data-row-height="60">
                <div data-tanstack-cell="">row 0</div>
              </div>
              <div data-tanstack-row="" data-row-index="1" data-row-height="60">
                <div data-tanstack-cell="">row 1 with longer content</div>
              </div>
            </div>
          </div>
        </div>
      `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-pretable-bench-tanstack-viewport]",
    );
    const rows = [
      ...root!.querySelectorAll<HTMLElement>("[data-tanstack-row]"),
    ];
    const cells = [
      ...root!.querySelectorAll<HTMLElement>("[data-tanstack-cell]"),
    ];
    const rafTimestamps = [0, 16, 32, 48, 64, 80];
    let rafIndex = 0;
    const OriginalPerformanceObserver = globalThis.PerformanceObserver;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(rows).toHaveLength(2);

    Object.defineProperties(viewport!, {
      clientTop: { value: 1, configurable: true },
      clientHeight: { value: 118, configurable: true },
      scrollHeight: { value: 180, configurable: true },
      scrollTop: {
        configurable: true,
        get() {
          return Number(this.dataset.scrollTop ?? "0");
        },
        set(value: number) {
          this.dataset.scrollTop = String(value);
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({
        top: 100,
        bottom: 220,
      });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const timestamp = rafTimestamps[rafIndex] ?? rafTimestamps.at(-1) ?? 0;
        rafIndex += 1;
        callback(timestamp);
        return rafIndex;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class PerformanceObserver {
        static supportedEntryTypes = ["longtask"];

        observe() {}

        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    rows[0]!.getBoundingClientRect = () =>
      createRect({
        top: 101 - viewport!.scrollTop,
        bottom: 161 - viewport!.scrollTop,
      });
    rows[1]!.getBoundingClientRect = () =>
      createRect({
        top: 161 - viewport!.scrollTop,
        bottom: 221 - viewport!.scrollTop,
      });
    Object.defineProperty(cells[0]!, "scrollHeight", {
      configurable: true,
      value: 60,
    });
    Object.defineProperty(cells[1]!, "scrollHeight", {
      configurable: true,
      value: 84,
    });

    const result = await measureBenchScrollRun(root!, "tanstack");

    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: OriginalPerformanceObserver,
    });

    expect(result.status).toBe("completed");
    expect(result.notes).toContain("contain: none");
    expect(result.notes).toContain("content visibility: visible");
    expect(result.notes).toContain("contain intrinsic size: none");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
    expect(result.metrics.rendered_rows_peak).toBeGreaterThanOrEqual(2);
    expect(result.metrics.rendered_cells_peak).toBeGreaterThanOrEqual(2);
    expect(result.metrics.scroll_frame_p95_ms).toEqual(expect.any(Number));
    expect(result.metrics.blank_gap_frames).toBeGreaterThanOrEqual(0);
    expect(result.metrics.dom_nodes_peak).toEqual(expect.any(Number));
  });

  test("measureBenchKeySequenceRun dispatches the requested key the requested number of times and reports a non-negative p95", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="0">
            <div data-pretable-cell="" tabindex="0">row 0</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const cell = root?.querySelector<HTMLElement>("[data-pretable-cell]");

    expect(root).toBeTruthy();
    expect(cell).toBeTruthy();

    const dispatched: string[] = [];
    cell!.addEventListener("keydown", (event) => {
      dispatched.push(event.key);
    });

    const result = await measureBenchKeySequenceRun(
      root!,
      "pretable",
      "select-range-extend",
      {
        key: "ArrowDown",
        shiftKey: true,
        count: 5,
        framesBetween: 1,
      },
    );

    expect(result.status).toBe("completed");
    expect(dispatched.length).toBe(5);
    expect(dispatched.every((k) => k === "ArrowDown")).toBe(true);
    expect(Number.isFinite(result.metrics.interaction_latency_ms ?? NaN)).toBe(
      true,
    );
    expect(result.metrics.interaction_latency_ms).toBeGreaterThanOrEqual(0);
  });

  test("measureBenchKeySequenceRun waits for cells that arrive after the viewport", async () => {
    // The viewport element attaches before the row model projects its first
    // window. One settle frame is not enough for that, so the run used to fail
    // for want of a body cell that was about to exist — which is how all three
    // selection scripts aborted the comparative runset at zero rendered rows.
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport=""></div>
      </div>
    `;
    const root = document.querySelector<HTMLElement>('[data-testid="root"]')!;
    const viewport = root.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    )!;
    const dispatched: string[] = [];
    const MOUNT_FRAME = 30;
    let frame = 0;

    const previousRaf = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frame += 1;
        if (frame === MOUNT_FRAME) {
          viewport.innerHTML = `
            <div data-pretable-row="" data-row-index="0">
              <div data-pretable-cell="" tabindex="0">row 0</div>
            </div>
          `;
          viewport
            .querySelector<HTMLElement>("[data-pretable-cell]")!
            .addEventListener("keydown", (event) => {
              dispatched.push((event as KeyboardEvent).key);
            });
        }
        callback(frame * 16);
        return frame;
      },
    });

    try {
      const result = await measureBenchKeySequenceRun(
        root,
        "pretable",
        "keyboard-nav-row",
        { key: "ArrowDown", shiftKey: false, count: 3, framesBetween: 1 },
      );

      expect(result.notes).not.toContain(
        "no body cell available for keyboard focus",
      );
      expect(result.status).toBe("completed");
      expect(dispatched).toEqual(["ArrowDown", "ArrowDown", "ArrowDown"]);
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: previousRaf,
      });
    }
  });

  test("measureBenchKeySequenceRun returns partial when no viewport is present", async () => {
    document.body.innerHTML = `<div data-testid="root"></div>`;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');

    expect(root).toBeTruthy();

    const result = await measureBenchKeySequenceRun(
      root!,
      "pretable",
      "keyboard-nav-row",
      {
        key: "ArrowDown",
        count: 10,
      },
    );

    expect(result.status).toBe("partial");
    expect(result.notes.some((n) => n.includes("viewport unavailable"))).toBe(
      true,
    );
  });

  test("measureBenchAutosizeRun calls the supplied autosize callback and returns a non-negative latency", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="0">
            <div data-pretable-cell="">row 0</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    expect(root).toBeTruthy();

    let invoked = 0;
    const result = await measureBenchAutosizeRun(root!, "pretable", () => {
      invoked += 1;
    });

    expect(invoked).toBe(1);
    expect(result.status).toBe("completed");
    expect(Number.isFinite(result.metrics.interaction_latency_ms ?? NaN)).toBe(
      true,
    );
    expect(result.metrics.interaction_latency_ms).toBeGreaterThanOrEqual(0);
  });

  test("measureBenchAutosizeRun returns partial when no callback is registered", async () => {
    document.body.innerHTML = `<div data-testid="root"></div>`;
    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    expect(root).toBeTruthy();

    const result = await measureBenchAutosizeRun(root!, "pretable", null);

    expect(result.status).toBe("partial");
    expect(
      result.notes.some((n) => n.includes("no autosize callback registered")),
    ).toBe(true);
  });

  // The churn-free streaming variant rests entirely on this: patches must
  // never land on the grouping level, or group membership moves mid-run and
  // the measurement is back to conflating grouping with key churn. The
  // default must stay unfiltered, because that is what `updates` and
  // `group-updates` measure and their comparability depends on it.
  test("measureBenchUpdatesRun writes every column by default and honours excludeColumnIds", async () => {
    document.body.innerHTML = `
      <div data-testid="root">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-row-index="0">
            <div data-pretable-cell="">row 0</div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    expect(root).toBeTruthy();

    // An earlier test in this file installs a SYNCHRONOUS rAF stub and leaves
    // it in place; measureBenchUpdatesRun re-arms rAF from inside its own
    // callback, so that stub recurses until the stack blows. Give this test a
    // real, deferred rAF and put the previous one back afterwards.
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancelRaf = globalThis.cancelAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) =>
        setTimeout(() => callback(performance.now()), 16) as unknown as number,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: (handle: number) => clearTimeout(handle),
    });

    const dataset = {
      rows: [
        { id: "r0", col_4: "a", col_5: "owner-a", col_6: "b" },
        { id: "r1", col_4: "a", col_5: "owner-b", col_6: "b" },
      ],
      columns: [{ id: "col_4" }, { id: "col_5" }, { id: "col_6" }],
    };

    const collectKeys = async (excludeColumnIds: readonly string[]) => {
      const written = new Set<string>();
      const result = await measureBenchUpdatesRun(
        root!,
        "pretable",
        (patches) => {
          for (const patch of patches) {
            for (const key of Object.keys(patch)) {
              if (key !== "id") written.add(key);
            }
          }
        },
        dataset,
        { excludeColumnIds },
      );

      expect(result.status).toBe("completed");
      return [...written].sort();
    };

    try {
      // `updates` and `group-updates` both pass `[]`, so both keep writing
      // every column — including the grouping level.
      expect(benchUpdatesExcludedColumnIds("updates")).toEqual([]);
      expect(benchUpdatesExcludedColumnIds("group-updates")).toEqual([]);
      expect(await collectKeys([])).toEqual(["col_4", "col_5", "col_6"]);

      // `group-updates-stable-keys` excludes the grouping level and nothing
      // else.
      expect(
        benchUpdatesExcludedColumnIds("group-updates-stable-keys"),
      ).toEqual(["col_5"]);
      expect(
        await collectKeys(
          benchUpdatesExcludedColumnIds("group-updates-stable-keys"),
        ),
      ).toEqual(["col_4", "col_6"]);
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: previousRaf,
      });
      Object.defineProperty(globalThis, "cancelAnimationFrame", {
        configurable: true,
        value: previousCancelRaf,
      });
    }
  }, 30_000);
});

function createRect(input: { top: number; bottom: number }): DOMRect {
  return {
    x: 0,
    y: input.top,
    width: 100,
    height: input.bottom - input.top,
    top: input.top,
    right: 100,
    bottom: input.bottom,
    left: 0,
    toJSON: () => ({}),
  };
}

/**
 * A three-row pretable surface whose cell text is the only thing a same-ids
 * replacement changes. Row ids, row indices, row tops and the result row count
 * all hold still — which is exactly the case the settle detector used for sort
 * and filter cannot see.
 */
function createDataUpdateHarness() {
  document.body.innerHTML = `
    <div data-testid="root">
      <section data-benchmark-adapter="pretable" data-bench-grid-instance-id="1">
        <div data-pretable-scroll-viewport="">
          <div data-pretable-row="" data-pretable-row-id="row-0" data-pretable-row-index="0">
            <div data-pretable-cell="" data-pretable-column-id="col_0">baseline 0</div>
          </div>
          <div data-pretable-row="" data-pretable-row-id="row-1" data-pretable-row-index="1">
            <div data-pretable-cell="" data-pretable-column-id="col_0">baseline 1</div>
          </div>
          <div data-pretable-row="" data-pretable-row-id="row-2" data-pretable-row-index="2">
            <div data-pretable-cell="" data-pretable-column-id="col_0">baseline 2</div>
          </div>
        </div>
      </section>
    </div>
  `;

  const root = document.querySelector<HTMLElement>('[data-testid="root"]')!;
  const viewport = root.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  )!;
  let scrollTop = 0;

  Object.defineProperties(viewport, {
    clientTop: { value: 0, configurable: true },
    clientHeight: { value: 180, configurable: true },
    scrollHeight: { value: 360, configurable: true },
    scrollTop: {
      configurable: true,
      get() {
        return scrollTop;
      },
      set(next: number) {
        scrollTop = next;
      },
    },
  });
  viewport.getBoundingClientRect = () => createRect({ top: 100, bottom: 280 });

  const layoutRow = (row: HTMLElement, index: number) => {
    row.getBoundingClientRect = () =>
      createRect({ top: 100 + index * 60, bottom: 160 + index * 60 });
    for (const cell of row.querySelectorAll<HTMLElement>(
      "[data-pretable-cell]",
    )) {
      Object.defineProperty(cell, "scrollHeight", {
        configurable: true,
        value: 60,
      });
    }
  };

  for (const [index, row] of [
    ...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]"),
  ].entries()) {
    layoutRow(row, index);
  }

  return { layoutRow, root, viewport };
}

/** Milliseconds the frame stub advances per rAF. Both interaction timings are integer
 *  multiples of it, which is what the frame-count assertions below pin. */
const STUB_FRAME_MS = 16;

/**
 * Installs a synchronous rAF whose callback can apply a DOM mutation a fixed
 * number of frames after the trigger — the stand-in for React committing the new
 * row array on a later frame. `onFrame` runs on every frame regardless of the
 * trigger, which is how a surface still in motion at hand-over is simulated.
 * Returns the restore function.
 */
function installFrameStub(pending: {
  frames: number;
  apply: () => void;
  onFrame?: (frame: number) => void;
}) {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  let frame = 0;

  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      frame += 1;
      pending.onFrame?.(frame);

      if (pending.frames > 0) {
        pending.frames -= 1;

        if (pending.frames === 0) {
          pending.apply();
        }
      }

      callback(frame * STUB_FRAME_MS);
      return frame;
    },
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({
      contain: "none",
      containIntrinsicSize: "none",
      contentVisibility: "visible",
      overflowAnchor: "none",
      overscrollBehavior: "contain",
      paddingTop: "0",
      paddingBottom: "0",
      borderBottomWidth: "0",
      position: "static",
    }),
  });

  return () => {
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: previousRaf,
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: previousGetComputedStyle,
    });
  };
}

describe("groupRowSelector", () => {
  test("the group-capable adapters declare the selector their renderer paints", () => {
    // These literals are the coupling #483 made load-bearing: the selector
    // decides completed-vs-partial for the grouping scripts. A profile whose
    // selector doesn't match what its renderer paints produces NO numbers
    // (partial, every run), which reads as flake rather than a broken
    // harness — so pin the exact strings.
    expect(scrollRuntimeProfiles.pretable.groupRowSelector).toBe(
      "[data-pretable-group-row]",
    );
    expect(scrollRuntimeProfiles.tanstack.groupRowSelector).toBe(
      "[data-tanstack-group-row]",
    );
  });

  test("the tier-excluded adapters declare none", () => {
    expect(scrollRuntimeProfiles["ag-grid"].groupRowSelector).toBeUndefined();
    expect(scrollRuntimeProfiles.mui.groupRowSelector).toBeUndefined();
  });
});

describe("readBenchGridInstanceId", () => {
  function createProbeRoot(markup: string) {
    document.body.innerHTML = `<div data-testid="root">${markup}</div>`;

    return document.querySelector<HTMLElement>('[data-testid="root"]')!;
  }

  test("reads an id the adapter published", () => {
    const root = createProbeRoot(
      `<section data-benchmark-adapter="pretable" data-bench-grid-instance-id="7"></section>`,
    );

    expect(readBenchGridInstanceId(root)).toBe("7");
  });

  test("reports unavailable when no element carries the attribute", () => {
    const root = createProbeRoot(
      `<section data-benchmark-adapter="pretable"></section>`,
    );

    expect(readBenchGridInstanceId(root)).toBeNull();
  });

  test("refuses 0, the value that means no instance was ever recorded", () => {
    const root = createProbeRoot(
      `<section data-benchmark-adapter="pretable" data-bench-grid-instance-id="0"></section>`,
    );

    // Ids are handed out from a sequence that pre-increments, so the first real one
    // is 1 and 0 can only mean "nothing published yet". Accepting it would let
    // measureBenchDataUpdateRun compare 0 against 0 and score
    // grid_instance_reconstructed: 0 — §11's PASS value — on a run whose engine was
    // never observed at all.
    expect(readBenchGridInstanceId(root)).toBeNull();
  });

  test("refuses values that cannot be an id from the sequence", () => {
    for (const value of ["", " ", "-1", "00", "1.5", "x", "01"]) {
      const root = createProbeRoot(
        `<section data-benchmark-adapter="pretable" data-bench-grid-instance-id="${value}"></section>`,
      );

      expect(readBenchGridInstanceId(root)).toBeNull();
    }
  });

  test("reports unavailable for a missing root rather than throwing mid-run", () => {
    expect(readBenchGridInstanceId(null)).toBeNull();
  });
});

describe("bench data update runtime", () => {
  test("times a same-ids replacement, which moves no row id, top or count", async () => {
    const { root, viewport } = createDataUpdateHarness();
    const cells = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    const pending = {
      frames: 0,
      apply: () => {
        for (const [index, cell] of cells.entries()) {
          cell.textContent = `refreshed ${index}`;
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "replace",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 3,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        () => "1",
        () => {
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("completed");
      expect(result.notes).toContain("data update mode: replace");
      expect(result.metrics.interaction_latency_ms).toBeGreaterThan(0);
      expect(result.metrics).toMatchObject({
        settle_duration_ms: expect.any(Number),
        post_interaction_blank_gap_frames: expect.any(Number),
        post_interaction_anchor_shift_px: expect.any(Number),
        post_interaction_row_height_error_p95_px: expect.any(Number),
        result_row_count: 3,
        selected_row_preserved: 1,
        focused_row_preserved: 1,
        scroll_position_drift_px: 0,
        grid_instance_reconstructed: 0,
      });
    } finally {
      restore();
    }
  });

  test("reports a rebuilt grid instance rather than absorbing it into the latency", async () => {
    const { root, viewport } = createDataUpdateHarness();
    const cells = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    let instanceId = "1";
    const pending = {
      frames: 0,
      apply: () => {
        instanceId = "2";
        for (const [index, cell] of cells.entries()) {
          cell.textContent = `refreshed ${index}`;
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "replace",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 3,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        () => instanceId,
        () => {
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("completed");
      expect(result.metrics.grid_instance_reconstructed).toBe(1);
      // POLARITY, pinned deliberately: this metric passes at 0 and fails at 1, the
      // inverse of the two preservation metrics beside it in bench-runner's
      // required-metric block. Here the rebuild happened (1) while selection and focus
      // survived (1) — so an evaluator that scored the three the same way would read
      // this run as clean.
      expect(result.metrics.selected_row_preserved).toBe(1);
      expect(result.metrics.focused_row_preserved).toBe(1);
    } finally {
      restore();
    }
  });

  test("refuses to score reconstruction when the instance-id probe reads nothing", async () => {
    const { root, viewport } = createDataUpdateHarness();
    const cells = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    const pending = {
      frames: 0,
      apply: () => {
        for (const [index, cell] of cells.entries()) {
          cell.textContent = `refreshed ${index}`;
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "replace",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 3,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        // A missed selector, a renamed attribute, an adapter that never published the
        // id. Comparing two identical misses would report 0 — a PASS on the one metric
        // §11's replace budget rests on, produced by a broken reader.
        () => null,
        () => {
          pending.frames = 2;
        },
      );

      // `failed`, not `partial`: bench-runner refuses to record a partial replace at
      // all, so a partial here would reach its guard and the run would be filed under
      // that throw instead of under the reader that went silent.
      expect(result.status).toBe("failed");
      expect(result.metrics.grid_instance_reconstructed).toBeUndefined();
      expect(
        result.notes.some((note) =>
          note.includes("grid instance id unavailable"),
        ),
      ).toBe(true);
      expect(
        result.status === "failed" ? result.error.message : null,
      ).toContain("grid instance id unavailable before the update");
    } finally {
      restore();
    }
  });

  test("refuses a run whose row count did not reach the count the plan handed the surface", async () => {
    const { root, viewport } = createDataUpdateHarness();
    const cells = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    let resultRowCount = 3;
    const pending = {
      frames: 0,
      apply: () => {
        // Something repainted, so the change detector latches and the run would
        // otherwise report a healthy latency — but only 4 of the planned 5 rows landed.
        resultRowCount = 4;
        for (const [index, cell] of cells.entries()) {
          cell.textContent = `refreshed ${index}`;
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "append",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 5,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount,
          selectedRowId: "row-1",
        }),
        () => "1",
        () => {
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("failed");
      expect(
        result.notes.some((note) =>
          note.includes("result row count settled at 4, not the 5"),
        ),
      ).toBe(true);
      expect(
        result.status === "failed" ? result.error.message : null,
      ).toContain("result row count settled at 4, not the 5");
    } finally {
      restore();
    }
  });

  test("latches the frame the change actually landed on, and publishes both timings as frame counts", async () => {
    const { root, viewport } = createDataUpdateHarness();
    const cells = [
      ...viewport.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
    ];
    const pending = {
      frames: 0,
      apply: () => {
        for (const [index, cell] of cells.entries()) {
          cell.textContent = `refreshed ${index}`;
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "replace",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 3,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        () => "1",
        () => {
          // Lands on the SECOND frame after the window opens, not the first.
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("completed");
      // Exact, not `toBeGreaterThan(0)`: an off-by-one in the detector — latching the
      // trigger's own frame, or the frame after the change — still produces a positive
      // latency and would pass a loose assertion.
      expect(result.metrics.interaction_latency_ms).toBe(2 * STUB_FRAME_MS);
      expect(result.notes).toContain("frames to first change: 2");
      // pretable's profile settles at maxSettleFrames 3, so 2 stable frames is the
      // floor this loop cannot report less than. Published so a reader cannot mistake
      // the floor for a measurement.
      expect(result.metrics.settle_duration_ms).toBe(2 * STUB_FRAME_MS);
      expect(result.notes).toContain("frames to settle: 2 (floor 2)");
      expect(result.notes).toContain(
        `frame interval median ms: ${STUB_FRAME_MS.toFixed(2)}`,
      );
    } finally {
      restore();
    }
  });

  test("waits for a surface still in motion at hand-over instead of latching its tail", async () => {
    const { root, viewport } = createDataUpdateHarness();
    const firstCell = viewport.querySelector<HTMLElement>(
      "[data-pretable-cell]",
    )!;
    // Controlled focus scrolls the probe row into view, so the caller hands over while
    // the surface is still repainting. The window must not open on top of that: the
    // first frame after it would differ from a stale baseline and latch as this
    // trigger's first painted frame, reporting the one-frame floor.
    const pending = {
      frames: 0,
      apply: () => {},
      onFrame: (frame: number) => {
        if (frame <= 5) {
          firstCell.textContent = `in flight ${frame}`;
        }
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "replace",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 3,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        () => "1",
        // Fires nothing. Without the quiet gate the pre-hand-over motion is the only
        // thing that repaints and the run still reports `completed` with a one-frame
        // latency, which is the failure this pins.
        () => {},
      );

      expect(result.status).toBe("failed");
      expect(result.metrics.interaction_latency_ms).toBeUndefined();
    } finally {
      restore();
    }
  }, 20_000);

  test("times an append and reports the viewport's own scroll drift", async () => {
    const { layoutRow, root, viewport } = createDataUpdateHarness();
    let resultRowCount = 3;
    const pending = {
      frames: 0,
      apply: () => {
        const appended = document.createElement("div");
        appended.setAttribute("data-pretable-row", "");
        appended.setAttribute("data-pretable-row-id", "row-3");
        appended.setAttribute("data-pretable-row-index", "3");
        appended.innerHTML = `<div data-pretable-cell="" data-pretable-column-id="col_0">appended 3</div>`;
        viewport.append(appended);
        layoutRow(appended, 3);
        resultRowCount = 4;
      },
    };
    const restore = installFrameStub(pending);

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "append",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 4,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount,
          selectedRowId: "row-1",
        }),
        () => "1",
        () => {
          pending.frames = 2;
        },
      );

      expect(result.status).toBe("completed");
      expect(result.notes).toContain("data update mode: append");
      expect(result.metrics.result_row_count).toBe(4);
      // The viewport's own offset did not move even though a row arrived below it.
      expect(result.metrics.scroll_position_drift_px).toBe(0);
      expect(result.metrics.grid_instance_reconstructed).toBe(0);
      // An append whose new rows never enter the DOM computes blank-gap frames,
      // anchor shift and row-height error over rows it never touched, and reports a
      // perfect score for having rendered nothing. The count says which run this was.
      expect(result.notes).toContain("rows newly rendered by the update: 1");
    } finally {
      restore();
    }
  });

  test("fails with the frame budget it ran out when nothing repaints, rather than banking an unmeasured run", async () => {
    const { root } = createDataUpdateHarness();
    const restore = installFrameStub({ frames: 0, apply: () => {} });

    try {
      const result = await measureBenchDataUpdateRun(
        root,
        "pretable",
        "replace",
        {
          focusedRowId: "row-1",
          probeColumnId: "col_0",
          resultRowCount: 3,
          selectedRowId: "row-1",
        },
        () => ({
          focusedRowId: "row-1",
          resultRowCount: 3,
          selectedRowId: "row-1",
        }),
        () => "1",
        () => {},
      );

      expect(result.status).toBe("failed");
      expect(result.notes).toContain("data update mode: replace");
      expect(result.metrics.interaction_latency_ms).toBeUndefined();
      // The frame loop's own exit has no note of its own, so without this the failed
      // artifact would say which script stopped and nothing about why.
      expect(
        result.status === "failed" ? result.error.message : null,
      ).toContain("no frame changed the watched signature");
    } finally {
      restore();
    }
  }, 20_000);
});

describe("scroll targets track a growing scroll extent", () => {
  /**
   * A grid with auto-height rows does not know its own height up front: AG Grid
   * keeps the `rowHeight` option for every unmeasured row, so `scrollHeight`
   * grows underneath the pass as cells are rendered and measured.
   *
   * Deriving all 36 targets from one initial `scrollHeight` therefore aims the
   * whole run at a mostly-unmeasured model, and the pass covers a shrinking
   * fraction of the dataset — while a grid that sizes rows up front covers all
   * of it. That is a like-for-like break, and it only appeared once the
   * comparator adapters started wrapping (#400).
   *
   * The fixture grows the content as it is scrolled, which is the shape of the
   * real failure. For a fixed-height grid `scrollHeight` never moves and the
   * fraction form is arithmetically identical to the old one, so this changes
   * only the case the old form got wrong.
   */
  test("aims at the live scroll extent, not the one sampled before measurement", async () => {
    document.body.innerHTML = `
        <div data-testid="root">
        <div aria-label="AG Grid Community adapter">
          <div class="ag-grid-viewport">
            <div class="ag-row" data-row-index="0" data-row-height="60">
              <div class="ag-cell">row 0</div>
            </div>
            <div class="ag-row" data-row-index="1" data-row-height="60">
              <div class="ag-cell">row 1</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(".ag-grid-viewport");
    const rows = [...root!.querySelectorAll<HTMLElement>(".ag-row")];
    const OriginalPerformanceObserver = globalThis.PerformanceObserver;
    const assignedTops: number[] = [];
    const INITIAL_SCROLL_HEIGHT = 1_000;
    const CLIENT_HEIGHT = 120;
    const initialMaxScrollTop = INITIAL_SCROLL_HEIGHT - CLIENT_HEIGHT;
    let scrollTop = 0;

    expect(root).toBeTruthy();
    expect(viewport).toBeTruthy();

    Object.defineProperties(viewport!, {
      clientTop: { value: 0, configurable: true },
      clientHeight: { value: CLIENT_HEIGHT, configurable: true },
      scrollHeight: {
        configurable: true,
        get() {
          // Content grows as the run scrolls into it, the way measured
          // auto-height rows grow a grid that had estimated them at 48px.
          return Math.min(5_000, INITIAL_SCROLL_HEIGHT + scrollTop * 4);
        },
      },
      scrollTop: {
        configurable: true,
        get() {
          return scrollTop;
        },
        set(value: number) {
          assignedTops.push(value);
          scrollTop = value;
        },
      },
    });
    viewport!.getBoundingClientRect = () =>
      createRect({ top: 0, bottom: CLIENT_HEIGHT });

    let frame = 0;

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frame += 1;
        callback(frame * 16);
        return frame;
      },
    });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: class {
        static supportedEntryTypes = ["longtask"];
        observe() {}
        disconnect() {}
      },
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({
        contain: "none",
        containIntrinsicSize: "none",
        contentVisibility: "visible",
        overflowAnchor: "none",
        overscrollBehavior: "contain",
      }),
    });

    for (const [index, row] of rows.entries()) {
      row.getBoundingClientRect = () =>
        createRect({
          top: index * 60 - viewport!.scrollTop,
          bottom: (index + 1) * 60 - viewport!.scrollTop,
        });
    }

    await measureBenchScrollRun(root!, "ag-grid");

    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: OriginalPerformanceObserver,
    });

    // The load-bearing assertion. Targets derived once from the initial extent
    // can never exceed it, so this is exactly the number that separates the two
    // implementations.
    expect(Math.max(...assignedTops)).toBeGreaterThan(initialMaxScrollTop);

    // And the run must still reach the true bottom, not merely overshoot the
    // stale value — otherwise a partial fix would pass the assertion above.
    expect(Math.max(...assignedTops)).toBeGreaterThanOrEqual(
      viewport!.scrollHeight - CLIENT_HEIGHT - 1,
    );
  });
});
