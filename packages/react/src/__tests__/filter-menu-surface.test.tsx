import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isPretableFilterGroup, type ColumnFilter } from "@pretable/core";
import {
  PretableSurface,
  type PretableSurfaceProps,
} from "../pretable-surface";
import type { PretableColumn } from "../types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Bug = {
  id: string;
  title: string;
  severity: string;
  count: number;
  owner: string;
};

const columns: PretableColumn<Bug>[] = [
  { id: "title", header: "Title", widthPx: 200, type: "text" },
  {
    id: "severity",
    header: "Severity",
    widthPx: 140,
    type: "enum",
  },
  { id: "count", header: "Count", widthPx: 120, type: "number" },
  // Narrows its type's operator set — the only column here that does.
  {
    id: "owner",
    header: "Owner",
    widthPx: 140,
    type: "text",
    filterOperators: ["contains", "isEmpty"],
  },
  // Non-filterable column: no funnel should render.
  {
    id: "internal",
    header: "Internal",
    widthPx: 120,
    filterable: false,
  },
];

const rows: Bug[] = [
  { id: "b1", title: "alpha crash", severity: "high", count: 3, owner: "ana" },
  { id: "b2", title: "beta hang", severity: "low", count: 7, owner: "bo" },
  { id: "b3", title: "alpha leak", severity: "high", count: 1, owner: "ana" },
];

const getRowId = (row: Bug) => row.id;

interface TestOptions {
  state?: {
    filters?: Record<string, { operator: string; value?: unknown }>;
  };
  onSortChange?: (sort: readonly unknown[]) => void;
  onFiltersChange?: (
    filters: Record<string, { operator: string; value?: unknown }>,
  ) => void;
  onGridReady?: PretableSurfaceProps<Bug>["onGridReady"];
}

function renderSurface(extra: TestOptions = {}) {
  function Harness() {
    const controlledFilters = extra.state?.filters;
    const [query, setQuery] = React.useState(() => ({
      filters: Object.entries(controlledFilters ?? {}).map(
        ([columnId, filter]) => ({ columnId, ...filter }),
      ),
      sort: [],
      rowGroups: [],
    }));
    const effectiveQuery =
      controlledFilters === undefined
        ? query
        : {
            ...query,
            filters: Object.entries(controlledFilters).map(
              ([columnId, filter]) => ({ columnId, ...filter }),
            ),
          };
    return (
      <PretableSurface<Bug>
        ariaLabel="Bug grid"
        columns={columns}
        getRowId={getRowId}
        onGridReady={extra.onGridReady}
        overscan={0}
        rows={rows}
        query={effectiveQuery as never}
        onQueryChange={(next) => {
          if (controlledFilters === undefined) setQuery(next as typeof query);
          extra.onSortChange?.(next.sort);
          // This harness is LEAF-ONLY BY DESIGN: the suites below it drive the
          // per-column menu, which only ever writes top-level leaves. The
          // tree-shaped cases live in the "filter trees" describe at the foot
          // of this file and read `next.filters` unprojected.
          extra.onFiltersChange?.(
            Object.fromEntries(
              next.filters.flatMap((filter) =>
                isPretableFilterGroup(filter)
                  ? []
                  : [
                      [
                        filter.columnId,
                        {
                          operator: filter.operator,
                          ...("value" in filter ? { value: filter.value } : {}),
                        },
                      ] as const,
                    ],
              ),
            ),
          );
        }}
        viewportHeight={300}
      />
    );
  }
  return render(<Harness />);
}

