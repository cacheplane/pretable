import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AgGridAdapter } from "../ag-grid-adapter";
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
    rowGroups: [],
    selectedRowId: null,
    sort: [],
  };
}

describe("AgGridAdapter", () => {
  test("mounts and renders AG Grid public selectors", async () => {
    const { container } = render(
      <AgGridAdapter dataset={dataset as never} runKey={0} />,
    );

    // A smoke test that the grid mounts at all. The harness's own selectors
    // (.ag-grid-viewport / .ag-row / .ag-cell and the row-id/index attributes)
    // are held against this same real adapter in
    // comparator-dom-contract.test.tsx, which is what catches a library bump
    // moving them.
    await waitFor(() => {
      expect(container.querySelector(".ag-root-wrapper")).not.toBeNull();
    });
  });

  test("publishes the post-filter row count, not the full dataset size", async () => {
    // Mirror the bench: mount first, let the grid become ready, THEN apply the
    // interaction plan. (The flushSync timing in the adapter is what makes the
    // count land inside the bench's settle window in Chromium; this jsdom test
    // guards the onFilterChanged wiring and that the count is published.)
    const { container, rerender } = render(
      <AgGridAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".ag-root-wrapper")).not.toBeNull();
    });

    rerender(
      <AgGridAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={filterPlan("filter-metadata", {
          status: { operator: "contains", value: "running" },
        })}
      />,
    );

    // status === "running" matches 2 of 4 rows. Filtering is a pure
    // client-side row-model operation in AG Grid (no layout required), so the
    // displayed-row count must reflect the filter even in jsdom.
    await waitFor(() => {
      const section = container.querySelector(
        '[data-benchmark-adapter="ag-grid"]',
      );
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("2");
    });
  });
});
