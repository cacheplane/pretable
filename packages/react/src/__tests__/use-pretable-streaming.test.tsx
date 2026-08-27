// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePretable } from "../use-pretable";
import { createColumnHelper } from "@pretable/core";
import type { PretableReactGrid } from "../pretable-model";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";

type Row = {
  id: string;
  name: string;
};

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("name", { header: "Name", type: "text" }),
] as const;

describe("usePretable streaming lifecycle", () => {
  it("keeps the grid instance and selection across rows updates", async () => {
    const { result, rerender } = renderHook(
      ({ rows }: { rows: Row[] }) =>
        usePretable({
          columns,
          rows,
          viewportHeight: 200,
        }),
      {
        initialProps: {
          rows: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
        },
      },
    );

    const grid = result.current.grid;
    grid.toggleRowSelection("a");
    expect(result.current.grid.getState().selection.rows).toMatchObject({
      kind: "explicit",
    });

    // New array, same ids, new data — the streaming case.
    rerender({
      rows: [
        { id: "a", name: "A2" },
        { id: "b", name: "B2" },
      ],
    });

    expect(result.current.grid).toBe(grid); // not recreated
    await waitFor(() =>
      expect(result.current.rowModelSnapshot.dataRowAt(0)?.row.name).toBe("A2"),
    );
    const selected = result.current.gridSnapshot.selection.rows;
    expect(selected.kind).toBe("explicit");
    if (selected.kind !== "explicit") throw new Error("expected explicit rows");
    expect(selected.rowIds.has("a")).toBe(true);
  });
});

/**
 * "Streaming", here, means exactly what the test above calls it: a rerender
 * with a NEW `rows` array holding NEW row objects that carry the SAME ids.
 * The ungrouped case is the easy one — the visible row list is the row list,
 * so a patch lands in place and nothing under the cursor moves.
 *
 * Grouping is where it breaks. The visible row list is DERIVED: group headers
 * are synthesized, data rows are re-pathed under whichever group their key
 * now names, and a group can appear or vanish between two frames. A streamed
 * patch can therefore move a row out from under a live selection, a focus
 * cursor, an open editor, or a collapsed ancestor — none of which are
 * addressed by visible index. These pin that the engine re-paths the row and
 * carries the cursor with it.
 *
 * Asserted against `PretableSurface`, not the bare hook: group rows, cell
 * ranges and focus refs are only observable once something draws them.
 */
type StreamRow = {
  id: string;
  sector: string;
  name: string;
  qty: number;
};

type StreamGrid = PretableReactGrid<
  StreamRow,
  string,
  readonly [
    { readonly id: "sector"; readonly accessor: (row: StreamRow) => string },
    { readonly id: "name"; readonly accessor: (row: StreamRow) => string },
    { readonly id: "qty"; readonly accessor: (row: StreamRow) => number },
  ]
>;

const STREAM_ROWS: StreamRow[] = [
  { id: "r1", sector: "Tech", name: "alpha", qty: 1 },
  { id: "r2", sector: "Tech", name: "beta", qty: 2 },
  { id: "r3", sector: "Energy", name: "gamma", qty: 4 },
];

const streamColumns: PretableColumn<StreamRow>[] = [
  { id: "sector", header: "Sector", widthPx: 100, type: "text" },
  { id: "name", header: "Name", widthPx: 100, type: "text", editable: true },
  { id: "qty", header: "Qty", widthPx: 100, type: "number", aggregate: "sum" },
];

/**
 * Every streamed frame is a fresh array of fresh objects — the same identity
 * churn a live feed produces. Reusing a row object would let a test pass on
 * reference equality alone and prove nothing about re-pathing.
 */
const streamFrame = (
  patches: Record<string, Partial<StreamRow>> = {},
  extra: StreamRow[] = [],
  drop: string[] = [],
): StreamRow[] => [
  ...STREAM_ROWS.filter((row) => !drop.includes(row.id)).map((row) => ({
    ...row,
    ...patches[row.id],
  })),
  ...extra.map((row) => ({ ...row })),
];

