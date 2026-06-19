import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MuiAdapter } from "../mui-adapter";
import type { BenchInteractionPlan } from "../interaction-plan";

const dataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "name", header: "Name", wrap: false, widthPx: 160 },
  ],
  rows: [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ],
};

const statusDataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "status", header: "Status", wrap: false, widthPx: 160 },
  ],
  rows: [
    { id: "1", status: "running" },
    { id: "2", status: "stopped" },
    { id: "3", status: "running" },
    { id: "4", status: "idle" },
  ],
};

function filterPlan(
  mode: "filter-metadata" | "filter-text",
  filters: BenchInteractionPlan["filters"],
): BenchInteractionPlan {
  return {
    focusedRowId: null,
    filters,
    mode,
    probeColumnId: Object.keys(filters)[0] ?? "",
    resultRowCount: 0,
    rows: [],
    selectedRowId: null,
    sort: null,
  };
}

describe("MuiAdapter", () => {
  test("mounts and renders MUI DataGrid public selectors", async () => {
    const { container } = render(
      <MuiAdapter dataset={dataset as never} runKey={0} />,
    );

    // Asserts on .MuiDataGrid-virtualScroller — the same selector the
    // bench-runtime profile uses as the viewport — to catch class-name
    // drift on minor MUI bumps. If a future MUI release stops mounting
    // the virtual scroller in jsdom (no real layout), fall back to
    // .MuiDataGrid-root and document the limitation. As of @mui/x-data-grid@7
    // the scroller node is present even without layout.
    await waitFor(() => {
      expect(
        container.querySelector(".MuiDataGrid-virtualScroller"),
      ).not.toBeNull();
      expect(container.querySelector(".MuiDataGrid-root")).not.toBeNull();
    });
  });

  test("publishes the post-filter row count, not the full dataset size", async () => {
    const { container, rerender } = render(
      <MuiAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".MuiDataGrid-root")).not.toBeNull();
    });

    rerender(
      <MuiAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={filterPlan("filter-metadata", {
          status: { operator: "contains", value: "running" },
        })}
      />,
    );

    // status === "running" matches 2 of 4 rows. The published count is sourced
    // from the grid's filtered-row selector, not the full dataset size.
    await waitFor(() => {
      const section = container.querySelector('[data-benchmark-adapter="mui"]');
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("2");
    });
  });
});
