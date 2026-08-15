import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgGridAdapter } from "../ag-grid-adapter";
import type { ApplyBenchUpdates } from "../bench-runtime";
import type { BenchInteractionPlan } from "../interaction-plan";

/**
 * ---------------------------------------------------------------------------
 * Leak bookkeeping. Read this before touching the teardown below.
 * ---------------------------------------------------------------------------
 *
 * This file used to `render()` a grid per test and never unmount one. That is
 * not a style nit: AG Grid keeps working after the assertions finish, and the
 * queued work outlives the test that started it. Measured on this file with
 * one mount and no unmount, the following was still scheduled when the file's
 * tests were over:
 *
 *   9 timeouts, 2 intervals, 5 animation frames
 *
 * all of it owned by `ag-grid-community` / `ag-grid-react` / `ag-stack`. The
 * worst of them is `warnOnAttachToShadowRoot` (ag-stack), a watchdog that
 * polls `el.getRootNode()` and `el.isConnected` once a second for sixty
 * retries. AG Grid only cancels it from its destroy hook
 * (`onDestroy(() => clearInterval(interval))`), so a grid that is never
 * unmounted keeps poking at its DOM for a full minute after the file that
 * built it has moved on. Run 31858732889 on `main` reported `132 passed` and
 * `Errors: 1 error` attributed to this file, which skipped the production
 * deploy.
 *
 * Note that `cleanup()` on its own is NOT the whole fix. Unmounting runs AG
 * Grid's destroy, which cancels what it can, but the same measurement after a
 * bare `cleanup()` still showed 7 timeouts / 1 interval / 5 frames pending —
 * work already handed to the host that AG Grid does not hold an id for, plus
 * one-shot callbacks it guards internally with `isAlive()`. Those have to be
 * allowed to *run* while the document is still alive, which is what `quiesce`
 * below does. Unmount cancels; the drain retires the rest.
 *
 * The counters exist so `leaves nothing scheduled behind` can assert the
 * property directly instead of asserting "the tests passed" — which they
 * always did, including on the run that failed the gate.
 */
const AG_GRID_OWNED = /ag-grid-community|ag-grid-react|ag-stack/;

const pendingTimeouts = new Map<unknown, string>();
const pendingIntervals = new Map<unknown, string>();
const pendingFrames = new Map<number, string>();

/** The stack of whoever scheduled a handle, so a leak can be attributed. */
function scheduledBy(): string {
  return String(new Error("scheduled here").stack ?? "");
}

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;
const nativeCancelAnimationFrame = globalThis.cancelAnimationFrame;

globalThis.setTimeout = ((handler: never, ms: never, ...rest: never[]) => {
  const id = nativeSetTimeout(
    ((...args: never[]) => {
      pendingTimeouts.delete(id);
      return (handler as unknown as (...a: never[]) => unknown)(...args);
    }) as never,
    ms,
    ...rest,
  );
  pendingTimeouts.set(id, scheduledBy());
  return id;
}) as typeof globalThis.setTimeout;

globalThis.clearTimeout = ((id: never) => {
  pendingTimeouts.delete(id);
  return nativeClearTimeout(id);
}) as typeof globalThis.clearTimeout;

globalThis.setInterval = ((handler: never, ms: never, ...rest: never[]) => {
  // Intervals repeat, so there is no "it fired, drop it" hook — an interval is
  // pending until somebody clears it. That is exactly the shadow-root watchdog
  // case, and exactly what we want to catch.
  const id = nativeSetInterval(handler, ms, ...rest);
  pendingIntervals.set(id, scheduledBy());
  return id;
}) as typeof globalThis.setInterval;

globalThis.clearInterval = ((id: never) => {
  pendingIntervals.delete(id);
  return nativeClearInterval(id);
}) as typeof globalThis.clearInterval;

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  const id = nativeRequestAnimationFrame((time) => {
    pendingFrames.delete(id);
    return callback(time);
  });
  pendingFrames.set(id, scheduledBy());
  return id;
}) as typeof globalThis.requestAnimationFrame;

globalThis.cancelAnimationFrame = ((id: number) => {
  pendingFrames.delete(id);
  return nativeCancelAnimationFrame(id);
}) as typeof globalThis.cancelAnimationFrame;

/**
 * Only AG Grid's own handles are counted. React, jsdom's rAF pump and
 * Testing Library's `waitFor` all schedule timers too, and a leak assertion
 * that counted those would be measuring the test runner rather than the thing
 * under test.
 */