interface StreamGridProps {
  rows: StreamRow[];
  onGridReady?: (grid: StreamGrid) => void;
}

function GroupedStreamGrid({ rows, onGridReady }: StreamGridProps) {
  return (
    <PretableSurface
      ariaLabel="streaming-grouped-grid"
      columns={streamColumns}
      getRowId={(row: StreamRow) => row.id}
      initialExpansion={{ kind: "expanded" }}
      onGridReady={(grid) => onGridReady?.(grid as unknown as StreamGrid)}
      onQueryChange={() => {}}
      onRowChange={() => {}}
      overscan={0}
      query={{ filters: [], sort: [], rowGroups: [{ columnId: "sector" }] }}
      rows={rows}
      viewportHeight={600}
    />
  );
}

/**
 * Visible order, read off the row index the surface stamps — DOM order is a
 * rendering detail of an absolutely-positioned window, the index is the
 * engine's own answer.
 */
const visibleRowIds = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("[data-pretable-row-id]")]
    .map((row) => ({
      id: row.getAttribute("data-pretable-row-id") ?? "",
      index: Number(row.getAttribute("data-pretable-row-index")),
    }))
    .sort((a, b) => a.index - b.index)
    .map((row) => row.id);

const cellOf = (container: HTMLElement, rowId: string, columnId: string) => {
  const cell = container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
  );
  if (cell === null) throw new Error(`Expected a ${rowId}/${columnId} cell`);
  return cell;
};

const groupRowNamed = (container: HTMLElement, label: string): HTMLElement => {
  const row = [
    ...container.querySelectorAll<HTMLElement>("[data-pretable-group-row]"),
  ].find((candidate) =>
    candidate
      .querySelector("[data-pretable-group-label]")
      ?.textContent?.includes(label),
  );
  if (row === undefined) throw new Error(`Expected a ${label} group row`);
  return row;
};

const twistyOfGroup = (container: HTMLElement, label: string): HTMLElement => {
  const twisty = groupRowNamed(container, label).querySelector<HTMLElement>(
    "[data-pretable-group-twisty]",
  );
  if (twisty === null) throw new Error(`Expected a ${label} twisty`);
  return twisty;
};

const GROUPED_ORDER = [
  "__group__:sector=s:Energy",
  "r3",
  "__group__:sector=s:Tech",
  "r1",
  "r2",
];

async function renderGroupedStream(rows: StreamRow[] = STREAM_ROWS) {
  let grid: StreamGrid | undefined;
  const view = render(
    <GroupedStreamGrid
      onGridReady={(ready) => {
        grid = ready;
      }}
      rows={rows}
    />,
  );
  await expect.poll(() => visibleRowIds(view.container)).toEqual(GROUPED_ORDER);
  if (grid === undefined) throw new Error("Expected grid readiness");
  const stream = (next: StreamRow[]) => {
    view.rerender(<GroupedStreamGrid rows={next} />);
  };
  return { view, grid, stream };
}

