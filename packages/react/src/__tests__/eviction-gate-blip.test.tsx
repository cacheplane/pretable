import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";
import { PretableSurface } from "../pretable-surface";

/**
 * One revision on which the honesty gate does not pass, while the window
 * moves.
 *
 * The gate closing is a statement about what the engine can VERIFY this
 * render — an in-flight count query, a backend that estimates past 10k, a
 * single revision of engine-side sort. It is not a statement about which rows
 * exist. Before this, that one revision made every absent row read as deleted
 * and destroyed the selection AND the cursor irrecoverably: restoring the
 * exact total afterwards brought nothing back, because the span had already
 * been discarded.
 *
 * UNCONTROLLED on purpose. A controlled consumer is accidentally immune —
 * the `state.selection` echo re-supplies on the next render what the engine
 * threw away — so the controlled shape cannot see this at all.
 */

type Row = { id: string; name: string; score: number };

const TOTAL = 20;
const ALL: Row[] = Array.from({ length: TOTAL }, (_, index) => ({
  id: `row-${index}`,
  name: `name-${index}`,
  score: index,
}));

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "score", header: "Score", widthPx: 120 },
];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

const POPULATION = "sort=name";
const QUERY = { filters: [], sort: [], rowGroups: [] };
const EXACT: PretableMatchingTotal = { kind: "exact", count: TOTAL };
/** An in-flight count query, or a backend that stops counting past 10k. */
const ESTIMATE: PretableMatchingTotal = { kind: "estimate", count: TOTAL };

/** Row ids of `ALL[start, start + length)` — the window a render asks for. */
function windowIds(start: number, length = 10): string[] {
  return ALL.slice(start, start + length).map((row) => row.id);
}

/**
 * Polls until the row layout controller has drawn exactly `rowIds` and
 * placed the first of them below `spacerRows` rows of leading spacer.
 *
 * A window slide is not visible on the render that requests it: the
 * controller settles a `setRows` across scheduler hops, and under CPU
 * starvation those hops outlast any fixed sleep — the 20ms `setTimeout` this
 * replaces failed loaded full-suite runs with the DOM one window behind
 * (#548). The spacer is the second half of the settle: the ids say WHICH rows
 * the plan drew, the spacer says under WHICH gate it drew them — a shut gate
 * draws zero spacer rows (`windowSpacers` is `null` while the total is not
 * exact, or the sort is not external) and an open one draws `windowStart`
 * rows. `rows[].top` is global, so the first row's `top` IS that spacer, in
 * whatever row height the theme resolved to.
 */
async function settledWindow(
  container: HTMLElement,
  rowIds: readonly string[],
  spacerRows: number,
): Promise<void> {
  await waitFor(
    () => {
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>("[data-pretable-row-id]"),
      );
      expect(
        rows.map((node) => node.getAttribute("data-pretable-row-id") ?? ""),
      ).toEqual(rowIds);
      const first = rows[0]!;
      const rowHeight = Number(first.getAttribute("data-pretable-row-height"));
      expect(first.style.top).toBe(`${spacerRows * rowHeight}px`);
    },
    { timeout: 15_000 },
  );
}

