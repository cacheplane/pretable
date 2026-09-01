// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { resetDevWarnings } from "../dev-warn";
import { PretableSurface } from "../pretable-surface";

/*
 * THE EXTERNAL-PROCESSING CONFIGURATION, which is this suite's blind spot
 * elsewhere. `invalid-rows-rejected.test.tsx` renders the plain local shape,
 * where `resolveAriaRowCount` returns early off the model
 * (`data-scope.ts:43-45`) and every count on screen is honest by construction.
 * Only `processing: { filter: "external", sort: "external" }` reaches the
 * branch that publishes `resultMeta.total` — and therefore the branch a
 * rejected `rows` write can make lie.
 */
type Holding = { id: string; sector: string; qty: number };

const helper = createColumnHelper<Holding>();

const COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number" }),
] as const;

const getRowId = (row: Holding) => row.id;

function page(prefix: string, count: number): readonly Holding[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    sector: index % 2 === 0 ? "Tech" : "Energy",
    qty: index,
  }));
}

/**
 * Three good rows, replaced by SEVEN carrying a duplicate id. The two counts
 * differ and differ in the direction that inflates, which is what makes the
 * skew visible: an invalid array of the same length would leave
 * `aria-rowcount` accidentally right and every assertion here vacuous.
 */
const ROWS = page("h", 3);

const REJECTED_SEVEN: readonly Holding[] = [
  ...page("b", 6),
  { id: "b0", sector: "Tech", qty: 99 },
];

const RECOVERY = page("r", 2);

type Meta = {
  readonly total?: { readonly kind: "exact"; readonly count: number };
  readonly window?: { readonly start: number; readonly hasMore?: boolean };
  readonly datasetKey?: string;
};

function element(
  rows: readonly Holding[],
  options: {
    readonly resultMeta?: Meta;
    readonly onTelemetryChange?: (telemetry: unknown) => void;
    readonly viewportHeight?: number;
    /**
     * Overridden only by the `windowed`-split test, which needs a row-model
     * REVISION bump to make the engine re-run its eviction reconciliation.
     */
    readonly query?: object;
  } = {},
) {
  return (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={COLUMNS}
      getRowId={getRowId}
      onQueryChange={() => undefined}
      onTelemetryChange={options.onTelemetryChange as never}
      overscan={0}
      processing={{ filter: "external", sort: "external" }}
      query={
        (options.query ?? { filters: [], sort: [], rowGroups: [] }) as never
      }
      resultMeta={options.resultMeta as never}
      rows={rows}
      viewportHeight={options.viewportHeight ?? 400}
    />
  );
}

/**
 * `data-pretable-row` is an empty MARKER attribute; the id lives on
 * `data-pretable-row-id`. Reading the marker would yield "" for every row.
 */
function paintedRowIds(container: HTMLElement): readonly (string | null)[] {
  return [...container.querySelectorAll("[data-pretable-row-id]")].map((row) =>
    row.getAttribute("data-pretable-row-id"),
  );
}

function paintedRowIndexes(container: HTMLElement): readonly (string | null)[] {
  return [...container.querySelectorAll("[data-pretable-row-id]")].map((row) =>
    row.getAttribute("aria-rowindex"),
  );
}

function bodyCell(
  container: HTMLElement,
  rowId: string,
  columnId: string,
): HTMLElement {
  const cell = container.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
  );
  if (!cell) throw new Error(`no cell ${columnId}@${rowId}`);
  return cell as HTMLElement;
}

/** Row ids whose `sector` cell is painting selected, in DOM order. */
function selectedRowIds(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-pretable-row-id]")]
    .filter(
      (row) =>
        row
          .querySelector('[data-pretable-column-id="sector"]')
          ?.getAttribute("data-pretable-selected") === "true",
    )
    .map((row) => row.getAttribute("data-pretable-row-id") ?? "");
}

function ariaRowCount(container: HTMLElement): number {
  const grid = container.querySelector('[role="grid"]');
  return Number(grid?.getAttribute("aria-rowcount"));
}