describe("usePretable streaming while grouped", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the cell range and focus on a streamed in-place update", async () => {
    const { view, grid, stream } = await renderGroupedStream();
    fireEvent.click(cellOf(view.container, "r1", "name"));
    await expect
      .poll(() => grid.getState().focus.ref)
      .toEqual({ kind: "data", rowId: "r1" });

    stream(streamFrame({ r1: { name: "alpha-2" } }));

    await waitFor(() =>
      expect(cellOf(view.container, "r1", "name")).toHaveTextContent("alpha-2"),
    );
    expect(grid.getState().selection.ranges).toEqual([
      {
        start: { rowId: "r1", columnId: "name" },
        end: { rowId: "r1", columnId: "name" },
      },
    ]);
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "name",
    });
    expect(visibleRowIds(view.container)).toEqual(GROUPED_ORDER);
  });

  it("re-paths a row whose grouping key is streamed, carrying range and focus", async () => {
    const { view, grid, stream } = await renderGroupedStream();
    fireEvent.click(cellOf(view.container, "r1", "name"));
    await expect
      .poll(() => grid.getState().focus.ref)
      .toEqual({ kind: "data", rowId: "r1" });

    stream(streamFrame({ r1: { sector: "Energy" } }));

    await expect
      .poll(() => visibleRowIds(view.container))
      .toEqual([
        "__group__:sector=s:Energy",
        "r1",
        "r3",
        "__group__:sector=s:Tech",
        "r2",
      ]);
    expect(grid.getState().selection.ranges).toEqual([
      {
        start: { rowId: "r1", columnId: "name" },
        end: { rowId: "r1", columnId: "name" },
      },
    ]);
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "name",
    });
  });

  it("keeps a collapsed group collapsed across a streamed update", async () => {
    const { view, stream } = await renderGroupedStream();
    fireEvent.click(twistyOfGroup(view.container, "Tech"));
    await expect
      .poll(() => visibleRowIds(view.container))
      .toEqual(["__group__:sector=s:Energy", "r3", "__group__:sector=s:Tech"]);

    stream(streamFrame({ r2: { name: "beta-2" } }));

    await waitFor(() =>
      expect(twistyOfGroup(view.container, "Tech")).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
    expect(visibleRowIds(view.container)).toEqual([
      "__group__:sector=s:Energy",
      "r3",
      "__group__:sector=s:Tech",
    ]);
  });

  it("recomputes group aggregates on a streamed update", async () => {
    const { view, stream } = await renderGroupedStream();
    expect(groupRowNamed(view.container, "Energy")).toHaveTextContent(
      "Energy(1)4",
    );
    expect(groupRowNamed(view.container, "Tech")).toHaveTextContent("Tech(2)3");

    stream(streamFrame({ r1: { qty: 100 } }));

    await waitFor(() =>
      expect(groupRowNamed(view.container, "Tech")).toHaveTextContent(
        "Tech(2)102",
      ),
    );
    // The untouched group must not be recomputed into something else.
    expect(groupRowNamed(view.container, "Energy")).toHaveTextContent(
      "Energy(1)4",
    );
  });

  it("inserts a streamed row's new group in sort order, leaving focus alone", async () => {
    const { view, grid, stream } = await renderGroupedStream();
    fireEvent.click(cellOf(view.container, "r1", "name"));
    await expect
      .poll(() => grid.getState().focus.ref)
      .toEqual({ kind: "data", rowId: "r1" });

    stream(
      streamFrame({}, [{ id: "r4", sector: "Health", name: "delta", qty: 9 }]),
    );

    await expect
      .poll(() => visibleRowIds(view.container))
      .toEqual([
        "__group__:sector=s:Energy",
        "r3",
        "__group__:sector=s:Health",
        "r4",
        "__group__:sector=s:Tech",
        "r1",
        "r2",
      ]);
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "name",
    });
  });

  it("clears focus and its range when the focused row is streamed away", async () => {
    const { view, grid, stream } = await renderGroupedStream();
    fireEvent.click(cellOf(view.container, "r3", "name"));
    await expect
      .poll(() => grid.getState().focus.ref)
      .toEqual({ kind: "data", rowId: "r3" });

    stream(streamFrame({}, [], ["r3"]));

    await expect.poll(() => grid.getState().focus.ref).toBeNull();
    expect(grid.getState().focus.columnId).toBeNull();
    expect(grid.getState().selection.ranges).toEqual([]);
    expect(grid.getState().selection.anchor).toBeNull();
  });

  it("keeps an in-flight editor open across a streamed re-path", async () => {
    const { view, stream } = await renderGroupedStream();
    const cell = cellOf(view.container, "r1", "name");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    const editor = view.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "draft" } });

    stream(streamFrame({ r1: { sector: "Energy" } }));

    await expect
      .poll(() => visibleRowIds(view.container))
      .toEqual([
        "__group__:sector=s:Energy",
        "r1",
        "r3",
        "__group__:sector=s:Tech",
        "r2",
      ]);
    const live = view.getByRole("textbox");
    expect(live).toBeInTheDocument();
    expect(live).toHaveValue("draft");
  });
});
