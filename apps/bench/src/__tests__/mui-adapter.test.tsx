import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { gridClasses } from "@mui/x-data-grid";

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

// Mirrors an S2-shaped scenario: at least one column with `wrap: true`.
// `packages/scenario-data` sets `wrap: index < scenario.wrapped_columns`, so a
// wrapped prefix followed by unwrapped columns is the real shape.
const wrappedDataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "notes", header: "Notes", wrap: true, widthPx: 220 },
  ],
  rows: [
    { id: "1", notes: "Alpha beta gamma delta epsilon zeta eta theta" },
    { id: "2", notes: "Iota kappa lambda mu nu xi omicron pi rho sigma" },
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
  mode: "filter-metadata" | "filter-text" | "filter-keystrokes",
  filters: BenchInteractionPlan["filters"],
): BenchInteractionPlan {
  return {
    focusedRowId: null,
    collapsedGroupKey: null,
    collapsedGroupRowCount: 0,
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

  // Both directions are load-bearing. A positive-only assertion would still
  // pass if auto height were enabled unconditionally, which would silently
  // re-baseline every fixed-height scenario (S1 etc., `wrapped_columns: 0`).
  // Assertions read the computed style / class of the real rendered row and
  // cell, not the props we passed, so they also catch MUI dropping the
  // `row--dynamicHeight` whiteSpace override on a version bump.
  describe.each([
    {
      label: "a dataset with a wrapped column",
      data: wrappedDataset,
      dynamicHeight: true,
      whiteSpace: "normal",
      heightVar: "auto",
    },
    {
      label: "a dataset with no wrapped columns",
      data: dataset,
      dynamicHeight: false,
      whiteSpace: "nowrap",
      heightVar: "48px",
    },
  ])("$label", ({ data, dynamicHeight, whiteSpace, heightVar }) => {
    test(`renders rows with dynamicHeight=${String(dynamicHeight)}`, async () => {
      const { container } = render(
        <MuiAdapter dataset={data as never} runKey={0} />,
      );

      let row!: HTMLElement;
      await waitFor(() => {
        const found = container.querySelector<HTMLElement>(
          ".MuiDataGrid-row[data-id]",
        );
        expect(found).not.toBeNull();
        row = found!;
      });

      expect(row.classList.contains(gridClasses["row--dynamicHeight"])).toBe(
        dynamicHeight,
      );
      // The row's own height contract: `--height: auto` vs a pinned 48px.
      expect(row.style.getPropertyValue("--height")).toBe(heightVar);

      // The pixel that actually matters for the wedge: a cell that is
      // allowed to wrap. MUI's default is `white-space: nowrap`; the
      // `row--dynamicHeight > cell` rule overrides it to `initial`, which
      // computes to `normal`. No `sx` override of our own is involved.
      const cell = row.querySelector<HTMLElement>(".MuiDataGrid-cell");
      expect(cell).not.toBeNull();
      expect(getComputedStyle(cell!).whiteSpace).toBe(whiteSpace);
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

  test("applies a filter-keystrokes prefix with contains semantics", async () => {
    // "run" is a PREFIX: it matches only as a substring (2 of 4 rows), so this
    // fails both if the interaction effect ignores the keystroke mode (4 rows)
    // and if the operator degraded to "equals" (0 rows).
    const { container, rerender } = render(
      <MuiAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-keystrokes"
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
        scriptName="filter-keystrokes"
        interactionPlan={filterPlan("filter-keystrokes", {
          status: { operator: "contains", value: "run" },
        })}
      />,
    );

    await waitFor(() => {
      const section = container.querySelector('[data-benchmark-adapter="mui"]');
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("2");
    });
  });
});
