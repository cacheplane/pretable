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
 * A selection whose rows are evicted, when the POPULATION changes underneath
 * it while they are gone.
 *
 * `datasetKey` identifies the QUERY, not the population — by design, and the
 * docs say so out loud ("keep it stable while you page within one result").
 * So an insert or a delete upstream of an evicted selection leaves the key
 * matching while silently re-filling the remembered dataset positions with
 * different rows. Before the population fingerprint, that painted five rows
 * selected of which four had not existed when the user selected, and painted
 * nothing on the rows the user actually chose.
 *
 * Driven through the public surface, because the failure IS the paint: a
 * grid-core test can only observe the span, and the span was never the lie.
 */

type Row = { id: string; name: string; score: number };

const BASE: Row[] = Array.from({ length: 20 }, (_, index) => ({
  id: `row-${index}`,
  name: `name-${index}`,
  score: index,
}));

/** Five rows inserted UPSTREAM of the selection, by someone else, same query. */
const PREPENDED: Row[] = [
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `new-${index}`,
    name: `fresh-${index}`,
    score: -1 - index,
  })),
  ...BASE,
];

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "score", header: "Score", widthPx: 120 },
];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

/**
 * ONE key for the whole file, deliberately. The bug is precisely that the
 * consumer is doing the documented right thing: same query, so same key.
 */
const POPULATION = "sort=name";

const QUERY = { filters: [], sort: [], rowGroups: [] };

/** Row ids of `dataset[start, start + length)` — the window a render asks for. */
function windowIds(
  dataset: readonly Row[],
  start: number,
  length: number,
): string[] {
  return dataset.slice(start, start + length).map((row) => row.id);
}

/** Every rendered row id, in DOM order. */
function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-pretable-row-id]")).map(
    (node) => node.getAttribute("data-pretable-row-id") ?? "",
  );
}

/**
 * Polls until the row layout controller has drawn exactly `rowIds`.
 *
 * A window slide is not visible on the render that requests it: `setRows`
 * lands synchronously, but the controller settles the new rows across
 * scheduler hops (`MessageChannel` macrotasks), and under CPU starvation those
 * hops outlast any fixed sleep. The 20ms `setTimeout` this replaces failed
 * loaded full-suite runs with the DOM still showing the PREVIOUS window —
 * `row-1` present, already announced at the new window's `aria-rowindex`
 * (#548). Once the ids match, the commit that drew them has also run
 * `observeRowModelRevision`, so the selection is reconciled against THIS
 * window and the paint below is the settled one, not a transient.
 */
async function settledRows(
  container: HTMLElement,
  rowIds: readonly string[],
): Promise<void> {
  await waitFor(() => expect(renderedRowIds(container)).toEqual(rowIds), {
    timeout: 15_000,
  });
}

