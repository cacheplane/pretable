import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSortEntry } from "@pretable/core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type MultiSortRow = {
  id: string;
  group: string;
  score: number;
  name: string;
  locked: string;
};

const columns = [
  { id: "group", header: "Group", widthPx: 100 },
  { id: "score", header: "Score", widthPx: 100 },
  { id: "name", header: "Name", widthPx: 100 },
  { id: "locked", header: "Locked", widthPx: 100, sortable: false },
];

// Groups tie so the second sort key is observable; scores tie (r2/r4) so
// stability is observable.
const rows: MultiSortRow[] = [
  { id: "r1", group: "b", score: 2, name: "d", locked: "w" },
  { id: "r2", group: "a", score: 1, name: "c", locked: "x" },
  { id: "r3", group: "a", score: 3, name: "b", locked: "y" },
  { id: "r4", group: "b", score: 1, name: "a", locked: "z" },
];

const getRowId = (row: MultiSortRow) => row.id;

function renderGrid(
  props: Partial<
    React.ComponentProps<typeof PretableSurface<MultiSortRow>>
  > = {},
) {
  return render(
    <PretableSurface<MultiSortRow>
      ariaLabel="Multi-sort grid"
      columns={columns}
      getRowId={getRowId}
      overscan={0}
      rows={rows}
      viewportHeight={400}
      {...props}
    />,
  );
}

function header(view: ReturnType<typeof render>, label: string) {
  return view.getByRole("columnheader", {
    name: `Sort ${label}`,
  }) as HTMLButtonElement;
}

function rowIds(view: ReturnType<typeof render>) {
  return view
    .getAllByTestId("pretable-row")
    .map((row) => row.getAttribute("data-pretable-row-id"));
}

async function expectRowIds(
  view: ReturnType<typeof render>,
  expected: readonly string[],
) {
  await waitFor(() => expect(rowIds(view)).toEqual(expected));
}

function badge(view: ReturnType<typeof render>, label: string) {
  return header(view, label).querySelector("[data-pretable-sort-priority]");
}

