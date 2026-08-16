// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PretableProcessingOptions,
  PretableSelectionState,
} from "@pretable/core";
import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceFocusState } from "../surface-types";

/**
 * `PageUp` / `PageDown` — the two keys that used to resolve their own step.
 *
 * `handleSurfaceKeyDown` hand-rolled the arithmetic: it asked the LOADED
 * snapshot for the cursor's index and read `-1` as "base the step at row 0".
 * That sentinel meant two unrelated things — "the cursor is on the header or
 * absent", where row 0 is deliberate, and "`indexOf` could not resolve this
 * ref", which is exactly what an EVICTED cursor returns. So a page key pressed
 * while the cursor's row was released teleported it into the loaded window,
 * across however many rows had been let go.
 *
 * The branch now delegates to the engine's `moveFocus`, which already models
 * `page-up` / `page-down`, already receives the eviction context, and already
 * refuses a row-axis move from a cursor it cannot place. This file pins both
 * halves: the ordinary page step still steps a page, and the evicted cursor
 * holds.
 *
 * Local mode (no `resultMeta.window`) is the control throughout: with no window
 * nothing is ever retained, so every branch below reaches the same answer it
 * reached before delegation.
 */

type Row = { id: string; name: string; score: number };

function rowsOf(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    name: `name-${index}`,
    score: index,
  }));
}

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "score", header: "Score", widthPx: 120 },
];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

/**
 * Stable identity: a fresh query object every render is a controlled-query
 * CHANGE, which schedules cooperative row-model work and stalls the window
 * slide these tests are about.
 */
const QUERY = { filters: [], sort: [], rowGroups: [] };

/** Spans are fail-closed on this; a windowed grid without one gets nothing. */
const POPULATION = "page-keys";

/**
 * The row model settles a `setRows` across cooperative slices, so neither the
 * first render nor a window slide is in the DOM on the pass that requests it.
 *
 * Polled to a PREDICATE rather than slept for a fixed span. A flat `setTimeout`
 * is a load measurement, not a settle: the 200-row grids below settled in 20ms
 * when this file ran alone and did not when the whole react suite ran beside
 * them, which is a flake this file would have contributed to CI.
 */
async function settleUntil(ready: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (ready()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error("the grid never settled");
}

/** Settle until `rowId` is mounted. */
async function settleForRow(container: HTMLElement, rowId: string) {
  await settleUntil(
    () => container.querySelector(`[data-pretable-row-id="${rowId}"]`) !== null,
  );
}

/** Settle until `rowId` is GONE — a window slide that evicts it. */
async function settleWithoutRow(container: HTMLElement, rowId: string) {
  await settleUntil(
    () => container.querySelector(`[data-pretable-row-id="${rowId}"]`) === null,
  );
}

function bodyCell(
  container: HTMLElement,
  rowId: string,
  columnId: string,
): HTMLElement {
  const cell = container.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"][data-pretable-cell]`,
  );
  if (!cell) throw new Error(`no cell ${columnId}@${rowId}`);
  return cell as HTMLElement;
}

function anyRenderedCell(container: HTMLElement): HTMLElement {
  const cell = container.querySelector(
    "[data-pretable-row-id] [data-pretable-cell]",
  );
  if (!cell) throw new Error("no rendered cell");
  return cell as HTMLElement;
}

/** The row id of the one cell the grid paints as the cursor, or null. */
function focusedRowId(container: HTMLElement): string | null {
  const cells = [
    ...container.querySelectorAll<HTMLElement>(
      "[data-pretable-cell][data-pretable-focused='true']",
    ),
  ];
  if (cells.length !== 1) return null;
  return (
    cells[0]!
      .closest("[data-pretable-row-id]")
      ?.getAttribute("data-pretable-row-id") ?? null
  );
}

function rowIdOf(
  focus: PretableSurfaceFocusState<string> | undefined,
): unknown {
  return focus?.ref?.kind === "data" ? focus.ref.rowId : (focus?.ref ?? null);
}

/** Local mode: rows owned outright, no `resultMeta`, so no loaded window. */
function LocalGrid({
  count,
  viewportHeight = 300,
  onFocus,
  onSelection,
}: {
  count: number;
  viewportHeight?: number;
  onFocus?: (next: PretableSurfaceFocusState<string>) => void;
  onSelection?: (next: PretableSelectionState) => void;
}) {
  const [selection, setSelection] = React.useState<PretableSelectionState>({
    ranges: [],
    anchor: null,
  });
  return (
    <PretableSurface<Row>
      ariaLabel="Local"
      columns={columns}
      rows={rowsOf(count)}
      getRowId={(row) => row.id}
      viewportHeight={viewportHeight}
      onFocusChange={onFocus}
      state={{ selection }}
      onSelectionChange={(next) => {
        setSelection(next);
        onSelection?.(next);
      }}
    />
  );
}

