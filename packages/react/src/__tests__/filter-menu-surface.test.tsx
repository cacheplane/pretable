import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { ColumnFilter } from "@pretable/core";
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
};

const columns: PretableColumn<Bug>[] = [
  { id: "title", header: "Title", widthPx: 200, filterType: "text" },
  {
    id: "severity",
    header: "Severity",
    widthPx: 140,
    filterType: "enum",
  },
  { id: "count", header: "Count", widthPx: 120, filterType: "number" },
  // Non-filterable column: no funnel should render.
  {
    id: "internal",
    header: "Internal",
    widthPx: 120,
    filterable: false,
  },
];

const rows: Bug[] = [
  { id: "b1", title: "alpha crash", severity: "high", count: 3 },
  { id: "b2", title: "beta hang", severity: "low", count: 7 },
  { id: "b3", title: "alpha leak", severity: "high", count: 1 },
];

const getRowId = (row: Bug) => row.id;

function renderSurface(
  extra: Partial<React.ComponentProps<typeof PretableSurface<Bug>>> = {},
) {
  return render(
    <PretableSurface<Bug>
      ariaLabel="Bug grid"
      columns={columns}
      getRowId={getRowId}
      overscan={0}
      rows={rows}
      viewportHeight={300}
      {...extra}
    />,
  );
}

describe("PretableSurface — built-in filter funnel", () => {
  it("renders a funnel for filterable columns and omits it for filterable:false", () => {
    const view = renderSurface();

    expect(view.getByRole("button", { name: "Filter Title" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Filter Severity" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Filter Count" })).toBeTruthy();
    expect(
      view.queryByRole("button", { name: "Filter Internal" }),
    ).toBeNull();

    // Sanity: every funnel carries the stable hooks.
    const funnels = view.container.querySelectorAll(
      "[data-pretable-filter-funnel]",
    );
    expect(funnels.length).toBe(3);
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
    // Slot is a direct child of the header row (a flat sibling of the header
    // cells / resize handles), and the funnel button lives inside the slot.
    expect(slot.parentElement).toBe(headerRow);
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
    // The sort header still reads "Sort" (no direction applied).
    expect(
      view.getByRole("columnheader", { name: "Sort Title" }),
    ).toHaveTextContent("Sort");
  });

  it("typing into a text filter narrows the rows and fires onFiltersChange", async () => {
    vi.useFakeTimers();
    const onFiltersChange = vi.fn();
    const view = renderSurface({ onFiltersChange });

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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(onFiltersChange).toHaveBeenCalled();
    const lastFilters = onFiltersChange.mock.lastCall?.[0] as Record<
      string,
      ColumnFilter
    >;
    expect(lastFilters.title).toEqual({ operator: "contains", value: "alpha" });

    // Rows narrowed to the two "alpha" titles.
    const ids = view
      .getAllByTestId("pretable-row")
      .map((r) => r.getAttribute("data-pretable-row-id"));
    expect(ids).toEqual(["b1", "b3"]);
  });

  it("enum options come from distinctColumnValues when filterOptions is absent", () => {
    const view = renderSurface();

    fireEvent.click(view.getByRole("button", { name: "Filter Severity" }));
    const dialog = view.getByRole("dialog", { name: "Filter Severity" });
    const group = within(dialog).getByRole("group");
    const labels = within(group)
      .getAllByRole("checkbox")
      .map((cb) => cb.closest("label")?.textContent?.trim());

    // Distinct values across the rows: "high" and "low".
    expect(new Set(labels)).toEqual(new Set(["high", "low"]));
  });

  it("checking enum values fires onFiltersChange and narrows rows", () => {
    const onFiltersChange = vi.fn();
    const view = renderSurface({ onFiltersChange });

    fireEvent.click(view.getByRole("button", { name: "Filter Severity" }));
    const dialog = view.getByRole("dialog", { name: "Filter Severity" });
    const highCheckbox = within(dialog)
      .getAllByRole("checkbox")
      .find((cb) => cb.closest("label")?.textContent?.includes("high"))!;

    fireEvent.click(highCheckbox);

    const lastFilters = onFiltersChange.mock.lastCall?.[0] as Record<
      string,
      ColumnFilter
    >;
    expect(lastFilters.severity).toEqual({
      operator: "isAnyOf",
      value: ["high"],
    });
    const ids = view
      .getAllByTestId("pretable-row")
      .map((r) => r.getAttribute("data-pretable-row-id"));
    expect(ids).toEqual(["b1", "b3"]);
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

  it("Clear resets the filter and fires onFiltersChange with the column removed", () => {
    const onFiltersChange = vi.fn();
    const view = renderSurface({
      onFiltersChange,
      state: undefined,
    });

    // Open + apply a text filter first (immediate via enum-free path uses
    // debounce; instead clear from a hydrated controlled-less state by typing).
    fireEvent.click(view.getByRole("button", { name: "Filter Severity" }));
    const dialog = view.getByRole("dialog", { name: "Filter Severity" });
    const highCheckbox = within(dialog)
      .getAllByRole("checkbox")
      .find((cb) => cb.closest("label")?.textContent?.includes("high"))!;
    fireEvent.click(highCheckbox);
    expect(view.getAllByTestId("pretable-row")).toHaveLength(2);

    // Clear.
    fireEvent.click(within(dialog).getByText("Clear"));
    const lastFilters = onFiltersChange.mock.lastCall?.[0] as Record<
      string,
      ColumnFilter
    >;
    expect(lastFilters.severity).toBeUndefined();
    expect(view.getAllByTestId("pretable-row")).toHaveLength(3);
  });
});