describe("PretableSurface — built-in filter funnel", () => {
  it("renders a funnel for filterable columns and omits it for filterable:false", () => {
    const view = renderSurface();

    expect(view.getByRole("button", { name: "Filter Title" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Filter Severity" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Filter Count" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Filter Internal" })).toBeNull();

    // Sanity: every funnel carries the stable hooks.
    const funnels = view.container.querySelectorAll(
      "[data-pretable-filter-funnel]",
    );
    // Four filterable columns; `internal` is the one that opts out.
    expect(funnels.length).toBe(4);
  });

  /* A column whose `filterOperators` prunes the operator its filter is
     ACTUALLY using. The menu hydrates from the applied filter
     (`fromColumnFilter`), so the draft can hold an operator the permitted list
     does not contain — and a <select> whose value matches no option displays a
     different one. The menu would then name a filter it is not applying, and
     the applied one would be unreachable: choosing what is already displayed
     fires no change event. `menuOperators` is the module's answer, and the
     tool panel's leaf row reaches the same case by the same route. */
  it("keeps naming the applied operator when the column prunes it", () => {
    const view = renderSurface({
      state: {
        filters: {
          owner: { operator: "equals", value: "ana" } as ColumnFilter,
        },
      },
    });

    fireEvent.click(view.getByRole("button", { name: "Filter Owner" }));
    const dialog = view.getByRole("dialog", { name: "Filter Owner" });
    const select = dialog.querySelector<HTMLSelectElement>(
      "[data-pretable-filter-operator]",
    )!;

    expect(select.value).toBe("equals");
    // What it HOLDS and what it DISPLAYS are the same operator — the
    // assertion the value check alone does not make.
    expect(select.options[select.selectedIndex]?.value).toBe("equals");
    // The permitted pair plus the applied operator, in the type's own order;
    // everything else the column pruned stays pruned.
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "contains",
      "equals",
      "isEmpty",
    ]);
  });

  it("re-hydrates the dialog when switching directly between two open funnels", () => {
    // Regression: clicking a second column's funnel while one is open must
    // remount the menu so its draft re-hydrates from the new column's filter.
    // (The second funnel's pointerdown stops propagation, so the open menu's
    // outside-click never fires and the FilterMenu instance would be reused
    // unless it is keyed by columnId.)
    const view = renderSurface({
      state: {
        filters: {
          title: { operator: "endsWith", value: "crash" } as ColumnFilter,
          count: { operator: "gt", value: 5 } as ColumnFilter,
        },
      },
    });

    // Open Title → operator hydrates to its filter.
    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));
    let dialog = view.getByRole("dialog", { name: "Filter Title" });
    expect(
      dialog.querySelector<HTMLSelectElement>("[data-pretable-filter-operator]")
        ?.value,
    ).toBe("endsWith");

    // Click Count's funnel WHILE Title's menu is open → switch + re-hydrate.
    fireEvent.click(view.getByRole("button", { name: "Filter Count" }));
    dialog = view.getByRole("dialog", { name: "Filter Count" });
    expect(
      dialog.querySelector<HTMLSelectElement>("[data-pretable-filter-operator]")
        ?.value,
    ).toBe("gt");
    expect(
      dialog.querySelector<HTMLInputElement>("[data-pretable-filter-value]")
        ?.value,
    ).toBe("5");
  });

  it("nests funnels inside the header row so the CSS hover selector matches", () => {
    // The grid.css reveal rule is
    //   [data-pretable-header-row]:hover [data-pretable-filter-funnel]
    // (a DESCENDANT selector). Confirm the rendered DOM actually nests the
    // funnel button under the header row inside a funnel slot, so the selector
    // resolves against real markup rather than a guess.
    const view = renderSurface();
    const headerRow = view.container.querySelector(
      "[data-pretable-header-row]",
    )!;
    expect(headerRow).toBeTruthy();

    const slot = headerRow.querySelector("[data-pretable-filter-funnel-slot]")!;
    expect(slot).toBeTruthy();
    // The slot hangs off the column's overlay anchor, which is itself a direct
    // child of the header row (a sibling of the header cells, never nested in
    // one), and the funnel button lives inside the slot.
    const anchor = slot.parentElement!;
    expect(anchor).toHaveAttribute("data-pretable-header-overlays");
    expect(anchor.parentElement).toBe(headerRow);
    const funnel = slot.querySelector("[data-pretable-filter-funnel]")!;
    expect(funnel).toBeTruthy();
    expect(headerRow.contains(funnel)).toBe(true);
  });

  it("opens the dialog on funnel click, and closes on second click / Escape / outside-click", () => {
    const view = renderSurface();
    const funnel = view.getByRole("button", { name: "Filter Title" });

    expect(view.queryByRole("dialog")).toBeNull();

    // Open.
    fireEvent.click(funnel);
    expect(view.getByRole("dialog", { name: "Filter Title" })).toBeTruthy();
    expect(funnel).toHaveAttribute("aria-expanded", "true");

    // Second click toggles closed.
    fireEvent.click(funnel);
    expect(view.queryByRole("dialog")).toBeNull();

    // Reopen, then Escape closes (handled by useFilterPopover).
    fireEvent.click(funnel);
    expect(view.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("dialog")).toBeNull();

    // Reopen, then outside-click (pointerdown) closes (handled by FilterMenu).
    fireEvent.click(funnel);
    expect(view.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("closes on a real pointerdown+click on the open funnel", () => {
    // A real pointer interaction fires pointerdown BEFORE click, and the
    // existing toggle test above only fires click — so nothing covered the
    // realistic sequence. It matters: FilterMenu closes on any outside
    // pointerdown and the funnel sits outside the menu root, so an unguarded
    // pointerdown would close the menu and let the following click's toggle()
    // see no open menu and reopen it (a flicker that never closes). What
    // prevents that is FunnelButton's `onPointerDown` stopPropagation — remove
    // it and this test fails.
    const view = renderSurface();
    const funnel = view.getByRole("button", { name: "Filter Title" });

    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    expect(view.getByRole("dialog", { name: "Filter Title" })).toBeTruthy();

    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(funnel).toHaveAttribute("aria-expanded", "false");
  });

  it("switches menus on a real pointerdown+click on a different funnel", () => {
    const view = renderSurface();
    const title = view.getByRole("button", { name: "Filter Title" });
    const count = view.getByRole("button", { name: "Filter Count" });

    fireEvent.pointerDown(title);
    fireEvent.click(title);
    expect(view.getByRole("dialog", { name: "Filter Title" })).toBeTruthy();

    // A different column's funnel must switch, not close.
    fireEvent.pointerDown(count);
    fireEvent.click(count);
    expect(view.getByRole("dialog", { name: "Filter Count" })).toBeTruthy();
    expect(view.queryByRole("dialog", { name: "Filter Title" })).toBeNull();
  });

  it("clicking the funnel does not sort the column", () => {
    const onSortChange = vi.fn();
    const view = renderSurface({ onSortChange });

    const orderBefore = view
      .getAllByTestId("pretable-row")
      .map((r) => r.getAttribute("data-pretable-row-id"));

    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));

    expect(onSortChange).not.toHaveBeenCalled();
    const orderAfter = view
      .getAllByTestId("pretable-row")
      .map((r) => r.getAttribute("data-pretable-row-id"));
    expect(orderAfter).toEqual(orderBefore);
    // The sort header still shows no direction indicator.
    expect(
      view.getByRole("columnheader", { name: "Sort Title" }),
    ).toHaveAttribute("aria-sort", "none");
  });

  it("typing into a text filter narrows the rows and fires onFiltersChange", async () => {
    const onFiltersChange = vi.fn();
    let grid: Parameters<NonNullable<TestOptions["onGridReady"]>>[0] | null =
      null;
    const view = renderSurface({
      onFiltersChange,
      onGridReady: (ready) => {
        grid = ready;
      },
    });

    expect(view.getAllByTestId("pretable-row")).toHaveLength(3);

    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));
    const dialog = view.getByRole("dialog", { name: "Filter Title" });
    const valueInput = within(dialog).getByLabelText("Filter value");

    // Default text operator is "contains".
    act(() => {
      fireEvent.change(valueInput, { target: { value: "alpha" } });
    });

    // Text input is debounced (~200ms).
    expect(onFiltersChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onFiltersChange).toHaveBeenCalled());
    const lastFilters = onFiltersChange.mock.lastCall?.[0] as Record<
      string,
      ColumnFilter
    >;
    expect(lastFilters.title).toEqual({ operator: "contains", value: "alpha" });

    await expect
      .poll(() => grid?.rowModel.getState().snapshot.query.filters)
      .toEqual([{ columnId: "title", operator: "contains", value: "alpha" }]);

    // Rows narrowed to the two "alpha" titles.
    await waitFor(() => {
      const ids = view
        .getAllByTestId("pretable-row")
        .map((r) => r.getAttribute("data-pretable-row-id"));
      expect(ids).toEqual(["b1", "b3"]);
    });
  });

  it("loads enum options from the row model when options are absent", async () => {
    const view = renderSurface();

    fireEvent.click(view.getByRole("button", { name: "Filter Severity" }));
    const dialog = view.getByRole("dialog", { name: "Filter Severity" });
    const group = within(dialog).getByRole("group");
    const labels = (await within(group).findAllByRole("checkbox")).map((cb) =>
      cb.closest("label")?.textContent?.trim(),
    );

    // Distinct values across the rows: "high" and "low".
    expect(new Set(labels)).toEqual(new Set(["high", "low"]));
  });

  it("checking enum values fires onFiltersChange and narrows rows", async () => {
    const onFiltersChange = vi.fn();
    const view = renderSurface({ onFiltersChange });

    fireEvent.click(view.getByRole("button", { name: "Filter Severity" }));
    const dialog = view.getByRole("dialog", { name: "Filter Severity" });
    const highCheckbox = (await within(dialog).findAllByRole("checkbox")).find(
      (cb) => cb.closest("label")?.textContent?.includes("high"),
    )!;

    fireEvent.click(highCheckbox);

    const lastFilters = onFiltersChange.mock.lastCall?.[0] as Record<
      string,
      ColumnFilter
    >;
    expect(lastFilters.severity).toEqual({
      operator: "isAnyOf",
      value: ["high"],
    });
    await waitFor(() => {
      const ids = view
        .getAllByTestId("pretable-row")
        .map((r) => r.getAttribute("data-pretable-row-id"));
      expect(ids).toEqual(["b1", "b3"]);
    });
  });

  it("controlled state.filters lights the funnel active and hydrates the dialog", () => {
    const view = renderSurface({
      state: {
        filters: {
          title: { operator: "contains", value: "beta" },
        },
      },
    });

    // Only the matching row survives.
    const ids = view
      .getAllByTestId("pretable-row")
      .map((r) => r.getAttribute("data-pretable-row-id"));
    expect(ids).toEqual(["b2"]);

    // Funnel is marked active.
    const funnel = view.getByRole("button", { name: "Filter Title" });
    expect(funnel).toHaveAttribute("data-pretable-filter-active", "true");

    // Opening hydrates the dialog to the active operator/value.
    fireEvent.click(funnel);
    const dialog = view.getByRole("dialog", { name: "Filter Title" });
    expect(within(dialog).getByLabelText("Filter operator")).toHaveValue(
      "contains",
    );
    expect(within(dialog).getByLabelText("Filter value")).toHaveValue("beta");
  });

  it("renders the filter popover outside the contained scroll viewport", () => {
    const view = renderSurface();
    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));
    const dialog = view.getByRole("dialog", { name: "Filter Title" });
    // The viewport sets `contain: content`, which traps and clips fixed-position
    // descendants — the popover must be portaled out of that subtree.
    expect(dialog.closest("[data-pretable-scroll-viewport]")).toBeNull();
    expect(dialog.closest("body")).not.toBeNull();
  });

  it("Clear resets the filter and fires onFiltersChange with the column removed", async () => {
    const onFiltersChange = vi.fn();
    const view = renderSurface({
      onFiltersChange,
      state: undefined,
    });

    // Open + apply a text filter first (immediate via enum-free path uses
    // debounce; instead clear from a hydrated controlled-less state by typing).
    fireEvent.click(view.getByRole("button", { name: "Filter Severity" }));
    const dialog = view.getByRole("dialog", { name: "Filter Severity" });
    const highCheckbox = (await within(dialog).findAllByRole("checkbox")).find(
      (cb) => cb.closest("label")?.textContent?.includes("high"),
    )!;
    fireEvent.click(highCheckbox);
    await waitFor(() =>
      expect(view.getAllByTestId("pretable-row")).toHaveLength(2),
    );

    // Clear.
    fireEvent.click(within(dialog).getByText("Clear"));
    const lastFilters = onFiltersChange.mock.lastCall?.[0] as Record<
      string,
      ColumnFilter
    >;
    expect(lastFilters.severity).toBeUndefined();
    await waitFor(() =>
      expect(view.getAllByTestId("pretable-row")).toHaveLength(3),
    );
  });

  it("removes a menu-owned date filter when its input becomes incomplete", async () => {
    const onFiltersChange = vi.fn();
    type DateRow = { id: string; due: string };
    function DateHarness() {
      const [query, setQuery] = React.useState({
        filters: [
          { columnId: "due", operator: "on" as const, value: "2026-08-06" },
        ],
        sort: [],
        rowGroups: [],
      });
      return (
        <PretableSurface<DateRow>
          ariaLabel="Dates"
          columns={[
            { id: "due", header: "Due", type: "date", filterable: true },
          ]}
          getRowId={(row) => row.id}
          rows={[
            { id: "d1", due: "2026-08-06" },
            { id: "d2", due: "2026-08-07" },
          ]}
          query={query}
          onQueryChange={(next) => {
            setQuery(next as typeof query);
            onFiltersChange(next.filters);
          }}
          viewportHeight={200}
        />
      );
    }
    const view = render(<DateHarness />);
    expect(view.getAllByTestId("pretable-row")).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: "Filter Due" }));
    fireEvent.change(view.getByLabelText("Filter value"), {
      target: { value: "" },
    });

    expect(onFiltersChange).toHaveBeenLastCalledWith([]);
    await waitFor(() =>
      expect(view.getAllByTestId("pretable-row")).toHaveLength(2),
    );
  });
});