/**
 * What `aria-rowcount` MUST agree with: the header row plus the rows the grid
 * is actually presenting. Derived from the DOM rather than written as a
 * literal, so a test cannot pass by matching a number nobody painted.
 */
function honestRowCount(container: HTMLElement): number {
  return paintedRowIds(container).length + 1;
}

const TOTAL_BELOW_LOADED = /claims fewer matching records/;
const ROWS_REJECTED = /A rows update was rejected as invalid/;

function warnedTotalBelowLoaded(spy: ReturnType<typeof vi.spyOn>): boolean {
  return (spy.mock.calls as readonly (readonly unknown[])[]).some((call) =>
    TOTAL_BELOW_LOADED.test(String(call[0])),
  );
}

/**
 * Wait until the rejection has actually been PROCESSED, then let the pre-paint
 * re-render it schedules flush.
 *
 * A bare `await act(async () => {})` is not a reliable settle point here — a
 * controlled `query` reconciles through a promise chain — and it produced
 * intermittent failures at load average 33 on ten cores. Anchoring on the
 * `rows-rejected` warning is definite and cannot be reached without the layout
 * effect having run and the write having been refused, so it is a stronger
 * precondition than a timer, not a looser one.
 */
async function settleRejection(spy: ReturnType<typeof vi.spyOn>) {
  await waitFor(() =>
    expect(
      (spy.mock.calls as readonly (readonly unknown[])[]).some((call) =>
        ROWS_REJECTED.test(String(call[0])),
      ),
    ).toBe(true),
  );
  await act(async () => {});
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // `warnOnce` keeps emitted keys in MODULE state, so without this the second
  // test to provoke the same fault would see no warning at all — and the
  // silence assertions below would pass for the wrong reason.
  resetDevWarnings();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // `cleanup()` FIRST: unmount runs with the spy still installed.
  cleanup();
  warnSpy.mockRestore();
});

