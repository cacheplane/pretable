import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { PretableProcessingOptions } from "@pretable/core";
import { PretableSurface } from "../pretable-surface";

/**
 * The SURFACE's half of the windowed-scroll coordinate seam.
 *
 * `renderSnapshot.rowMetrics` is built over the loaded rows only, so its
 * offsets are measured from the first loaded row; the scroller, `rows[].top`
 * and `totalHeight` are all measured from the top of the dataset. Two places
 * write one into the other — `grid.scrollToRow()` and keyboard
 * scroll-into-view — and both got it wrong until this branch.
 *
 * Nothing tested it, and nothing COULD have: `renderSnapshot.leadingHeight` is
 * `0` on every non-windowed grid, which makes both conversions the identity
 * function. The one existing `scrollToRow` test asserts `scrollTop > 0`, which
 * a local offset satisfies just as well as a global one.
 *
 * So this fixture is windowed at a large offset — 5,000 rows of leading spacer
 * against 50 loaded ones — where the two spaces are two orders of magnitude
 * apart and cannot be confused for one another.
 */

type Row = { id: string; name: string; score: number };

const TOTAL = 10_000;
const WINDOW_START = 5_000;
const LOADED = 50;

const ROWS: Row[] = Array.from({ length: LOADED }, (_, index) => ({
  id: `row-${WINDOW_START + index}`,
  name: `name-${WINDOW_START + index}`,
  score: WINDOW_START + index,
}));

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "score", header: "Score", widthPx: 120 },
];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

const QUERY = { filters: [], sort: [], rowGroups: [] };

interface Imperative {
  scrollToRow(rowId: string): void;
}

function WindowedGrid({ onReady }: { onReady: (grid: Imperative) => void }) {
  return (
    <PretableSurface<Row>
      ariaLabel="Windowed"
      columns={columns}
      rows={ROWS}
      getRowId={(row) => row.id}
      viewportHeight={400}
      overscan={0}
      processing={EXTERNAL}
      resultMeta={{
        total: { kind: "exact", count: TOTAL },
        window: { start: WINDOW_START, hasMore: true },
        datasetKey: "windowed-scroll-coordinates",
      }}
      query={QUERY}
      onQueryChange={() => undefined}
      onGridReady={(grid) => {
        onReady(grid as unknown as Imperative);
      }}
    />
  );
}

function scroller(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  );
  if (element === null) throw new Error("no scroll viewport");
  return element;
}

afterEach(cleanup);

describe("scrollToRow on a windowed grid", () => {
  it("scrolls to where the row is DRAWN, not to its offset within the window", async () => {
    let grid: Imperative | null = null;
    const { container } = render(
      <WindowedGrid
        onReady={(next) => {
          grid = next;
        }}
      />,
    );
    await waitFor(() => expect(grid).not.toBeNull());
    await waitFor(() =>
      expect(container.querySelector("[data-pretable-row]")).toBeTruthy(),
    );

    const target = `row-${WINDOW_START + 20}`;
    act(() => {
      grid!.scrollToRow(target);
    });

    await waitFor(() =>
      expect(
        container.querySelector(`[data-pretable-row-id="${target}"]`),
      ).toBeTruthy(),
    );

    const row = container.querySelector<HTMLElement>(
      `[data-pretable-row-id="${target}"]`,
    )!;
    // The grid's own drawn position for that row, in the space the scroller
    // uses. `scrollToRow` aligns the row to the top of the band, so these two
    // numbers are the same number — that is the entire contract, and it is the
    // one a local offset written to a global scroller cannot satisfy.
    const drawnTop = parseFloat(row.style.top);
    const scrolled = scroller(container).scrollTop;

    // Guard the fixture before the assertion it feeds: if the spacer collapsed,
    // local and global would coincide and the check below would be vacuous.
    expect(drawnTop).toBeGreaterThan(LOADED * 200);
    expect(scrolled).toBe(drawnTop);
  });
});
