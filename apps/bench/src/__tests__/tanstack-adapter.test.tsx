import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";

import { TanstackAdapter } from "../tanstack-adapter";
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
  filters: Record<string, string>,
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
      expect(
        container.querySelector("[data-pretable-bench-tanstack-viewport]"),
      ).not.toBeNull();
      expect(
        container.querySelectorAll("[data-tanstack-row]").length,
      ).toBeGreaterThan(0);
      expect(
        container.querySelectorAll("[data-tanstack-cell]").length,
      ).toBeGreaterThan(0);
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
        interactionPlan={filterPlan("filter-metadata", { status: "running" })}
      />,
    );

    // status === "running" matches 2 of 4 rows. The published count comes from
    // table.getRowModel().rows (post-filter), not the full dataset size.
    await waitFor(() => {
      const section = container.querySelector(
        '[data-benchmark-adapter="tanstack"]',
      );
      expect(section?.getAttribute("data-bench-result-row-count")).toBe("2");
    });
  });
});