const TOTAL = 60;
const LENGTH = 20;

/**
 * A windowed grid under the honesty gate: full external authority, an exact
 * population total, and `resultMeta.window.start` saying where the loaded
 * slice sits. Anything less and the engine refuses to speak in dataset
 * positions, which is the documented conditional on eviction.
 */
function WindowedGrid({
  windowStart,
  onFocus,
  onSelection,
}: {
  windowStart: number;
  onFocus?: (next: PretableSurfaceFocusState<string>) => void;
  onSelection?: (next: PretableSelectionState) => void;
}) {
  const all = React.useMemo(() => rowsOf(TOTAL), []);
  const [selection, setSelection] = React.useState<PretableSelectionState>({
    ranges: [],
    anchor: null,
  });
  return (
    <PretableSurface<Row>
      ariaLabel="Windowed"
      columns={columns}
      rows={all.slice(windowStart, windowStart + LENGTH)}
      getRowId={(row) => row.id}
      viewportHeight={300}
      processing={EXTERNAL}
      resultMeta={{
        total: { kind: "exact", count: TOTAL },
        window: {
          start: windowStart,
          hasMore: windowStart + LENGTH < TOTAL,
        },
        datasetKey: POPULATION,
      }}
      query={QUERY}
      onQueryChange={() => undefined}
      onFocusChange={onFocus}
      state={{ selection }}
      onSelectionChange={(next) => {
        setSelection(next);
        onSelection?.(next);
      }}
    />
  );
}

afterEach(cleanup);