function agGridHandles(): {
  timeouts: number;
  intervals: number;
  frames: number;
} {
  const owned = (stacks: Iterable<string>) =>
    [...stacks].filter((stack) => AG_GRID_OWNED.test(stack)).length;
  return {
    timeouts: owned(pendingTimeouts.values()),
    intervals: owned(pendingIntervals.values()),
    frames: owned(pendingFrames.values()),
  };
}

function totalAgGridHandles(): number {
  const { timeouts, intervals, frames } = agGridHandles();
  return timeouts + intervals + frames;
}

/** A human-readable dump of what is still queued, for a failure message. */
function describeAgGridHandles(): string {
  const lines: string[] = [];
  const add = (kind: string, stacks: Iterable<string>) => {
    for (const stack of stacks) {
      if (!AG_GRID_OWNED.test(stack)) continue;
      const frame = stack
        .split("\n")
        .slice(1)
        .find((line) => AG_GRID_OWNED.test(line));
      lines.push(`${kind}: ${frame?.trim() ?? "?"}`);
    }
  };
  add("timeout", pendingTimeouts.values());
  add("interval", pendingIntervals.values());
  add("frame", pendingFrames.values());
  return lines.join("\n");
}

/**
 * Let everything AG Grid already queued actually run, while the document it
 * expects is still standing. Polls rather than sleeping a fixed span because
 * the delays are not uniform — `ScrollVisibleService.refresh` re-arms itself
 * at 500ms and the aria announcer is debounced — and a fixed sleep would
 * either be needlessly slow or quietly insufficient.
 *
 * Returns the residue so a caller can assert on it.
 *
 * The deadline is a generous ceiling, not an expected duration: the loop
 * returns the moment nothing is queued, so raising it costs a passing run
 * nothing and only buys headroom on a loaded machine. It still has to sit well
 * under the shadow-root watchdog's 60s lifetime, or a grid that was never
 * destroyed could satisfy this by outlasting the watchdog instead of by being
 * cleaned up — which would make the assertion vacuous in exactly the case it
 * exists to catch.
 */
async function quiesce(deadlineMs = 10_000): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (totalAgGridHandles() === 0) return 0;
    await act(async () => {
      await new Promise((resolve) => nativeSetTimeout(resolve, 25));
    });
  }
  return totalAgGridHandles();
}

const dataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "name", header: "Name", wrap: false, widthPx: 160 },
  ],
  rows: [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ],
};

// S2 ("wrap-auto-height") shape: some columns carry `wrap: true`, the rest
// `wrap: false`. Both kinds must be present in one dataset so a single mount
// proves the flags are gated on `wrap` rather than applied unconditionally.
const wrapDataset = {
  columns: [
    { id: "plain", header: "Plain", wrap: false, widthPx: 140 },
    { id: "wrapped", header: "Wrapped", wrap: true, widthPx: 220 },
  ],
  rows: [
    { id: "1", plain: "short", wrapped: "a much longer sentence that wraps" },
  ],
};

// S2 ("wrap-auto-height") shape again, for the other flag the scenario sets:
// `pinned_left: 1`. Both kinds present in one dataset for the same reason the
// wrap fixture has both — so a single mount proves the colDef is gated on
// `column.pinned` rather than applied to everything.
const pinnedDataset = {
  columns: [
    {
      id: "sticky",
      header: "Sticky",
      wrap: false,
      widthPx: 140,
      pinned: "left",
    },
    { id: "scrolling", header: "Scrolling", wrap: false, widthPx: 140 },
  ],
  rows: [{ id: "1", sticky: "stays", scrolling: "moves" }],
};

const statusDataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "status", header: "Status", wrap: false, widthPx: 160 },
  ],
  rows: [
    { id: "1", status: "running" },
    { id: "2", status: "stopped" },
    { id: "3", status: "running" },
    { id: "4", status: "idle" },
  ],
};

function filterPlan(
  mode: "filter-metadata" | "filter-text",
  filters: BenchInteractionPlan["filters"],
): BenchInteractionPlan {
  return {
    focusedRowId: null,
    filters,
    mode,
    probeColumnId: Object.keys(filters)[0] ?? "",
    resultRowCount: 0,
    rows: [],
    rowGroups: [],
    selectedRowId: null,
    sort: [],
  };
}

