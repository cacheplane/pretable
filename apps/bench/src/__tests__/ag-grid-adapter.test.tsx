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

// S2 ("wrap-auto-height") shape: some columns carry `wrap: true`, the rest
// `wrap: false`. Both kinds must be present in one dataset so a single mount
// proves the flags are gated on `wrap` rather than applied unconditionally.
const wrapDataset = {
  columns: [
    { id: "plain", header: "Plain", wrap: false, widthPx: 140 },
    { id: "wrapped", header: "Wrapped", wrap: true, widthPx: 220 },
  ],
  rows: [
    { id: "1", plain: "short", wrapped: "a much longer sentence that wraps" },
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

  test("carries the wrap colDef onto the right cells, and only those", async () => {
    // READ THIS BEFORE TRUSTING THIS TEST. Everything asserted here is a
    // *class or attribute* that AG Grid toggles straight off the colDef —
    // `CellCtrl.applyStaticCssClasses` reads `column.isAutoHeight()` and
    // `setWrapText` reads `colDef.wrapText`. jsdom has no layout engine, so it
    // cannot tell whether any of it changed a pixel: `getBoundingClientRect()`
    // returns zeros and `scrollHeight` is always 0. This test passed unchanged
    // while AG Grid was laying every wrapped line out at 39px of leading and
    // painting every wrapped row at the fixed 48px `rowHeight`.
    //
    // What it IS good for: catching a colDef that stopped being emitted, or
    // being emitted for the wrong columns, cheaply and in the unit layer.
    // The pixels are proved in `apps/bench/tests/ag-grid-wrap-auto-height.spec.ts`,
    // which runs in real Chromium and fails if any of the three colDef fields
    // below is dropped.
    //
    // AG Grid needs all three and they are independent: `wrapText` toggles
    // `.ag-cell-wrap-text` (white-space: normal, overriding the base
    // `.ag-cell { white-space: nowrap }`); `autoHeight` toggles
    // `.ag-cell-auto-height` and enrolls the cell in row-height measurement;
    // and `cellStyle` releases the line-height from the row height, which AG
    // Grid's theme otherwise uses as the leading for every wrapped line.
    const { container } = render(
      <AgGridAdapter dataset={wrapDataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('.ag-cell[col-id="wrapped"]'),
      ).not.toBeNull();
    });

    const wrapped = container.querySelector<HTMLElement>(
      '.ag-cell[col-id="wrapped"]',
    );
    expect(wrapped?.classList.contains("ag-cell-wrap-text")).toBe(true);
    expect(wrapped?.classList.contains("ag-cell-auto-height")).toBe(true);
    // `cellStyle` lands as an inline style, which is a DOM fact rather than a
    // layout one, so jsdom can see it — it just cannot see what it does.
    expect(wrapped?.style.lineHeight).toBe("1.5");

    // The negative half is the load-bearing one: setting the flags
    // unconditionally would pass the assertions above while silently changing
    // every `wrapped_columns: 0` scenario (S1 etc.) out from under its
    // baseline.
    const plain = container.querySelector<HTMLElement>(
      '.ag-cell[col-id="plain"]',
    );
    expect(plain).not.toBeNull();
    expect(plain?.classList.contains("ag-cell-wrap-text")).toBe(false);
    expect(plain?.classList.contains("ag-cell-auto-height")).toBe(false);
    expect(plain?.style.lineHeight).toBe("");
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