describe("a page key steps a page", () => {
  it("steps by a constant page, twice, and back", async () => {
    // Constant-free on purpose: the step is whatever `bodyViewportHeight / 32`
    // works out to in jsdom, and hard-coding it would pin the header height
    // rather than the stepping. What is asserted instead is the SHAPE — the
    // first step is more than one row (so a page key is not an arrow), the
    // second lands exactly one more step on (so it is uniform, not a jump to
    // the end), and PageUp retraces it.
    const changes: PretableSurfaceFocusState<string>[] = [];
    const { container } = render(
      <LocalGrid count={200} onFocus={(next) => changes.push(next)} />,
    );
    await settleForRow(container, "row-0");

    const first = bodyCell(container, "row-0", "name");
    fireEvent.focus(first);
    expect(rowIdOf(changes.at(-1))).toBe("row-0");

    fireEvent.keyDown(first, { key: "PageDown" });
    const afterOne = rowIdOf(changes.at(-1));
    const step = Number(String(afterOne).slice("row-".length));
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThan(99);

    fireEvent.keyDown(anyRenderedCell(container), { key: "PageDown" });
    expect(rowIdOf(changes.at(-1))).toBe(`row-${step * 2}`);

    fireEvent.keyDown(anyRenderedCell(container), { key: "PageUp" });
    expect(rowIdOf(changes.at(-1))).toBe(`row-${step}`);
  });

  it("sizes the page from the BODY viewport, not from a constant", async () => {
    // The step is the surface's to measure and the engine's to apply, so it
    // has to be handed over on every press. Without this, a delegation that
    // simply forgot to pass it — leaving the engine on its own fallback
    // constant — passes every other test in this file: 10 rows is still more
    // than one row, still uniform, and still retraces under PageUp.
    //
    // Asserted as a DIFFERENCE, which cancels the header height out exactly.
    // The step is `floor((viewportHeight - headerHeight) / 32)`, and 940 - 300
    // is 640 = 20 * 32, so the two floors are 20 apart whatever the header
    // measures — no constant from the component is baked in here.
    async function stepFor(viewportHeight: number): Promise<number> {
      const changes: PretableSurfaceFocusState<string>[] = [];
      const { container } = render(
        <LocalGrid
          count={200}
          viewportHeight={viewportHeight}
          onFocus={(next) => changes.push(next)}
        />,
      );
      await settleForRow(container, "row-0");
      const first = bodyCell(container, "row-0", "name");
      fireEvent.focus(first);
      fireEvent.keyDown(first, { key: "PageDown" });
      return Number(String(rowIdOf(changes.at(-1))).slice("row-".length));
    }

    const small = await stepFor(300);
    const large = await stepFor(940);
    expect(large - small).toBe(20);
  });

  it("clamps at both ends without losing the cursor", () => {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const { container } = render(
      <LocalGrid count={4} onFocus={(next) => changes.push(next)} />,
    );

    const first = bodyCell(container, "row-0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "PageDown" });
    expect(rowIdOf(changes.at(-1))).toBe("row-3");

    fireEvent.keyDown(anyRenderedCell(container), { key: "PageUp" });
    expect(rowIdOf(changes.at(-1))).toBe("row-0");
  });

  it("Shift+PageDown extends a range from the anchor", async () => {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const seen: PretableSelectionState[] = [];
    const { container } = render(
      <LocalGrid
        count={200}
        onFocus={(next) => changes.push(next)}
        onSelection={(next) => seen.push(next)}
      />,
    );
    await settleForRow(container, "row-0");

    fireEvent.click(bodyCell(container, "row-0", "name"));
    fireEvent.keyDown(anyRenderedCell(container), {
      key: "PageDown",
      shiftKey: true,
    });

    const landed = String(rowIdOf(changes.at(-1)));
    expect(landed).not.toBe("row-0");
    const range = seen.at(-1)?.ranges[0];
    expect(range?.startRowId).toBe("row-0");
    expect(range?.endRowId).toBe(landed);
  });
});

describe("a page key from the header", () => {
  it("PageDown enters the grid at row 0", async () => {
    // The case the `-1` sentinel was deliberately serving, and the one most
    // likely to break when it is taken away. The header is the row above row
    // 0, so down off it — by arrow or by page — lands on the first row.
    const changes: PretableSurfaceFocusState<string>[] = [];
    const { container } = render(
      <LocalGrid count={200} onFocus={(next) => changes.push(next)} />,
    );
    await settleForRow(container, "row-0");

    const first = bodyCell(container, "row-0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "header" },
      columnId: "name",
    });

    fireEvent.keyDown(anyRenderedCell(container), { key: "PageDown" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "row-0" },
      columnId: "name",
    });
  });

  it("PageUp holds on the header", async () => {
    // The header is the top. `ArrowUp` there is already a no-op; a page key
    // that instead dropped the cursor into the body would make "page up twice"
    // mean two different things.
    const changes: PretableSurfaceFocusState<string>[] = [];
    const { container } = render(
      <LocalGrid count={200} onFocus={(next) => changes.push(next)} />,
    );
    await settleForRow(container, "row-0");

    const first = bodyCell(container, "row-0", "name");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    const atHeader = changes.length;

    fireEvent.keyDown(anyRenderedCell(container), { key: "PageUp" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "header" },
      columnId: "name",
    });
    expect(changes.length).toBe(atHeader);
  });
});