describe("AgGridAdapter", () => {
  // Unmount, then drain, then PROVE it worked. Both halves of the teardown are
  // load-bearing — see the note at the top of this file for the measurement
  // showing what each one retires — and the assertion is what keeps them
  // honest. Asserting here rather than in a single dedicated test means every
  // test in the file is covered, including whichever one runs last, which is
  // the one whose leak escapes into the rest of the run.
  afterEach(async () => {
    cleanup();
    const leaked = await quiesce();
    expect(
      leaked,
      `AG Grid work still scheduled after this test:\n${describeAgGridHandles()}`,
    ).toBe(0);
  }, 30_000);

  test("unmounting runs AG Grid's own teardown and leaves nothing scheduled", async () => {
    // The regression guard for the timer leak. Every other test in this file
    // depends on the `afterEach` above doing its job, and "the tests passed"
    // cannot tell you whether it did: the run that failed the `test` gate in
    // CI passed all 132 of its tests and still reported an error.
    let apply: ApplyBenchUpdates | null = null;
    const { container, unmount } = render(
      <AgGridAdapter
        dataset={dataset as never}
        runKey={0}
        onUpdateApiReady={(next) => {
          apply = next;
        }}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".ag-root-wrapper")).not.toBeNull();
    });
    await waitFor(() => {
      expect(apply).not.toBeNull();
    });

    // The positive half. Without this, the assertion below could pass against
    // a grid that never scheduled anything — a vacuous zero.
    expect(totalAgGridHandles()).toBeGreaterThan(0);

    unmount();

    // AG Grid's own teardown ran, not just React's. `onUpdateApiReady` hands
    // the bench a closure over the live `GridApi`; once `api.destroy()` has
    // run, a call through it is refused rather than quietly mutating a dead
    // grid. This build does not bundle the message bodies, so warning #26
    // arrives as an id plus a link — but the link is query-encoded with the
    // refused call and the reason, which is the part worth asserting:
    // `fnName=applyTransaction` (the call the bench's update path makes) and
    // `grid-pre-destroyed` (why it was refused). Warning #26 is "Grid API
    // function `...()` cannot be called as the grid has been destroyed."
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let warned = "";
    try {
      (apply as unknown as ApplyBenchUpdates)([
        { id: "1", name: "Changed" } as never,
      ]);
      warned = warn.mock.calls.map((args) => args.join(" ")).join("\n");
    } finally {
      warn.mockRestore();
    }
    expect(warned).toContain("fnName=applyTransaction");
    expect(warned).toContain("grid-pre-destroyed");

    // ...and nothing it queued is still waiting to fire at a document that is
    // about to be torn down.
    const leaked = await quiesce();
    expect(
      leaked,
      `AG Grid work still scheduled after unmount:\n${describeAgGridHandles()}`,
    ).toBe(0);
  }, 30_000);

  test("mounts and renders AG Grid public selectors", async () => {
    const { container } = render(
      <AgGridAdapter dataset={dataset as never} runKey={0} />,
    );

    // A smoke test that the grid mounts at all. The harness's own selectors
    // (.ag-grid-viewport / .ag-row / .ag-cell and the row-id/index attributes)
    // are held against this same real adapter in
    // comparator-dom-contract.test.tsx, which is what catches a library bump
    // moving them.
    await waitFor(() => {
      expect(container.querySelector(".ag-root-wrapper")).not.toBeNull();
    });
  });

  test("carries the wrap colDef onto the right cells, and only those", async () => {
    // READ THIS BEFORE TRUSTING THIS TEST. Everything asserted here is a
    // *class or attribute* that AG Grid toggles straight off the colDef —
    // `CellCtrl.applyStaticCssClasses` reads `column.isAutoHeight()` and
    // `setWrapText` reads `colDef.wrapText`. jsdom has no layout engine, so it
    // cannot tell whether any of it changed a pixel: `getBoundingClientRect()`
    // returns zeros and `scrollHeight` is always 0. This test passed unchanged
    // while AG Grid was laying every wrapped line out at 39px of leading and
    // painting every wrapped row at the fixed 48px `rowHeight`.
    //
    // What it IS good for: catching a colDef that stopped being emitted, or
    // being emitted for the wrong columns, cheaply and in the unit layer.
    // The pixels are proved in `apps/bench/tests/ag-grid-wrap-auto-height.spec.ts`,
    // which runs in real Chromium and fails if any of the three colDef fields
    // below is dropped.
    //
    // AG Grid needs all three and they are independent: `wrapText` toggles
    // `.ag-cell-wrap-text` (white-space: normal, overriding the base
    // `.ag-cell { white-space: nowrap }`); `autoHeight` toggles
    // `.ag-cell-auto-height` and enrolls the cell in row-height measurement;
    // and `cellStyle` releases the line-height from the row height, which AG
    // Grid's theme otherwise uses as the leading for every wrapped line.
    const { container } = render(
      <AgGridAdapter dataset={wrapDataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('.ag-cell[col-id="wrapped"]'),
      ).not.toBeNull();
    });

    const wrapped = container.querySelector<HTMLElement>(
      '.ag-cell[col-id="wrapped"]',
    );
    expect(wrapped?.classList.contains("ag-cell-wrap-text")).toBe(true);
    expect(wrapped?.classList.contains("ag-cell-auto-height")).toBe(true);
    // `cellStyle` lands as an inline style, which is a DOM fact rather than a
    // layout one, so jsdom can see it — it just cannot see what it does.
    expect(wrapped?.style.lineHeight).toBe("1.5");

    // The negative half is the load-bearing one: setting the flags
    // unconditionally would pass the assertions above while silently changing
    // every `wrapped_columns: 0` scenario (S1 etc.) out from under its
    // baseline.
    const plain = container.querySelector<HTMLElement>(
      '.ag-cell[col-id="plain"]',
    );
    expect(plain).not.toBeNull();
    expect(plain?.classList.contains("ag-cell-wrap-text")).toBe(false);
    expect(plain?.classList.contains("ag-cell-auto-height")).toBe(false);
    expect(plain?.style.lineHeight).toBe("");
  });

  test("puts a pinned column in the pinned-left container, and only that one", async () => {
    // Same caveat as the wrap test above: this is a DOM fact, not a layout one.
    // AG Grid renders pinned cells into a separate per-row container, so jsdom
    // can see WHICH container a cell landed in — but not that the container
    // stays put while the centre viewport scrolls. That is proved in
    // `apps/bench/tests/comparator-pinned-columns.spec.ts`.
    //
    // The class name is version-specific: AG Grid 36 calls this
    // `ag-grid-pinned-left-cells`, where 33 called it
    // `ag-pinned-left-cols-container`. A future bump that renames it again
    // SHOULD turn this red — a silently renamed container is exactly how the
    // pinned zone would stop being rendered without anyone noticing.
    const { container } = render(
      <AgGridAdapter dataset={pinnedDataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('.ag-cell[col-id="sticky"]'),
      ).not.toBeNull();
    });

    expect(
      container.querySelector(
        '.ag-grid-pinned-left-cells .ag-cell[col-id="sticky"]',
      ),
    ).not.toBeNull();

    // The negative half, and the one that matters: pinning every column would
    // satisfy the assertion above while silently changing every scenario with
    // `pinned_left: 0` (S1, S4, S5, S6) out from under its baseline.
    expect(
      container.querySelector(
        '.ag-grid-pinned-left-cells .ag-cell[col-id="scrolling"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('.ag-cell[col-id="scrolling"]'),
    ).not.toBeNull();
  });

  test("pins nothing when the scenario pins nothing", async () => {
    // The whole-dataset negative arm. `dataset` carries no `pinned` at all,
    // which is every scenario except S2, S3 and S7.
    const { container } = render(
      <AgGridAdapter dataset={dataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(container.querySelector('.ag-cell[col-id="name"]')).not.toBeNull();
    });

    expect(
      container.querySelector(".ag-grid-pinned-left-cells .ag-cell"),
    ).toBeNull();
  });

  test("publishes the post-filter row count, not the full dataset size", async () => {
    // Mirror the bench: mount first, let the grid become ready, THEN apply the
    // interaction plan. (The flushSync timing in the adapter is what makes the
    // count land inside the bench's settle window in Chromium; this jsdom test
    // guards the onFilterChanged wiring and that the count is published.)
    const { container, rerender } = render(
      <AgGridAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".ag-root-wrapper")).not.toBeNull();
    });

    rerender(
      <AgGridAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={filterPlan("filter-metadata", {
          status: { operator: "contains", value: "running" },
        })}
      />,
    );

    // status === "running" matches 2 of 4 rows. Filtering is a pure
    // client-side row-model operation in AG Grid (no layout required), so the
    // displayed-row count must reflect the filter even in jsdom.
    await waitFor(() => {
      const section = container.querySelector(
        '[data-benchmark-adapter="ag-grid"]',
      );
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("2");
    });
  });
});