function WindowedGrid({
  dataset,
  windowStart,
  length,
  onSelection,
}: {
  dataset: readonly Row[];
  windowStart: number;
  length: number;
  onSelection?: (next: PretableSelectionState) => void;
}) {
  const [selection, setSelection] = React.useState<PretableSelectionState>({
    ranges: [],
    anchor: null,
  });
  return (
    <PretableSurface<Row>
      ariaLabel="Windowed"
      columns={columns}
      rows={dataset.slice(windowStart, windowStart + length)}
      getRowId={(row) => row.id}
      viewportHeight={800}
      processing={EXTERNAL}
      resultMeta={{
        total: { kind: "exact", count: dataset.length },
        window: {
          start: windowStart,
          hasMore: windowStart + length < dataset.length,
        },
        datasetKey: POPULATION,
      }}
      query={QUERY}
      onQueryChange={() => undefined}
      state={{ selection }}
      onSelectionChange={(next) => {
        setSelection(next);
        onSelection?.(next);
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

/**
 * Every rendered row, in DOM order, with what its `name` cell is PAINTING.
 *
 * The CELL attribute, not the row's. A range spanning one column of two is
 * not a fully-selected row, so `data-pretable-selected` on the row element is
 * `false` for every row here — including the ones the user really did select.
 * Reading it would make every assertion in this file vacuously true.
 */
function paintReport(
  container: HTMLElement,
): { rowId: string; selected: boolean }[] {
  return Array.from(container.querySelectorAll("[data-pretable-row-id]")).map(
    (node) => ({
      rowId: node.getAttribute("data-pretable-row-id") ?? "",
      selected:
        node
          .querySelector('[data-pretable-column-id="name"]')
          ?.getAttribute("data-pretable-selected") === "true",
    }),
  );
}

afterEach(cleanup);

describe("an evicted selection when the population changes underneath it", () => {
  it("paints nothing rather than rows the reader never selected", async () => {
    const seen: PretableSelectionState[] = [];
    const { container, rerender } = render(
      <WindowedGrid
        dataset={BASE}
        windowStart={0}
        length={10}
        onSelection={(next) => seen.push(next)}
      />,
    );

    fireEvent.click(bodyCell(container, "row-1", "name"));
    fireEvent.click(bodyCell(container, "row-8", "name"), { shiftKey: true });
    expect(seen.at(-1)?.ranges[0]?.datasetRowSpan).toMatchObject({
      start: 1,
      end: 8,
      datasetKey: POPULATION,
    });

    // Both endpoints evict.
    rerender(
      <WindowedGrid
        dataset={BASE}
        windowStart={10}
        length={10}
        onSelection={(next) => seen.push(next)}
      />,
    );
    await settledRows(container, windowIds(BASE, 10, 10));
    expect(
      container.querySelector('[data-pretable-row-id="row-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-pretable-row-id="row-8"]'),
    ).toBeNull();

    // Somebody else inserts five rows at the head of the SAME result. The
    // query has not changed, so `datasetKey` correctly has not either — and
    // dataset positions 1..8 now name entirely different rows.
    rerender(
      <WindowedGrid
        dataset={PREPENDED}
        windowStart={0}
        length={6}
        onSelection={(next) => seen.push(next)}
      />,
    );
    await settledRows(container, [
      "new-0",
      "new-1",
      "new-2",
      "new-3",
      "new-4",
      "row-0",
    ]);

    // Not one of these rows was in the selection. Four of them did not exist
    // when it was made.
    expect(paintReport(container).filter((entry) => entry.selected)).toEqual(
      [],
    );
  }, 20_000);

  it("still paints the selection back when the population did NOT change", async () => {
    // The positive twin. Without it the assertion above is satisfied by a
    // fixture that simply never paints anything, and eviction's whole promise
    // — "a selected row returns selected" — could be deleted with the test
    // still green.
    const { container, rerender } = render(
      <WindowedGrid dataset={BASE} windowStart={0} length={10} />,
    );

    fireEvent.click(bodyCell(container, "row-1", "name"));
    fireEvent.click(bodyCell(container, "row-8", "name"), { shiftKey: true });

    rerender(<WindowedGrid dataset={BASE} windowStart={10} length={10} />);
    await settledRows(container, windowIds(BASE, 10, 10));
    rerender(<WindowedGrid dataset={BASE} windowStart={0} length={6} />);
    await settledRows(container, windowIds(BASE, 0, 6));

    expect(paintReport(container)).toEqual([
      { rowId: "row-0", selected: false },
      { rowId: "row-1", selected: true },
      { rowId: "row-2", selected: true },
      { rowId: "row-3", selected: true },
      { rowId: "row-4", selected: true },
      { rowId: "row-5", selected: true },
    ]);
  }, 20_000);

  it("recovers the real rows once both endpoints are loaded again", async () => {
    // Failing closed is not the same as failing permanently. Once the window
    // covers the selection's actual rows in the NEW population, both
    // endpoints resolve first-hand, the span is re-stamped against the new
    // total, and the right rows paint again.
    const { container, rerender } = render(
      <WindowedGrid dataset={BASE} windowStart={0} length={10} />,
    );

    fireEvent.click(bodyCell(container, "row-1", "name"));
    fireEvent.click(bodyCell(container, "row-8", "name"), { shiftKey: true });

    rerender(<WindowedGrid dataset={BASE} windowStart={10} length={10} />);
    await settledRows(container, windowIds(BASE, 10, 10));
    rerender(<WindowedGrid dataset={PREPENDED} windowStart={0} length={6} />);
    await settledRows(container, windowIds(PREPENDED, 0, 6));
    // `row-1`..`row-8` now live at dataset positions 6..13.
    rerender(<WindowedGrid dataset={PREPENDED} windowStart={4} length={12} />);
    await settledRows(container, windowIds(PREPENDED, 4, 12));

    const selected = paintReport(container)
      .filter((entry) => entry.selected)
      .map((entry) => entry.rowId);
    expect(selected).toEqual([
      "row-1",
      "row-2",
      "row-3",
      "row-4",
      "row-5",
      "row-6",
      "row-7",
      "row-8",
    ]);
  }, 20_000);
});
