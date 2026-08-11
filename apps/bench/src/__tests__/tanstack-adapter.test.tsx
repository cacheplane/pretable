import { act, render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";

import { TanstackAdapter } from "../tanstack-adapter";
import type { ApplyBenchUpdates } from "../bench-runtime";
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
    { id: "5", status: "running-late" },
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

function sortPlan(columnId: string): BenchInteractionPlan {
  return {
    focusedRowId: null,
    filters: {},
    mode: "sort",
    probeColumnId: columnId,
    resultRowCount: 0,
    rows: [],
    rowGroups: [],
    selectedRowId: null,
    sort: [{ columnId, direction: "desc" }],
  };
}

function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-tanstack-row]")).map(
    (row) => row.getAttribute("data-row-id") ?? "",
  );
}

beforeAll(() => {
  // jsdom doesn't ship ResizeObserver and reports zero offsetWidth /
  // offsetHeight for every element. @tanstack/react-virtual reads
  // offsetWidth/offsetHeight to size the scroll element on first measure,
  // so without a shim the virtualizer collapses to an empty viewport and
  // never emits virtual rows. We override both for the bench viewport so
  // the smoke test can verify our row/cell selectors.
  if (!("ResizeObserver" in globalThis)) {
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (
      globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }
    ).ResizeObserver = StubResizeObserver;
  }
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      if (this.hasAttribute?.("data-pretable-bench-tanstack-viewport"))
        return 720;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      if (this.hasAttribute?.("data-pretable-bench-tanstack-viewport"))
        return 320;
      return 0;
    },
  });
});

describe("TanstackAdapter", () => {
  test("mounts and exposes selector data attributes", async () => {
    const { container } = render(
      <TanstackAdapter dataset={dataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(container.querySelector("header p")?.textContent).toBe(
        "TanStack Table v9",
      );
      expect(
        container.querySelector("[data-pretable-bench-tanstack-viewport]"),
      ).not.toBeNull();
      expect(
        container.querySelectorAll("[data-tanstack-row]").length,
      ).toBeGreaterThan(0);
      expect(
        container.querySelectorAll("[data-tanstack-cell]").length,
      ).toBeGreaterThan(0);
      const firstRow = container.querySelector("[data-tanstack-row]");
      expect(firstRow?.getAttribute("data-row-id")).toBe("1");
      expect(firstRow?.getAttribute("data-row-index")).toBe("0");
    });
  });

  test("applies a descending sort and publishes display-order row indices", async () => {
    const { container, rerender } = render(
      <TanstackAdapter
        dataset={dataset as never}
        runKey={0}
        scriptName="sort"
        interactionPlan={null}
      />,
    );

    rerender(
      <TanstackAdapter
        dataset={dataset as never}
        runKey={0}
        scriptName="sort"
        interactionPlan={sortPlan("name")}
      />,
    );

    await waitFor(() => {
      expect(renderedRowIds(container)).toEqual(["2", "1"]);
      expect(
        Array.from(container.querySelectorAll("[data-tanstack-row]")).map(
          (row) => row.getAttribute("data-row-index"),
        ),
      ).toEqual(["0", "1"]);
    });
  });

  test("publishes the post-filter row count, not the full dataset size", async () => {
    const { container, rerender } = render(
      <TanstackAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={null}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector("[data-pretable-bench-tanstack-viewport]"),
      ).not.toBeNull();
    });

    rerender(
      <TanstackAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-metadata"
        interactionPlan={filterPlan("filter-metadata", {
          status: { operator: "contains", value: "running" },
        })}
      />,
    );

    // status === "running" matches 2 of 5 rows. The published count comes from
    // table.getRowModel().rows (post-filter), not the full dataset size.
    await waitFor(() => {
      const section = container.querySelector(
        '[data-benchmark-adapter="tanstack"]',
      );
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("2");
    });
  });

  test("uses substring matching for text filters", async () => {
    const { container, rerender } = render(
      <TanstackAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-text"
        interactionPlan={null}
      />,
    );

    rerender(
      <TanstackAdapter
        dataset={statusDataset as never}
        runKey={0}
        scriptName="filter-text"
        interactionPlan={filterPlan("filter-text", {
          status: { operator: "contains", value: "run" },
        })}
      />,
    );

    await waitFor(() => {
      const section = container.querySelector(
        '[data-benchmark-adapter="tanstack"]',
      );
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("3");
      expect(renderedRowIds(container)).toEqual(["1", "3", "5"]);
    });
  });

  test("updates row data without changing the stable row id", async () => {
    let applyUpdates: ApplyBenchUpdates | undefined;
    const { container } = render(
      <TanstackAdapter
        dataset={dataset as never}
        runKey={0}
        onUpdateApiReady={(apply) => {
          applyUpdates = apply;
        }}
      />,
    );

    await waitFor(() => {
      expect(applyUpdates).toBeDefined();
      expect(
        container.querySelector('[data-tanstack-row][data-row-id="1"]'),
      ).not.toBeNull();
    });

    await act(async () => {
      await applyUpdates?.([{ id: "1", name: "Omega" }]);
    });

    await waitFor(() => {
      const updatedRow = container.querySelector(
        '[data-tanstack-row][data-row-id="1"]',
      );
      expect(updatedRow?.getAttribute("data-row-id")).toBe("1");
      expect(updatedRow?.textContent).toContain("Omega");
    });
  });
});
