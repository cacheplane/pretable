import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  BENCH_RESULT_KEY,
  createPretableTelemetryNotes,
  createBenchRequest,
  detectBlankGapFrame,
  measureBenchScrollRun,
  measurePretableScrollRun,
  publishBenchResult,
} from "../bench-runtime";
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
        renderedRowCount: 8,
        selectedRowId: "evt-dev-0001",
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
      "internal telemetry planned height: 59010",
      "internal telemetry viewport range: 0-6",
      "internal telemetry selected row: evt-dev-0001",
    ]);

    expect(createPretableTelemetryNotes(null)).toEqual([]);
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

  test("measures Grid Alpha scroll runs from the live viewport and row selectors", async () => {
    document.body.innerHTML = `
        <div data-testid="root">
        <div aria-label="Grid Alpha Community adapter">
          <div class="ag-body-viewport">
            <div class="ag-row" row-index="0" style="height: 60px;">
              <div class="ag-cell">row 0</div>
            </div>
            <div class="ag-row" row-index="1" style="height: 60px;">
              <div class="ag-cell">row 1</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(".ag-body-viewport");
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

    const result = await measureBenchScrollRun(root!, "gridalpha");

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

  test("measures GridBeta Virtual scroll runs from the live viewport and row selectors", async () => {
    document.body.innerHTML = `
        <div data-testid="root">
          <div aria-label="GridBeta Virtual adapter">
            <div data-gridbeta-scroll-viewport="">
              <div data-gridbeta-row="" data-row-index="0" data-row-height="60">
                <div data-gridbeta-cell="">row 0</div>
              </div>
              <div data-gridbeta-row="" data-row-index="1" data-row-height="60">
                <div data-gridbeta-cell="">row 1 with longer content</div>
              </div>
            </div>
          </div>
        </div>
      `;

    const root = document.querySelector<HTMLElement>('[data-testid="root"]');
    const viewport = root?.querySelector<HTMLElement>(
      "[data-gridbeta-scroll-viewport]",
    );
    const rows = [
      ...root!.querySelectorAll<HTMLElement>("[data-gridbeta-row]"),
    ];
    const cells = [
      ...root!.querySelectorAll<HTMLElement>("[data-gridbeta-cell]"),
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

    const result = await measureBenchScrollRun(root!, "gridbeta");

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