describe("a page key while the cursor's row is evicted", () => {
  /**
   * Focus a row, then slide the window past it so its element is unmounted
   * while the engine still holds its address. Returns the focus log.
   *
   * `spread` builds a selection whose END IS NOT WHERE THE CURSOR IS: click
   * `row-3`, shift-click `row-6` (so the anchor is `row-3` and the range runs
   * 3..6), then walk the cursor down to `row-8` with two plain arrows, which
   * move focus and leave the range alone.
   *
   * That gap is the whole point. With the cursor sitting ON the range's end —
   * which is where an ordinary click or shift-click leaves it — re-extending
   * `anchor → cursor` reproduces the range the grid already has, the store
   * publishes nothing, and a test asserting "the selection did not change"
   * passes whether or not the guard exists. The first version of this test did
   * exactly that: it survived the mutation it was written for.
   */
  async function evictedCursor(spread = false) {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const seen: PretableSelectionState[] = [];
    const view = render(
      <WindowedGrid
        windowStart={0}
        onFocus={(next) => changes.push(next)}
        onSelection={(next) => seen.push(next)}
      />,
    );

    fireEvent.click(bodyCell(view.container, "row-3", "name"));
    expect(rowIdOf(changes.at(-1))).toBe("row-3");

    const cursor = spread ? "row-8" : "row-3";
    if (spread) {
      fireEvent.click(bodyCell(view.container, "row-6", "name"), {
        shiftKey: true,
      });
      fireEvent.keyDown(anyRenderedCell(view.container), { key: "ArrowDown" });
      fireEvent.keyDown(anyRenderedCell(view.container), { key: "ArrowDown" });
      expect(rowIdOf(changes.at(-1))).toBe(cursor);
      expect(seen.at(-1)?.ranges[0]?.startRowId).toBe("row-3");
      expect(seen.at(-1)?.ranges[0]?.endRowId).toBe("row-6");
    }

    view.rerender(
      <WindowedGrid
        windowStart={30}
        onFocus={(next) => changes.push(next)}
        onSelection={(next) => seen.push(next)}
      />,
    );
    await settleWithoutRow(view.container, cursor);
    await settleForRow(view.container, "row-30");

    // The fixture has to describe the situation this exists for: the cursor's
    // row is genuinely unloaded, and rows the grid CAN reach are on screen.
    expect(
      view.container.querySelector(`[data-pretable-row-id="${cursor}"]`),
    ).toBeNull();
    expect(
      view.container.querySelector('[data-pretable-row-id="row-30"]'),
    ).not.toBeNull();

    return { view, changes, seen, cursor };
  }

  async function slideBack(
    view: ReturnType<typeof render>,
    changes: PretableSurfaceFocusState<string>[],
    seen: PretableSelectionState[],
    cursor: string,
  ) {
    view.rerender(
      <WindowedGrid
        windowStart={0}
        onFocus={(next) => changes.push(next)}
        onSelection={(next) => seen.push(next)}
      />,
    );
    await settleForRow(view.container, cursor);
  }

  it("PageDown holds the cursor instead of teleporting it into the window", async () => {
    const { view, changes, seen, cursor } = await evictedCursor();
    const beforeKey = changes.length;

    fireEvent.keyDown(anyRenderedCell(view.container), { key: "PageDown" });

    expect(rowIdOf(changes.at(-1))).toBe(cursor);
    expect(changes.length).toBe(beforeKey);

    await slideBack(view, changes, seen, cursor);
    expect(focusedRowId(view.container)).toBe(cursor);
  });

  it("PageUp holds the cursor too", async () => {
    const { view, changes, seen, cursor } = await evictedCursor();
    const beforeKey = changes.length;

    fireEvent.keyDown(anyRenderedCell(view.container), { key: "PageUp" });

    expect(rowIdOf(changes.at(-1))).toBe(cursor);
    expect(changes.length).toBe(beforeKey);

    await slideBack(view, changes, seen, cursor);
    expect(focusedRowId(view.container)).toBe(cursor);
  });

  it("Shift+PageDown leaves the selection alone as well as the cursor", async () => {
    // The refusal has to reach the selection too. A move the engine declined
    // has nothing new to extend to, and extending to the evicted cursor itself
    // would rewrite whatever the user had into a range the grid cannot place —
    // a silent collapse dressed up as a keystroke that did nothing.
    const { view, changes, seen, cursor } = await evictedCursor(true);
    const beforeKey = changes.length;
    const beforeSelection = seen.length;
    // Anchor `row-3`, range 3..6, cursor `row-8`: three distinct addresses, so
    // an `anchor → cursor` re-extension lands on 3..8 and is impossible to
    // miss. See `evictedCursor`.
    expect(seen.at(-1)?.ranges[0]?.startRowId).toBe("row-3");
    expect(seen.at(-1)?.ranges[0]?.endRowId).toBe("row-6");

    fireEvent.keyDown(anyRenderedCell(view.container), {
      key: "PageDown",
      shiftKey: true,
    });

    expect(rowIdOf(changes.at(-1))).toBe(cursor);
    expect(changes.length).toBe(beforeKey);
    expect(seen.length).toBe(beforeSelection);
    expect(seen.at(-1)?.ranges[0]?.endRowId).toBe("row-6");
  });

  it("the positive twin: a LOADED cursor in the same windowed grid still pages", async () => {
    // Without this, "the cursor did not move" is satisfied by a page key that
    // stopped working in windowed mode altogether.
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = render(
      <WindowedGrid windowStart={30} onFocus={(next) => changes.push(next)} />,
    );
    await settleForRow(view.container, "row-30");

    fireEvent.click(bodyCell(view.container, "row-30", "name"));
    expect(rowIdOf(changes.at(-1))).toBe("row-30");

    fireEvent.keyDown(anyRenderedCell(view.container), { key: "PageDown" });
    const landed = String(rowIdOf(changes.at(-1)));
    expect(landed).not.toBe("row-30");
    expect(Number(landed.slice("row-".length))).toBeGreaterThan(31);
  });
});
