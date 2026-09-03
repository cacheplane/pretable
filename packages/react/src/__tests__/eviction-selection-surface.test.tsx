import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PretableProcessingOptions,
  PretableSelectionState,
} from "@pretable/core";
import { PretableSurface } from "../pretable-surface";

/**
 * Selection under EVICTION, driven the way a user drives it.
 *
 * The engine-level tests for this live in `@pretable-internal/grid-core`. This
 * file exists because those tests can be satisfied by a fixture that loads the
 * whole dataset — which is a grid where eviction has not happened. Here the
 * grid is genuinely windowed: ten rows resident out of twenty, the window
 * slides incrementally, and the selection is built by clicking cells rather
 * than by handing the engine a pre-built range.
 *
 * The controlled shape is deliberate. `state.selection` + `onSelectionChange`
 * flattens every range to `startRowId`/`endRowId` and re-inflates it on the
 * next render, so it is the path where a dataset span is most likely to be
 * quietly dropped.
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

const EMPTY: PretableSelectionState = { ranges: [], anchor: null };

/**
 * Spans are fail-closed on `resultMeta.datasetKey`: a windowed grid that
 * publishes none gets no span survival at all, because the engine has no way
 * to tell a scroll from a re-sort. So every grid here publishes one, and the
 * keyless configuration is pinned at the engine level
 * (`indexed-selection.test.ts`, "a windowed grid that publishes no
 * datasetKey refuses its own spans").
 */
const POPULATION = "sort=name";

/**
 * Stable identity: a fresh query object every render is a controlled-query
 * CHANGE, which schedules cooperative row-model work and stalls the very
 * window slide these tests are about.
 */
const QUERY = { filters: [], sort: [], rowGroups: [] };

/** Row ids of `ALL[start, start + length)` — the window a render asks for. */
function windowIds(start: number, length = 10): string[] {
  return ALL.slice(start, start + length).map((row) => row.id);
}

/**
 * Polls until the row layout controller has drawn exactly `rowIds`, in DOM
 * order. A window slide is not visible on the render that requests it: the
 * controller settles the new rows across scheduler hops, and under CPU
 * starvation those hops outlast any fixed sleep — the 20ms `setTimeout` this
 * replaces failed loaded full-suite runs with `row-1` still in the DOM (#548).
 * Once the ids match, the commit that drew them has also run
 * `observeRowModelRevision`, so the anchor's eviction is already reconciled.
 */
async function settledRows(
  container: HTMLElement,
  rowIds: readonly string[],
): Promise<void> {
  await waitFor(
    () =>
      expect(
        Array.from(container.querySelectorAll("[data-pretable-row-id]")).map(
          (node) => node.getAttribute("data-pretable-row-id") ?? "",
        ),
      ).toEqual(rowIds),
    { timeout: 15_000 },
  );
}

/**
 * A windowed grid under the honesty gate: full external authority, an exact
 * population total, and `resultMeta.window.start` saying where the loaded
 * slice sits. Anything less and the engine refuses to speak in dataset
 * positions at all, which is the documented conditional on this feature.
 */