describe("PretableSurface multi-column sort", () => {
  it("plain click cycles desc → asc → none and replaces a multi-entry list", async () => {
    const onSortChange = vi.fn();
    const view = renderGrid({ onSortChange });

    // Build a two-entry list via shift-clicks.
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    fireEvent.click(header(view, "Score"), { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "group", direction: "desc" },
      { columnId: "score", direction: "desc" },
    ]);
    onSortChange.mockClear();

    // Plain click replaces the whole list with one entry (desc first).
    fireEvent.click(header(view, "Name"));
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "name", direction: "desc" },
    ]);
    expect(header(view, "Group")).toHaveAttribute("aria-sort", "none");
    expect(header(view, "Score")).toHaveAttribute("aria-sort", "none");
    await expectRowIds(view, ["r1", "r2", "r3", "r4"]); // name desc: d,c,b,a
    expect(header(view, "Name")).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(header(view, "Name"));
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "name", direction: "asc" },
    ]);
    await expectRowIds(view, ["r4", "r3", "r2", "r1"]);

    fireEvent.click(header(view, "Name"));
    expect(onSortChange).toHaveBeenLastCalledWith([]);
    await expectRowIds(view, ["r1", "r2", "r3", "r4"]); // source order
    expect(onSortChange).toHaveBeenCalledTimes(3);
  });

  it("plain click on a secondary asc column clears the entire sort", () => {
    // The per-column cycle drives the replacement: a column already at asc
    // steps to none, so plain-clicking it collapses the whole list to [].
    const onSortChange = vi.fn();
    const view = renderGrid({ onSortChange });

    // Build [group desc, score asc] via shift-clicks (score flipped to asc).
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    fireEvent.click(header(view, "Score"), { shiftKey: true });
    fireEvent.click(header(view, "Score"), { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "group", direction: "desc" },
      { columnId: "score", direction: "asc" },
    ]);

    // Plain click on Score (currently asc): next cycle step is none → [].
    fireEvent.click(header(view, "Score"));
    expect(onSortChange).toHaveBeenLastCalledWith([]);
    expect(rowIds(view)).toEqual(["r1", "r2", "r3", "r4"]); // source order
  });

  it("shift-click appends desc, flips to asc in place, then removes only that entry", async () => {
    const onSortChange = vi.fn();
    const view = renderGrid({ onSortChange });

    // Unsorted column → append desc.
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "group", direction: "desc" },
    ]);
    await expectRowIds(view, ["r1", "r4", "r2", "r3"]); // group desc, stable

    // Second unsorted column → appended after (order preserved).
    fireEvent.click(header(view, "Score"), { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "group", direction: "desc" },
      { columnId: "score", direction: "desc" },
    ]);
    await expectRowIds(view, ["r1", "r4", "r3", "r2"]); // score breaks group ties

    // Shift-click a present desc entry → flips to asc in place (stays first).
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);
    expect(header(view, "Group")).toHaveAttribute("aria-sort", "ascending");
    expect(header(view, "Score")).toHaveAttribute("aria-sort", "descending");
    await expectRowIds(view, ["r3", "r2", "r1", "r4"]);

    // Shift-click a present asc entry → removed; other entries keep positions.
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    expect(onSortChange).toHaveBeenLastCalledWith([
      { columnId: "score", direction: "desc" },
    ]);
    expect(header(view, "Group")).toHaveAttribute("aria-sort", "none");
    await expectRowIds(view, ["r3", "r1", "r2", "r4"]); // score desc, r2/r4 stable
  });

  it("renders 1-based priority badges only when two or more columns are sorted", async () => {
    const view = renderGrid();

    fireEvent.click(header(view, "Group"), { shiftKey: true });
    await waitFor(() =>
      expect(header(view, "Group")).toHaveAttribute("aria-sort", "descending"),
    );
    expect(badge(view, "Group")).toBeNull(); // single entry → no badge

    fireEvent.click(header(view, "Score"), { shiftKey: true });
    await waitFor(() => expect(badge(view, "Group")?.textContent).toBe("1"));
    expect(badge(view, "Score")?.textContent).toBe("2");
    expect(badge(view, "Name")).toBeNull();

    fireEvent.click(header(view, "Name"), { shiftKey: true });
    await waitFor(() => expect(badge(view, "Name")?.textContent).toBe("3"));
    expect(badge(view, "Group")?.textContent).toBe("1");
    expect(badge(view, "Score")?.textContent).toBe("2");
    expect(badge(view, "Name")?.textContent).toBe("3");

    // Remove the first entry (desc → asc → removed); badge numbers shift.
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    await waitFor(() =>
      expect(header(view, "Group")).toHaveAttribute("aria-sort", "ascending"),
    );
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    await waitFor(() => expect(badge(view, "Group")).toBeNull());
    expect(badge(view, "Score")?.textContent).toBe("1");
    expect(badge(view, "Name")?.textContent).toBe("2");

    // Down to a single entry → badge disappears.
    fireEvent.click(header(view, "Score"), { shiftKey: true });
    await waitFor(() =>
      expect(header(view, "Score")).toHaveAttribute("aria-sort", "ascending"),
    );
    fireEvent.click(header(view, "Score"), { shiftKey: true });
    await waitFor(() => expect(badge(view, "Score")).toBeNull());
    expect(badge(view, "Name")).toBeNull();
  });

  it("controlled state.sort renders both indicators and stays pinned when onSortChange is ignored", () => {
    const controlled: PretableSortEntry[] = [
      { columnId: "group", direction: "desc" },
      { columnId: "score", direction: "asc" },
    ];
    const view = renderGrid({ state: { sort: controlled } });

    expect(header(view, "Group")).toHaveAttribute("aria-sort", "descending");
    expect(header(view, "Score")).toHaveAttribute("aria-sort", "ascending");
    expect(badge(view, "Group")?.textContent).toBe("1");
    expect(badge(view, "Score")?.textContent).toBe("2");
    // group desc, then score asc within groups.
    expect(rowIds(view)).toEqual(["r4", "r1", "r2", "r3"]);

    // Consumer ignores the change → engine snaps back to the prop.
    fireEvent.click(header(view, "Name"));
    expect(header(view, "Name")).toHaveAttribute("aria-sort", "none");
    expect(header(view, "Group")).toHaveAttribute("aria-sort", "descending");
    expect(header(view, "Score")).toHaveAttribute("aria-sort", "ascending");
    expect(rowIds(view)).toEqual(["r4", "r1", "r2", "r3"]);

    fireEvent.click(header(view, "Group"), { shiftKey: true });
    expect(header(view, "Group")).toHaveAttribute("aria-sort", "descending");
    expect(rowIds(view)).toEqual(["r4", "r1", "r2", "r3"]);
  });

  it("ignores plain and shift clicks on a sortable: false column", () => {
    const onSortChange = vi.fn();
    const view = renderGrid({ onSortChange });

    fireEvent.click(header(view, "Locked"));
    expect(onSortChange).not.toHaveBeenCalled();
    expect(header(view, "Locked")).toHaveAttribute("aria-sort", "none");
    expect(rowIds(view)).toEqual(["r1", "r2", "r3", "r4"]);

    fireEvent.click(header(view, "Locked"), { shiftKey: true });
    expect(onSortChange).not.toHaveBeenCalled();
    expect(header(view, "Locked")).toHaveAttribute("aria-sort", "none");

    // Shift-click with an existing list also leaves the list untouched.
    fireEvent.click(header(view, "Group"), { shiftKey: true });
    onSortChange.mockClear();
    fireEvent.click(header(view, "Locked"), { shiftKey: true });
    expect(onSortChange).not.toHaveBeenCalled();
    expect(header(view, "Group")).toHaveAttribute("aria-sort", "descending");
  });
});
