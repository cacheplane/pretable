import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  BENCH_RESULT_KEY,
  createBenchInteractionStateFromTelemetry,
  getMaxInteractionFrames,
  createPretableTelemetryNotes,
  createBenchRequest,
  detectBlankGapFrame,
  measureBenchAutosizeRun,
  measureBenchDataUpdateRun,
  measureBenchInteractionRun,
  measureBenchKeySequenceRun,
  measureBenchScrollRun,
  measureBenchUpdatesRun,
  measurePretableScrollRun,
  publishBenchResult,
  readBenchGridInstanceId,
} from "../bench-runtime";
import { benchUpdatesExcludedColumnIds } from "../interaction-plan";
import type { BenchQueryState } from "../bench-types";

describe("bench runtime", () => {
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
    };

    expect(createBenchRequest(query, dataset, "123.0")).toMatchObject({
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
      fontStack: expect.stringContaining("IBM Plex Sans"),
      deviceScaleFactor: 1,
    });
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
        matchingTotal: { kind: "exact", count: 750 },
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
          matchingTotal: { kind: "exact", count: 750 },
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
    expect(result.notes).toContain(
      "scroll viewport unavailable for pretable in current runtime",
    );
    expect(result.notes).toContain("contain: content");
    expect(result.notes).toContain("content visibility: auto");
    expect(result.notes).toContain("contain intrinsic size: auto 320px");
    expect(result.notes).toContain("scroll anchoring: none");
    expect(result.notes).toContain("overscroll behavior: contain");
    expect(result.metrics.scroll_viewport_nodes_peak).toBeGreaterThanOrEqual(3);
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

      expect(result.status).toBe("partial");
      expect(result.metrics.grid_instance_reconstructed).toBeUndefined();
      expect(
        result.notes.some((note) =>
          note.includes("grid instance id unavailable"),
        ),
      ).toBe(true);
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

      expect(result.status).toBe("partial");
      expect(
        result.notes.some((note) =>
          note.includes("result row count settled at 4, not the 5"),
        ),
      ).toBe(true);
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

      expect(result.status).toBe("partial");
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

  test("stays partial when nothing repaints, so the run cannot be recorded as a measurement", async () => {
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

      expect(result.status).toBe("partial");
      expect(result.notes).toContain("data update mode: replace");
      expect(result.metrics.interaction_latency_ms).toBeUndefined();
    } finally {
      restore();
    }
  }, 20_000);
});