function WindowedGrid({
  windowStart,
  length = 10,
  total = EXACT,
  processing = EXTERNAL,
}: {
  windowStart: number;
  length?: number;
  total?: PretableMatchingTotal;
  processing?: PretableProcessingOptions;
}) {
  return (
    <PretableSurface<Row>
      ariaLabel="Windowed"
      columns={columns}
      rows={ALL.slice(windowStart, windowStart + length)}
      getRowId={(row) => row.id}
      viewportHeight={800}
      processing={processing}
      resultMeta={{
        total,
        window: {
          start: windowStart,
          hasMore: windowStart + length < TOTAL,
        },
        datasetKey: POPULATION,
      }}
      query={QUERY}
      onQueryChange={() => undefined}
    />
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

/** Row ids whose `name` cell is painting selected, in DOM order. */
function painted(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-pretable-row-id]"))
    .filter(
      (node) =>
        node
          .querySelector('[data-pretable-column-id="name"]')
          ?.getAttribute("data-pretable-selected") === "true",
    )
    .map((node) => node.getAttribute("data-pretable-row-id") ?? "");
}

/** `[rowId, columnId]` of the cursor, or `[]` when there is none. */
function focused(container: HTMLElement): string[] {
  const cell = container.querySelector(
    '[data-pretable-column-id][data-pretable-focused="true"]',
  );
  if (cell === null) return [];
  return [
    cell
      .closest("[data-pretable-row-id]")
      ?.getAttribute("data-pretable-row-id") ?? "",
    cell.getAttribute("data-pretable-column-id") ?? "",
  ];
}

async function selectThenSlideAndReturn(
  blip: {
    total?: PretableMatchingTotal;
    processing?: PretableProcessingOptions;
  },
  /**
   * Leading spacer rows the controller draws for the blip render: `10` when
   * the gate is open (the control), `0` when the blip shuts it — see
   * `settledWindow`.
   */
  blipSpacerRows: number,
) {
  const { container, rerender } = render(<WindowedGrid windowStart={0} />);
  fireEvent.click(bodyCell(container, "row-1", "name"));
  fireEvent.click(bodyCell(container, "row-8", "name"), { shiftKey: true });
  const whileLoaded = painted(container);

  // The window slides on the one render whose gate is shut.
  rerender(<WindowedGrid windowStart={10} {...blip} />);
  await settledWindow(container, windowIds(10), blipSpacerRows);
  // Gate restored, exactly as it was before the blip. Nothing observable to
  // settle: the rows are the same, so `setRows` is not an effective write
  // (`create-local-row-model.ts` bumps the revision only when
  // `drafted.effective`), and the controller deliberately does not replan on
  // a `resultMeta`-only change (see `windowGap` in pretable-surface.tsx) — so
  // for the total blip this render never reaches the engine at all. Restoring
  // `processing` does recompile the query as a revision of its own, but it
  // draws the same rows under the same spacer, and grid-core reconciles it or
  // skips it as stale behind the return slide below; either way the return
  // slide's reconcile is what the assertions read.
  rerender(<WindowedGrid windowStart={10} />);
  // Scroll back to where the selection lives.
  rerender(<WindowedGrid windowStart={0} />);
  await settledWindow(container, windowIds(0), 0);

  return { whileLoaded, after: painted(container), cursor: focused(container) };
}

const SELECTED = [
  "row-1",
  "row-2",
  "row-3",
  "row-4",
  "row-5",
  "row-6",
  "row-7",
  "row-8",
];

afterEach(cleanup);

describe("a window that slides while the honesty gate is shut", () => {
  it("CONTROL: an ordinary slide with the gate open keeps both", async () => {
    // The positive twin. Without it every assertion below is satisfied by a
    // fixture that never selected anything in the first place.
    const result = await selectThenSlideAndReturn({}, 10);
    expect(result.whileLoaded).toEqual(SELECTED);
    expect(result.after).toEqual(SELECTED);
    expect(result.cursor).toEqual(["row-8", "name"]);
  }, 20_000);

  it("keeps the selection and the cursor across an estimated total", async () => {
    const result = await selectThenSlideAndReturn({ total: ESTIMATE }, 0);
    expect(result.whileLoaded).toEqual(SELECTED);
    expect(result.after).toEqual(SELECTED);
    expect(result.cursor).toEqual(["row-8", "name"]);
  }, 20_000);

  it("LOCAL MODE: a row that genuinely disappears still loses its selection", async () => {
    // The other side of the discriminator, at the level the bug was found.
    // A grid with no `resultMeta.window` hands over the whole result on every
    // render, so an absent row really has been deleted — and "retain when the
    // window is unknown" must not leak into it, or a local grid would keep
    // painting rows the consumer removed.
    const { container, rerender } = render(
      <PretableSurface<Row>
        ariaLabel="Local"
        columns={columns}
        rows={ALL}
        getRowId={(row) => row.id}
        viewportHeight={800}
      />,
    );
    fireEvent.click(bodyCell(container, "row-1", "name"));
    fireEvent.click(bodyCell(container, "row-8", "name"), { shiftKey: true });
    expect(painted(container)).toEqual(SELECTED);

    // `row-1`..`row-8` are gone from the data. No window, so there is nothing
    // to call this an eviction.
    rerender(
      <PretableSurface<Row>
        ariaLabel="Local"
        columns={columns}
        rows={[...ALL.slice(0, 1), ...ALL.slice(9)]}
        getRowId={(row) => row.id}
        viewportHeight={800}
      />,
    );
    // No window, so no spacer either way.
    await settledWindow(
      container,
      [...windowIds(0, 1), ...windowIds(9, 11)],
      0,
    );

    expect(painted(container)).toEqual([]);
    expect(focused(container)).toEqual([]);
  }, 20_000);

  it("keeps them across one revision of engine-side sort", async () => {
    // A second, entirely different way to shut the same gate — so the fix
    // cannot be a special case for `total.kind`.
    const result = await selectThenSlideAndReturn(
      { processing: { filter: "external", sort: "engine" } },
      0,
    );
    expect(result.whileLoaded).toEqual(SELECTED);
    expect(result.after).toEqual(SELECTED);
    expect(result.cursor).toEqual(["row-8", "name"]);
  }, 20_000);
});
