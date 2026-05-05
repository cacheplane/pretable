import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInspectionDataset,
  inspectionFilterableColumnIds,
} from "@pretable-internal/scenario-data";

import { InspectionGrid } from "../inspection-grid";

afterEach(() => {
  cleanup();
});

describe("InspectionGrid", () => {
  it("composes inspection-specific rendering, formatting, and filterable metadata on top of the labeled surface", () => {
    const dataset = createInspectionDataset("tiny");
    const onSelectedRowIdChange = vi.fn();
    const view = render(
      <InspectionGrid
        ariaLabel="Inspection grid"
        filterableColumnIds={inspectionFilterableColumnIds}
        onSelectedRowIdChange={onSelectedRowIdChange}
        overscan={0}
        rows={[...dataset.rows]}
        viewportHeight={132}
      />,
    );

    const timestampHeader = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });
    const firstRow = view.getAllByTestId("pretable-row")[0]!;
    const pinnedCell = within(firstRow)
      .getAllByText("Timestamp")[0]!
      .closest("[data-pretable-cell]");
    const tagsCell = within(firstRow)
      .getByText("cold-start, tenant-a")
      .closest("[data-pretable-cell]");

    expect(timestampHeader).toHaveClass("inspection-header-cell", "is-pinned");
    expect(timestampHeader).toHaveAttribute("data-pinned", "left");
    expect(timestampHeader).toHaveAttribute("data-filterable", "true");
    expect(firstRow).toHaveClass("inspection-row");
    expect(pinnedCell).toHaveClass("inspection-cell", "is-pinned");
    expect(pinnedCell).toHaveAttribute("data-filterable", "true");
    expect(tagsCell).toHaveClass("inspection-cell");
    expect(within(firstRow).getByText("cold-start, tenant-a")).toHaveClass(
      "inspection-cell-value",
    );

    fireEvent.click(view.getAllByTestId("pretable-row")[0]!);

    expect(onSelectedRowIdChange).toHaveBeenCalledWith("evt-001");
  }, 15_000);

  it("threads interactionState and onSortChange to the underlying surface", () => {
    const dataset = createInspectionDataset("tiny");
    const onSortChange = vi.fn();
    const view = render(
      <InspectionGrid
        ariaLabel="Inspection grid"
        filterableColumnIds={inspectionFilterableColumnIds}
        interactionState={{
          sort: null,
          filters: {},
        }}
        onSortChange={onSortChange}
        overscan={0}
        rows={[...dataset.rows]}
        viewportHeight={132}
      />,
    );

    const timestampHeader = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });

    fireEvent.click(timestampHeader);

    expect(onSortChange).toHaveBeenCalledWith({
      columnId: "timestamp",
      direction: "desc",
    });
  });

  it("preserves the shared row and cell DOM contract across inspection dataset scales", () => {
    const tiny = createInspectionDataset("tiny");
    const stress = createInspectionDataset("stress");
    const view = render(
      <InspectionGrid
        ariaLabel="Inspection grid"
        filterableColumnIds={tiny.filterableColumnIds}
        overscan={0}
        rows={[...tiny.rows]}
        viewportHeight={132}
      />,
    );

    expect(view.getAllByTestId("pretable-row")[0]).toHaveAttribute(
      "data-row-id",
      "evt-001",
    );

    view.rerender(
      <InspectionGrid
        ariaLabel="Inspection grid"
        filterableColumnIds={stress.filterableColumnIds}
        overscan={0}
        rows={[...stress.rows]}
        viewportHeight={132}
      />,
    );

    const firstStressRow = view.getAllByTestId("pretable-row")[0]!;

    expect(firstStressRow).toHaveAttribute("data-row-id", "evt-stress-0000");
    expect(
      firstStressRow.querySelector("[data-pretable-cell]"),
    ).toHaveAttribute("data-pretable-cell", "");
  });
});