function WindowedGrid({
  windowStart,
  length = 10,
  datasetKey = POPULATION,
  initialSelection = EMPTY,
  onSelection,
}: {
  windowStart: number;
  length?: number;
  datasetKey?: string;
  initialSelection?: PretableSelectionState;
  onSelection: (next: PretableSelectionState) => void;
}) {
  const [selection, setSelection] =
    React.useState<PretableSelectionState>(initialSelection);
  return (
    <PretableSurface<Row>
      ariaLabel="Windowed"
      columns={columns}
      rows={ALL.slice(windowStart, windowStart + length)}
      getRowId={(row) => row.id}
      viewportHeight={800}
      processing={EXTERNAL}
      resultMeta={{
        total: { kind: "exact", count: TOTAL },
        window: {
          start: windowStart,
          hasMore: windowStart + length < TOTAL,
        },
        datasetKey,
      }}
      query={QUERY}
      onQueryChange={() => undefined}
      state={{ selection }}
      onSelectionChange={(next) => {
        setSelection(next);
        onSelection(next);
      }}
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

afterEach(cleanup);

describe("a cell selection whose rows get evicted", () => {
  it("survives an incremental slide that evicts one endpoint, then extends from it", async () => {
    // The gesture the review measured as reporting 1 row for a genuine
    // 12-row selection. Three separate defects meet here: a range built by
    // `extendRangeFromAnchor` carries no span at all; an incremental slide
    // collapses a half-resolved range to its survivor; and the controlled
    // `state` round-trip has no field to carry the span back through.
    const seen: PretableSelectionState[] = [];
    const { container, rerender } = render(
      <WindowedGrid windowStart={0} onSelection={(next) => seen.push(next)} />,
    );

    fireEvent.click(bodyCell(container, "row-1", "name"));
    fireEvent.click(bodyCell(container, "row-8", "name"), { shiftKey: true });

    // Both endpoints loaded: the positions are first-hand, and a gesture is
    // where they have to be recorded. Nothing reconciles between these two
    // clicks, so a span written only by reconciliation is absent here.
    expect(seen.at(-1)?.ranges[0]?.datasetRowSpan).toEqual({
      start: 1,
      end: 8,
      datasetKey: POPULATION,
      datasetTotal: TOTAL,
    });

    // Scroll on by five rows. `row-1` (dataset position 1) leaves the loaded
    // window; `row-8` does not. This is the ordinary case — a window JUMP
    // that clears both endpoints at once never reaches the branch that
    // collapses a range to its surviving endpoint.
    rerender(
      <WindowedGrid windowStart={5} onSelection={(next) => seen.push(next)} />,
    );
    await settledRows(container, windowIds(5));
    expect(
      container.querySelector('[data-pretable-row-id="row-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-pretable-row-id="row-8"]'),
    ).not.toBeNull();

    // Shift-click `row-12`. The anchor is `row-1`, which is no longer loaded,
    // so the only place its dataset position can come from is the selection
    // that already holds it.
    fireEvent.click(bodyCell(container, "row-12", "name"), { shiftKey: true });

    const extended = seen.at(-1)?.ranges[0];
    expect(extended?.startRowId).toBe("row-1");
    expect(extended?.endRowId).toBe("row-12");
    expect(extended?.datasetRowSpan).toEqual({
      start: 1,
      end: 12,
      datasetKey: POPULATION,
      datasetTotal: TOTAL,
    });
  }, 20_000);

  it("keeps Cmd+A meaning the LOADED window, and says which rows that is", async () => {
    // The pinned decision. Under the gate a user might reasonably expect
    // Cmd+A to mean all 20 rows, but a cell range is identified by its two
    // endpoint row ids and the engine cannot name a row it has never loaded.
    // A span widened behind loaded ids would also be re-derived — and shrunk
    // back — the moment both ids resolve again. "All rows" is expressible in
    // the separate row-selection program the checkbox column drives; the
    // cell-range slice says what it can prove.
    const seen: PretableSelectionState[] = [];
    const { container } = render(
      <WindowedGrid windowStart={5} onSelection={(next) => seen.push(next)} />,
    );

    fireEvent.click(bodyCell(container, "row-7", "name"));
    fireEvent.keyDown(bodyCell(container, "row-7", "name"), {
      key: "a",
      ctrlKey: true,
    });

    const range = seen.at(-1)?.ranges[0];
    expect(range?.startRowId).toBe("row-5");
    expect(range?.endRowId).toBe("row-14");
    expect(range?.datasetRowSpan).toEqual({
      start: 5,
      end: 14,
      datasetKey: POPULATION,
      datasetTotal: TOTAL,
    });
  });

  it("reads a restored span back in, for rows it has never loaded", () => {
    // The other direction of the controlled round-trip. `PretableCellRange`
    // is flat — `startRowId`/`endRowId`/… — so before this it had no field
    // for a dataset span at all, and a selection persisted and restored (or
    // simply echoed on the first render) arrived with its positions gone.
    // Here the grid has NEVER loaded rows 1..8, so the span in the restored
    // state is the only possible source for the anchor's position.
    const seen: PretableSelectionState[] = [];
    const { container } = render(
      <WindowedGrid
        windowStart={10}
        initialSelection={{
          ranges: [
            {
              startRowId: "row-1",
              endRowId: "row-8",
              startColumnId: "name",
              endColumnId: "name",
              datasetRowSpan: {
                start: 1,
                end: 8,
                datasetKey: POPULATION,
                datasetTotal: TOTAL,
              },
            },
          ],
          anchor: { rowId: "row-1", columnId: "name" },
        }}
        onSelection={(next) => seen.push(next)}
      />,
    );

    fireEvent.click(bodyCell(container, "row-15", "name"), { shiftKey: true });

    const extended = seen.at(-1)?.ranges[0];
    expect(extended?.startRowId).toBe("row-1");
    expect(extended?.datasetRowSpan).toEqual({
      start: 1,
      end: 15,
      datasetKey: POPULATION,
      datasetTotal: TOTAL,
    });
  });

  it("refuses a restored span that cannot say what population it measured", () => {
    // The fail-closed twin of the test above, and the reason `datasetTotal`
    // is not optional on a window. A span carrying positions but no
    // population size is exactly what a consumer persisted BEFORE the
    // population could change under it -- or hand-wrote -- and reading it
    // would resurrect the bug the field exists to close. The same restore,
    // one field short, recovers nothing.
    const seen: PretableSelectionState[] = [];
    const { container } = render(
      <WindowedGrid
        windowStart={10}
        initialSelection={{
          ranges: [
            {
              startRowId: "row-1",
              endRowId: "row-8",
              startColumnId: "name",
              endColumnId: "name",
              datasetRowSpan: { start: 1, end: 8, datasetKey: POPULATION },
            },
          ],
          anchor: { rowId: "row-1", columnId: "name" },
        }}
        onSelection={(next) => seen.push(next)}
      />,
    );

    fireEvent.click(bodyCell(container, "row-15", "name"), { shiftKey: true });

    expect(seen.at(-1)?.ranges[0]?.datasetRowSpan).toBeUndefined();
  });
});