/**
 * SP2a: `query.filters` is an AND/OR TREE — each top-level element is either a
 * typed leaf or a group, and groups nest. These pin the three surface
 * behaviors the tree changes: the funnel lights on ANY occurrence of a column,
 * the menu owns only that column's TOP-LEVEL leaf, and a menu commit must
 * leave every group element it did not author untouched.
 */
describe("PretableSurface — filter trees", () => {
  type TreeNode = Record<string, unknown>;

  function renderTreeSurface(
    initialFilters: readonly TreeNode[],
    extra: {
      onQueryChange?: (query: { filters: readonly TreeNode[] }) => void;
      onGridReady?: PretableSurfaceProps<Bug>["onGridReady"];
    } = {},
  ) {
    function Harness() {
      const [query, setQuery] = React.useState(() => ({
        filters: initialFilters,
        sort: [],
        rowGroups: [],
      }));
      return (
        <PretableSurface<Bug>
          ariaLabel="Bug grid"
          columns={columns}
          getRowId={getRowId}
          onGridReady={extra.onGridReady}
          overscan={0}
          rows={rows}
          query={query as never}
          onQueryChange={(next) => {
            setQuery(next as never);
            extra.onQueryChange?.(next as never);
          }}
          viewportHeight={300}
        />
      );
    }
    return render(<Harness />);
  }

  const renderedRowIds = (view: ReturnType<typeof renderTreeSurface>) =>
    view
      .getAllByTestId("pretable-row")
      .map((r) => r.getAttribute("data-pretable-row-id"));

  it("carries a controlled tree to the model verbatim and joins it with OR", async () => {
    let grid: Parameters<NonNullable<TestOptions["onGridReady"]>>[0] | null =
      null;
    // Chosen so OR and AND disagree: under `or` this is b1 (count 3 > 2) and
    // b2 (title contains beta); under `and` it would be b2 alone.
    const tree = [
      {
        op: "or",
        children: [
          { columnId: "title", operator: "contains", value: "beta" },
          { columnId: "count", operator: "gt", value: 2 },
        ],
      },
    ];
    const view = renderTreeSurface(tree, {
      onGridReady: (ready) => {
        grid = ready;
      },
    });

    await expect
      .poll(() => grid?.rowModel.getState().snapshot.query.filters)
      .toEqual(tree);
    await waitFor(() => expect(renderedRowIds(view)).toEqual(["b1", "b2"]));
  });

  it("lights a column's funnel for a leaf buried two groups deep", async () => {
    const view = renderTreeSurface([
      {
        op: "and",
        children: [
          {
            op: "or",
            children: [
              { columnId: "title", operator: "contains", value: "alpha" },
            ],
          },
        ],
      },
    ]);

    // No top-level leaf mentions `title` at all — the old per-column record
    // projection would have keyed the group under `undefined` and left this
    // funnel dark.
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Filter Title" }),
      ).toHaveAttribute("data-pretable-filter-active", "true"),
    );
    // Control: a column the tree never mentions stays dark.
    expect(view.getByRole("button", { name: "Filter Count" })).toHaveAttribute(
      "data-pretable-filter-active",
      "false",
    );
  });

  it("hydrates the menu from the TOP-LEVEL leaf, not the nested one", () => {
    const view = renderTreeSurface([
      {
        op: "or",
        children: [
          { columnId: "title", operator: "contains", value: "nested" },
        ],
      },
      { columnId: "title", operator: "endsWith", value: "crash" },
    ]);

    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));
    const dialog = view.getByRole("dialog", { name: "Filter Title" });
    expect(within(dialog).getByLabelText("Filter operator")).toHaveValue(
      "endsWith",
    );
    expect(within(dialog).getByLabelText("Filter value")).toHaveValue("crash");
  });

  it("a menu commit splices the top-level leaf and leaves the group untouched", async () => {
    const group = {
      op: "or",
      children: [
        { columnId: "title", operator: "contains", value: "crash" },
        { columnId: "severity", operator: "isAnyOf", value: ["high"] },
      ],
    };
    const onQueryChange = vi.fn();
    let grid: Parameters<NonNullable<TestOptions["onGridReady"]>>[0] | null =
      null;
    const view = renderTreeSurface(
      [{ columnId: "title", operator: "contains", value: "alpha" }, group],
      {
        onQueryChange,
        onGridReady: (ready) => {
          grid = ready;
        },
      },
    );

    // The group as the MODEL holds it. `captureFilterNode` allocates and
    // freezes a fresh node on every capture, so this is a different object
    // from the `group` literal above — and it is the one the menu's write path
    // reads, because `setColumnFilter` builds its next query from
    // `currentQuery()`.
    const capturedGroup = await vi.waitUntil(
      () => grid?.rowModel.getState().snapshot.query.filters[1],
    );

    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));
    const dialog = view.getByRole("dialog", { name: "Filter Title" });
    act(() => {
      fireEvent.change(within(dialog).getByLabelText("Filter value"), {
        target: { value: "leak" },
      });
    });

    await waitFor(() => expect(onQueryChange).toHaveBeenCalled());
    const next = onQueryChange.mock.lastCall?.[0] as {
      filters: readonly TreeNode[];
    };
    // The leaf is REPLACED in place, and the group element the menu never
    // authored comes through in its original slot.
    expect(next.filters).toEqual([
      { columnId: "title", operator: "contains", value: "leak" },
      group,
    ]);
    // BYTE-IDENTICAL, with teeth: `onQueryChange` is handed the surface's own
    // `next` object BEFORE `rowModel.setQuery` re-captures it (see `setQuery`
    // in `pretable-model.ts`), so this element is literally the object
    // `withTopLevelColumnFilter` passed through — not a copy that merely
    // compares equal. A write path that rebuilt groups from a projection, or
    // cloned them defensively, would satisfy the `toEqual` above and fail
    // here.
    expect(next.filters[1]).toBe(capturedGroup);
  });

  it("clearing from the menu removes only the top-level leaf", async () => {
    const group = {
      op: "or",
      children: [
        { columnId: "severity", operator: "isAnyOf", value: ["high"] },
      ],
    };
    const onQueryChange = vi.fn();
    const view = renderTreeSurface(
      [{ columnId: "title", operator: "contains", value: "alpha" }, group],
      { onQueryChange },
    );

    fireEvent.click(view.getByRole("button", { name: "Filter Title" }));
    const dialog = view.getByRole("dialog", { name: "Filter Title" });
    fireEvent.click(within(dialog).getByText("Clear"));

    await waitFor(() => expect(onQueryChange).toHaveBeenCalled());
    const next = onQueryChange.mock.lastCall?.[0] as {
      filters: readonly TreeNode[];
    };
    expect(next.filters).toEqual([group]);
  });
});