describe("a rejected rows update leaves the grid's counts honest", () => {
  test("aria-rowcount agrees with what is painted after a rejected update", async () => {
    const view = render(element(ROWS));
    await waitFor(() => expect(paintedRowIds(view.container)).toHaveLength(3));
    expect(ariaRowCount(view.container)).toBe(honestRowCount(view.container));

    view.rerender(element(REJECTED_SEVEN));
    /*
     * The rejection is recorded from a LAYOUT effect, so React re-renders
     * before paint. This waits for that; a bare synchronous read here would be
     * one render stale and would pass while testing nothing.
     */
    await settleRejection(warnSpy);

    // Disproving: the kept rows are the OLD ones, and there are three of them
    // against a seven-element prop. Before this fix the attribute read 8.
    expect(paintedRowIds(view.container)).toEqual(["h0", "h1", "h2"]);
    expect(REJECTED_SEVEN).toHaveLength(7);
    expect(ariaRowCount(view.container)).toBe(honestRowCount(view.container));
    expect(ariaRowCount(view.container)).toBe(4);
  });

  test("a later valid update restores agreement", async () => {
    const view = render(element(ROWS));
    await waitFor(() => expect(paintedRowIds(view.container)).toHaveLength(3));

    view.rerender(element(REJECTED_SEVEN));
    await settleRejection(warnSpy);
    expect(ariaRowCount(view.container)).toBe(4);

    // TWO rows, not three and not seven: a value only a LANDED update
    // produces, so a flag that latched on would be caught here.
    view.rerender(element(RECOVERY));
    await waitFor(() =>
      expect(paintedRowIds(view.container)).toEqual(["r0", "r1"]),
    );
    expect(ariaRowCount(view.container)).toBe(honestRowCount(view.container));
    expect(ariaRowCount(view.container)).toBe(3);
  });

  /*
   * THE ORIGINAL DESIGN, PINNED. `loadedRowCount` reads the `rows` PROP in
   * rows mode on purpose: the row model ingests in a layout effect, so reading
   * the model during this render compares a new query's total against the
   * PREVIOUS query's row count for one render. Every narrowing query tripped
   * the contiguous-window check that way, and `warnOnce` then latched and
   * disarmed the check for the rest of the session.
   *
   * Without this test the skew above could be "fixed" by reading the model
   * unconditionally — which is exactly the bug the comment at
   * `pretable-surface.tsx` describes.
   */
  test("a narrowing valid update reports the new count in the same render, and does not trip the contiguous-window check", async () => {
    const view = render(
      element(page("w", 30), {
        resultMeta: { total: { kind: "exact", count: 1_000 } },
      }),
    );
    /*
     * Waiting on the ATTRIBUTE, not on a painted-row count: the body is
     * virtualized, so a 400px viewport paints nine of these thirty rows. The
     * loaded count this test is about is the one `aria-rowcount` is derived
     * from, not the one the DOM happens to hold.
     */
    await waitFor(() => expect(ariaRowCount(view.container)).toBe(1_001));

    // The narrowing query: 30 rows of 1,000 become 3 rows of 3, both halves
    // committed together. Reading the model here would see 30 loaded against
    // a claimed total of 3.
    view.rerender(
      element(page("n", 3), {
        resultMeta: { total: { kind: "exact", count: 3 } },
      }),
    );
    /*
     * Waiting for the rows to LAND rather than a bare `act`: a controlled
     * `query` reconciles through a promise chain, so the settle point is not
     * always one microtask away — measured as an intermittent failure at load
     * average 33 on ten cores. Waiting only gives the check MORE chances to
     * warn, so the silence assertion below is strictly stronger for it.
     */
    await waitFor(() =>
      expect(paintedRowIds(view.container)).toEqual(["n0", "n1", "n2"]),
    );

    expect(warnedTotalBelowLoaded(warnSpy)).toBe(false);
    expect(ariaRowCount(view.container)).toBe(4);
  });

  test("the contiguous-window check still fires when the total really is below the loaded window", async () => {
    /*
     * The POSITIVE TWIN of the silence above. Without it, a check that had
     * been deleted outright would satisfy the previous test.
     */
    const view = render(
      element(page("w", 30), {
        resultMeta: { total: { kind: "exact", count: 1_000 } },
      }),
    );
    await waitFor(() => expect(ariaRowCount(view.container)).toBe(1_001));

    // Three rows, but the consumer claims only ONE record matches: the loaded
    // window cannot be a contiguous window of a one-record result.
    view.rerender(
      element(page("n", 3), {
        resultMeta: { total: { kind: "exact", count: 1 } },
      }),
    );
    await waitFor(() => expect(warnedTotalBelowLoaded(warnSpy)).toBe(true));

    expect(ariaRowCount(view.container)).toBe(4);
  });

  /*
   * THE RECOVERY RENDER IS NOT THE REJECTED ONE, and only an identity
   * comparison can tell them apart. A bare "the last write was rejected" bit
   * is still set while a VALID array is arriving — the layout effect that
   * would clear it has not run yet — so the surface would count the model for
   * that render and compare the new query's total against the old query's row
   * count. Measured against that variant, this fixture produced a spurious
   * `result-meta-total-below-loaded` warning, which `warnOnce` then latched,
   * disarming the check for the rest of the session.
   */
  test("a narrowing update that recovers from a rejection does not trip the contiguous-window check", async () => {
    const view = render(
      element(ROWS, { resultMeta: { total: { kind: "exact", count: 3 } } }),
    );
    await waitFor(() => expect(paintedRowIds(view.container)).toHaveLength(3));

    view.rerender(
      element(REJECTED_SEVEN, {
        resultMeta: { total: { kind: "exact", count: 3 } },
      }),
    );
    await settleRejection(warnSpy);
    /*
     * Cleared between the two steps because `warnOnce` latches per key: a
     * single count across both would be capped at one and could not say WHICH
     * step produced it. The rejection step's own warning is pre-existing and
     * unrelated (it fires identically on `origin/main`).
     */
    resetDevWarnings();
    warnSpy.mockClear();

    // The narrowing recovery: two rows of a two-record result.
    view.rerender(
      element(RECOVERY, { resultMeta: { total: { kind: "exact", count: 2 } } }),
    );
    // Wait for the landing, for the reason given in the test above.
    await waitFor(() =>
      expect(paintedRowIds(view.container)).toEqual(["r0", "r1"]),
    );

    expect(warnedTotalBelowLoaded(warnSpy)).toBe(false);
    expect(ariaRowCount(view.container)).toBe(3);
  });

  /*
   * THE FIXTURE STARTS AT A NON-ZERO WINDOW, and that is the whole point.
   * From `window.start: 0` the kept rows sit at dataset positions 1..3, which
   * is also what a grid that has DROPPED its window announces — so a fixture
   * anchored there cannot tell the truth from the fallback, and every wrong
   * answer passes. See "choose data that can disprove".
   *
   * From `window.start: 100` the three candidate answers are three different
   * numbers:
   *
   *   live window (base)   202,203,204   the incoming window's positions
   *   no window            2,  3,  4     the head of the dataset
   *   retained window      102,103,104   where these rows actually are
   */
  test("a rejected pager swap keeps the kept rows at their own dataset positions", async () => {
    const view = render(
      element(ROWS, {
        resultMeta: {
          total: { kind: "exact", count: 500 },
          window: { start: 100, hasMore: true },
          datasetKey: "k1",
        },
      }),
    );
    await waitFor(() => expect(paintedRowIds(view.container)).toHaveLength(3));
    expect(paintedRowIndexes(view.container)).toEqual(["102", "103", "104"]);

    // The next page arrives: the offset moves to 200 and the rows are refused.
    view.rerender(
      element(REJECTED_SEVEN, {
        resultMeta: {
          total: { kind: "exact", count: 500 },
          window: { start: 200, hasMore: true },
          datasetKey: "k1",
        },
      }),
    );
    await settleRejection(warnSpy);

    // The SAME rows are on screen, so they must still be announced where they
    // really are — not at 202,203,204 and not at 2,3,4.
    expect(paintedRowIds(view.container)).toEqual(["h0", "h1", "h2"]);
    expect(paintedRowIndexes(view.container)).toEqual(["102", "103", "104"]);

    // Recovery: a valid page 200 takes the positions it claims.
    view.rerender(
      element(page("p", 3), {
        resultMeta: {
          total: { kind: "exact", count: 500 },
          window: { start: 200, hasMore: true },
          datasetKey: "k1",
        },
      }),
    );
    await waitFor(() =>
      expect(paintedRowIds(view.container)).toEqual(["p0", "p1", "p2"]),
    );
    expect(paintedRowIndexes(view.container)).toEqual(["202", "203", "204"]);
  });

  /*
   * THE FOURTH CONSEQUENCE. `windowSpacers` is not only an announcement: it
   * is the grid's scroll EXTENT. While a rejection stands the extent survives
   * on the last plan, so nothing shows until something forces a replan — a
   * viewport resize is enough. Dropping the window collapsed this fixture's
   * 44,000px extent to 1,320px there — its 30 loaded rows at 44px, with the
   * 500-row leading and 470-row trailing spacers gone — which in a browser
   * clamps `scrollTop` and teleports a reader deep in the dataset back to the
   * top.
   */
  test("a rejected rows update does not collapse the scroll extent on the next replan", async () => {
    const telemetry: unknown[] = [];
    const onTelemetryChange = (next: unknown) => telemetry.push(next);
    const extent = () =>
      (telemetry[telemetry.length - 1] as { totalHeight: number }).totalHeight;

    const windowed = {
      total: { kind: "exact" as const, count: 1_000 },
      window: { start: 500, hasMore: true },
    };
    const view = render(
      element(page("w", 30), {
        onTelemetryChange,
        viewportHeight: 168,
        resultMeta: windowed,
      }),
    );
    await waitFor(() => expect(telemetry.length).toBeGreaterThan(0));
    const before = extent();
    expect(before).toBe(44_000);

    view.rerender(
      element(REJECTED_SEVEN, {
        onTelemetryChange,
        viewportHeight: 168,
        resultMeta: { ...windowed, window: { start: 530, hasMore: true } },
      }),
    );
    await settleRejection(warnSpy);
    // Unchanged so far on every variant: nothing has replanned yet, so this
    // assertion alone would pass while the bug is fully present.
    expect(extent()).toBe(44_000);

    // FORCE THE REPLAN. This is the step that made the collapse observable.
    view.rerender(
      element(REJECTED_SEVEN, {
        onTelemetryChange,
        viewportHeight: 200,
        resultMeta: { ...windowed, window: { start: 530, hasMore: true } },
      }),
    );
    // A plain flush, not a second wait: the warning is already in the spy from
    // the rejection above (`warnOnce` latches), so `settleRejection` would
    // resolve on its first check and add nothing.
    await act(async () => {});
    expect(extent()).toBe(44_000);
  });

  /*
   * The spacers also carry the dataset span the engine uses to tell an evicted
   * row from a deleted one (`getWindowing` in `pretable-model.ts`, the seam
   * `eviction-gate-blip.test.tsx` exists to protect). That file's own comment
   * names the hazard this change is one instance of: "if a consumer ever lands
   * rows in a commit whose `resultMeta.window.start` has not caught up, this
   * pairing is a chimera and a genuinely evicted row can be judged deleted".
   *
   * HONESTY NOTE ON WHAT THIS PINS. The selection half is a REGRESSION GUARD,
   * not a falsifiable assertion: no production mutation tried flips it —
   * neither reading the window live, nor dropping the spacers entirely, nor
   * dropping `datasetKey` from them. That is structural, not luck. A rejected
   * write changes nothing in the row model, so nothing is ever evicted, and
   * the eviction seam is not reachable this way at all.
   *
   * What IS falsifiable is the second assertion: the span the engine is handed
   * comes from the same `windowSpacers.leadingRows` these rows are announced
   * at, so pinning where the SELECTED rows say they sit pins the pairing the
   * seam depends on. Reading the window live moves it to 202,203,204;
   * dropping the window moves it to 2,3,4.
   */
  test("a rejected rows update leaves the selection alone, at its own dataset positions", async () => {
    const windowed = {
      total: { kind: "exact" as const, count: 500 },
      window: { start: 100, hasMore: true },
      datasetKey: "k1",
    };
    const view = render(element(ROWS, { resultMeta: windowed }));
    await waitFor(() => expect(paintedRowIds(view.container)).toHaveLength(3));

    fireEvent.click(bodyCell(view.container, "h0", "sector"));
    fireEvent.click(bodyCell(view.container, "h2", "sector"), {
      shiftKey: true,
    });
    // The positive twin: without this the assertion below is satisfied by a
    // fixture that never selected anything.
    expect(selectedRowIds(view.container)).toEqual(["h0", "h1", "h2"]);

    view.rerender(
      element(REJECTED_SEVEN, {
        resultMeta: { ...windowed, window: { start: 200, hasMore: true } },
      }),
    );
    await settleRejection(warnSpy);

    expect(selectedRowIds(view.container)).toEqual(["h0", "h1", "h2"]);
    expect(paintedRowIndexes(view.container)).toEqual(["102", "103", "104"]);
  });

  /*
   * THE `windowed` / `declaredWindowStart` SPLIT.
   *
   * `windowStart` above resolves to the window that describes the loaded rows.
   * `setWindowState`'s `windowed` flag deliberately does NOT: it reads the
   * consumer's own `resultMeta.window`, because it answers "does this consumer
   * serve a window at all", which no gate and no rejection can change.
   * Collapsing that into "could this render resolve one" is what once
   * destroyed a selection permanently — see `WindowState` in
   * `pretable-model.ts`, and `eviction-gate-blip.test.tsx`.
   *
   * The split is only reachable when the two disagree, which needs a rejected
   * update that also REMOVES `resultMeta.window`, plus a `query` change to bump
   * the row-model revision so the engine actually re-runs its eviction
   * reconciliation (a rejected `setRows` alone does not move the revision).
   *
   * Asserted DIFFERENTIALLY. Whether removing the window should drop an
   * evicted selection is a pre-existing question this change does not touch;
   * what it must guarantee is that a REJECTION does not change the answer. So
   * the rejected leg is compared against the identical valid one, and the
   * keep-window leg is the positive twin proving the fixture can retain at all.
   */
  test("a rejected rows update does not change whether the engine is told the consumer serves a window", async () => {
    const REVISION_BUMP = {
      filters: [],
      sort: [{ columnId: "sector", direction: "asc" }],
      rowGroups: [],
    };
    const windowed = (start: number) => ({
      total: { kind: "exact" as const, count: 20 },
      window: { start, hasMore: true },
      datasetKey: "k1",
    });
    const unwindowed = {
      total: { kind: "exact" as const, count: 20 },
      datasetKey: "k1",
    };
    const ALL = page("s", 20);
    const FIRST = ALL.slice(0, 10);
    const SECOND = ALL.slice(10, 20);
    // Ten rows so the shapes match `SECOND`, with a duplicate id to refuse it.
    const REFUSED: readonly Holding[] = [
      ...ALL.slice(10, 19),
      { id: "s10", sector: "Tech", qty: 99 },
    ];

    async function leg(third: readonly Holding[], keepWindow: boolean) {
      const view = render(
        element(FIRST, { resultMeta: windowed(0), viewportHeight: 800 }),
      );
      await waitFor(() =>
        expect(paintedRowIds(view.container)).toHaveLength(10),
      );
      fireEvent.click(bodyCell(view.container, "s1", "sector"));
      fireEvent.click(bodyCell(view.container, "s8", "sector"), {
        shiftKey: true,
      });
      const selected = selectedRowIds(view.container);

      // Slide the window forward: s1..s8 are evicted, held only as spans.
      view.rerender(
        element(SECOND, { resultMeta: windowed(10), viewportHeight: 800 }),
      );
      await waitFor(() => expect(paintedRowIds(view.container)[0]).toBe("s10"));

      // The step under test.
      view.rerender(
        element(third, {
          resultMeta: keepWindow ? windowed(10) : unwindowed,
          viewportHeight: 800,
          query: REVISION_BUMP,
        }),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // Slide back to where the selection lived and see what came home.
      view.rerender(
        element(FIRST, { resultMeta: windowed(0), viewportHeight: 800 }),
      );
      /*
       * Back to the top first: the window slid under a scrolled viewport, so
       * without this the body paints from partway down the page and the
       * selection read below sees only part of the range it is asserting on.
       */
      fireEvent.scroll(view.getByRole("grid", { name: "holdings" }), {
        target: { scrollTop: 0 },
      });
      await waitFor(() =>
        expect(paintedRowIds(view.container)).toContain("s1"),
      );
      const after = selectedRowIds(view.container);
      cleanup();
      resetDevWarnings();
      return { selected, after };
    }

    const SELECTED = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];

    // POSITIVE TWIN: with the window still published, the span survives the
    // round trip. Without this every assertion below is satisfied by a fixture
    // that never retained anything.
    const kept = await leg(SECOND, true);
    expect(kept.selected).toEqual(SELECTED);
    expect(kept.after).toEqual(SELECTED);

    // CONTROL: a VALID update that removes the window is local mode, so the
    // rows the grid no longer holds read as deleted.
    const control = await leg(SECOND, false);
    expect(control.selected).toEqual(SELECTED);
    expect(control.after).toEqual([]);

    // THE ASSERTION: the same sequence with a REFUSED array must reach the
    // same verdict. Reading `windowed` off the resolved window instead of the
    // declared one makes this leg return the full selection.
    const refused = await leg(REFUSED, false);
    expect(refused.selected).toEqual(SELECTED);
    expect(refused.after).toEqual(control.after);
  });

  /*
   * `telemetry.windowGap` is the signal a windowing consumer's fetch loop runs
   * on (`WindowedGrid.tsx:126-136` drives its entire loop from it). Under a
   * rejection the three designs say three different things, and the retained
   * window is the only one that keeps the loop able to recover on its own:
   *
   *   live window (base)   { after, 440 }   offset measured from the NEW
   *                                         window against the OLD rows
   *   no window            undefined        dark, with no scroll-driven way
   *                                         back once the extent collapses
   *   retained window      { after, 470 }   the true tail past the loaded rows
   */
  test("windowGap telemetry keeps describing the window the grid actually holds", async () => {
    const telemetry: unknown[] = [];
    const onTelemetryChange = (next: unknown) => telemetry.push(next);
    const gap = () =>
      (telemetry[telemetry.length - 1] as { windowGap?: unknown }).windowGap;

    const view = render(
      element(page("w", 30), {
        onTelemetryChange,
        viewportHeight: 168,
        resultMeta: {
          total: { kind: "exact", count: 1_000 },
          window: { start: 500, hasMore: true },
        },
      }),
    );
    await waitFor(() => expect(telemetry.length).toBeGreaterThan(0));

    const viewport = view.getByRole("grid", { name: "holdings" });
    // Deep into the trailing gap of the full 1,000-row scroll extent.
    fireEvent.scroll(viewport, { target: { scrollTop: 43_832 } });
    await waitFor(() =>
      expect(gap()).toEqual({ direction: "after", rowCount: 470 }),
    );

    /*
     * A rejected page-three swap. Same LENGTH as the loaded window on purpose:
     * an array of a different length makes the gap fall silent through the
     * pre-existing `plannedRowCount !== loadedRowCount` guard, which would let
     * this pass without the window ever being resolved coherently.
     */
    const rejectedWindow: readonly Holding[] = [
      ...page("x", 29),
      { id: "x0", sector: "Tech", qty: 99 },
    ];
    expect(rejectedWindow).toHaveLength(30);
    view.rerender(
      element(rejectedWindow, {
        onTelemetryChange,
        viewportHeight: 168,
        resultMeta: {
          total: { kind: "exact", count: 1_000 },
          window: { start: 530, hasMore: true },
        },
      }),
    );
    await settleRejection(warnSpy);
    fireEvent.scroll(viewport, { target: { scrollTop: 43_800 } });
    fireEvent.scroll(viewport, { target: { scrollTop: 43_832 } });

    // 470, not 440 and not undefined: 1,000 records minus the 530 the RETAINED
    // window covers.
    await waitFor(() =>
      expect(gap()).toEqual({ direction: "after", rowCount: 470 }),
    );

    // And a valid swap still moves it.
    view.rerender(
      element(page("y", 30), {
        onTelemetryChange,
        viewportHeight: 168,
        resultMeta: {
          total: { kind: "exact", count: 1_000 },
          window: { start: 530, hasMore: true },
        },
      }),
    );
    // The body is virtualized and scrolled to the bottom of the window, so
    // which `y` row paints first is a viewport detail; that they are all `y`
    // rows is the landing signal. The length guard keeps `every` from being
    // vacuously true on an empty body.
    await waitFor(() => {
      const painted = paintedRowIds(view.container);
      expect(painted.length).toBeGreaterThan(0);
      expect(painted.every((id) => id?.startsWith("y"))).toBe(true);
    });
    fireEvent.scroll(viewport, { target: { scrollTop: 43_800 } });
    fireEvent.scroll(viewport, { target: { scrollTop: 43_832 } });
    await waitFor(() =>
      expect(gap()).toEqual({ direction: "after", rowCount: 440 }),
    );
  });
});
