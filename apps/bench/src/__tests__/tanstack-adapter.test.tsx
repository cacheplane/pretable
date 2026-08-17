import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

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

// Two columns, one of them wrapping — the shape scenario S2
// ("wrap-auto-height", wrapped_columns: 3) produces, scaled down.
const wrappedDataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "notes", header: "Notes", wrap: true, widthPx: 220 },
  ],
  rows: [
    { id: "1", notes: "a note long enough that it has to wrap onto two lines" },
    { id: "2", notes: "another note that also wraps onto more than one line" },
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

const MEASURED_ROW_HEIGHT = 96;
const ESTIMATED_ROW_HEIGHT = 48;

let baseOffsetHeight: PropertyDescriptor | undefined;
let rowHeightsStubbed = false;

/**
 * jsdom reports zero offsetHeight for every element, and the `beforeAll` below
 * pins that to 0 for everything but the viewport. `@tanstack/virtual-core`'s
 * default `measureElement` reads `element.offsetHeight`, so without this a
 * measured row measures 0 and "measurement is wired up" is indistinguishable
 * from "measurement reported nothing".
 *
 * Report a taller-than-estimate height for adapter rows ONLY, so a measured
 * row is distinguishable from an estimated one by its neighbour's offset: with
 * measurement wired up row 1 sits at MEASURED_ROW_HEIGHT, without it at
 * ESTIMATED_ROW_HEIGHT. Both the wrapped and the unwrapped test run under this
 * same stub — the difference in outcome comes from the adapter, not the
 * fixture.
 */
function stubRowHeights() {
  // Captured on first use, i.e. after `beforeAll` has installed the bench
  // viewport's offsetHeight getter, so restoring puts that one back.
  baseOffsetHeight ??= Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  const base = baseOffsetHeight;
  rowHeightsStubbed = true;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute?.("data-tanstack-row")) return MEASURED_ROW_HEIGHT;
      return (base?.get?.call(this) as number | undefined) ?? 0;
    },
  });
}

function rowTops(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-tanstack-row]"),
  ).map((row) => row.style.top);
}

function cellStyles(row: HTMLElement) {
  return Array.from(
    row.querySelectorAll<HTMLElement>("[data-tanstack-cell]"),
  ).map((cell) => ({
    overflow: cell.style.overflow,
    overflowWrap: cell.style.overflowWrap,
    whiteSpace: cell.style.whiteSpace,
  }));
}

afterEach(() => {
  if (rowHeightsStubbed && baseOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      ...baseOffsetHeight,
      configurable: true,
    });
    rowHeightsStubbed = false;
  }
  vi.restoreAllMocks();
});

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

  test("a wrapped column drops the fixed row height and measures real heights", async () => {
    stubRowHeights();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <TanstackAdapter dataset={wrappedDataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-tanstack-row]").length,
      ).toBeGreaterThan(1);
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-tanstack-row]"),
    );

    // 1. Nothing pins the row to ROW_HEIGHT, so its content decides.
    for (const row of rows) expect(row.style.height).toBe("");

    // 2. The wrapping column's cell does not clip or nowrap; the unwrapped
    //    column in the SAME row still does.
    expect(cellStyles(rows[0])).toEqual([
      { overflow: "hidden", overflowWrap: "", whiteSpace: "nowrap" },
      { overflow: "", overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
    ]);

    // 3. Measurement is actually wired up: row 1 is laid out at the MEASURED
    //    height of row 0, not at the estimate. This also proves the
    //    virtualizer resolves the row index from the attribute the adapter
    //    emits — `indexFromElement` returns -1 (and `resizeItem` no-ops,
    //    leaving the estimate) when it cannot read the index.
    await waitFor(() => {
      expect(rowTops(container)).toEqual(["0px", `${MEASURED_ROW_HEIGHT}px`]);
    });

    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes("Missing attribute name"),
      ),
    ).toEqual([]);
  });

  test("a dataset with no wrapped column keeps the fixed-height nowrap layout", async () => {
    // Same row-rect stub as the wrapped test: if measurement were enabled
    // unconditionally, row 1 would move to MEASURED_ROW_HEIGHT here too.
    stubRowHeights();

    const { container } = render(
      <TanstackAdapter dataset={dataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-tanstack-row]").length,
      ).toBeGreaterThan(1);
    });

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-tanstack-row]"),
    );

    for (const row of rows) {
      expect(row.style.height).toBe(`${ESTIMATED_ROW_HEIGHT}px`);
      expect(cellStyles(row)).toEqual([
        { overflow: "hidden", overflowWrap: "", whiteSpace: "nowrap" },
        { overflow: "hidden", overflowWrap: "", whiteSpace: "nowrap" },
      ]);
    }

    expect(rowTops(container)).toEqual(["0px", `${ESTIMATED_ROW_HEIGHT}px`]);
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

// S2/S3/S7 set `pinned_left`, and every dataset column carries the resulting
// `pinned`. The leading columns are the pinned ones, contiguously, which is
// what makes the sticky offsets a running sum of the widths before them.
const pinnedDataset = {
  columns: [
    {
      id: "sticky",
      header: "Sticky",
      wrap: false,
      widthPx: 120,
      pinned: "left",
    },
    { id: "scrolling", header: "Scrolling", wrap: false, widthPx: 140 },
  ],
  rows: [{ id: "1", sticky: "stays", scrolling: "moves" }],
};

describe("TanstackAdapter column pinning", () => {
  /**
   * TanStack Table is headless: `columnPinningFeature` owns the pinning STATE
   * and `columnSizingFeature` the offsets, but the sticky CSS is always the
   * app's to write. So the adapter drives `position: sticky` / `left` off
   * `column.getIsPinned()` and `column.getStart("start")` rather than off the
   * dataset directly — that is what a TanStack user pinning columns actually
   * does, and it is TanStack's own bookkeeping the benchmark should be paying
   * for.
   *
   * Inline styles are a DOM fact, so jsdom can see them. Whether the cell then
   * STAYS PUT under a horizontal scroll is a layout fact, and is proved in
   * `apps/bench/tests/comparator-pinned-columns.spec.ts`.
   */
  test("makes a pinned column's cells sticky, and only those", async () => {
    const { container } = render(
      <TanstackAdapter dataset={pinnedDataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(
        container.querySelector('[data-column-id="sticky"]'),
      ).not.toBeNull();
    });

    const sticky = container.querySelector<HTMLElement>(
      '[data-tanstack-cell][data-column-id="sticky"]',
    );
    expect(sticky?.style.position).toBe("sticky");
    // First pinned column, so it sits flush against the viewport's left edge.
    expect(sticky?.style.left).toBe("0px");

    // The negative half: making every cell sticky would satisfy the above
    // while changing every `pinned_left: 0` scenario (S1, S4, S5, S6).
    const scrolling = container.querySelector<HTMLElement>(
      '[data-tanstack-cell][data-column-id="scrolling"]',
    );
    expect(scrolling).not.toBeNull();
    expect(scrolling?.style.position).toBe("");
    expect(scrolling?.style.left).toBe("");
  });

  test("pins nothing when the scenario pins nothing", async () => {
    const { container } = render(
      <TanstackAdapter dataset={dataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-column-id="name"]')).not.toBeNull();
    });

    for (const cell of container.querySelectorAll<HTMLElement>(
      "[data-tanstack-cell]",
    )) {
      expect(cell.style.position).toBe("");
    }
  });
});

// The `group` interaction script's shape: `rowGroups: ["col_5"]` (an owner
// column, cardinality 4 at every scale) with an "avg" aggregate on every
// numeric column — pretable's adapter attaches those deliberately so the
// aggregation stage is costed (`applyGroupAggregates`), and a comparator that
// groups WITHOUT aggregating would measure less work and flatter itself.
// Two owners and a numeric column here, so groups and their means are both
// assertable.
const groupableDataset = {
  columns: [
    { id: "col_0", header: "Message", wrap: false, widthPx: 140 },
    { id: "col_5", header: "Owner", wrap: false, widthPx: 140 },
    { id: "col_7", header: "Score", wrap: false, widthPx: 96 },
  ],
  rows: [
    { id: "r1", col_0: "a", col_5: "text-core", col_7: 10 },
    { id: "r2", col_0: "b", col_5: "text-core", col_7: 30 },
    { id: "r3", col_0: "c", col_5: "layout-core", col_7: 50 },
    { id: "r4", col_0: "d", col_5: "layout-core", col_7: 70 },
  ],
};

function groupPlan(): BenchInteractionPlan {
  return {
    focusedRowId: "r2",
    filters: {},
    mode: "group",
    probeColumnId: "col_5",
    resultRowCount: 6,
    rows: groupableDataset.rows as never,
    rowGroups: ["col_5"],
    selectedRowId: "r2",
    sort: [],
  };
}

describe("TanstackAdapter row grouping", () => {
  test("a group plan renders group rows, leaf rows, and computed aggregates", async () => {
    const { container } = render(
      <TanstackAdapter
        dataset={groupableDataset as never}
        runKey={0}
        scriptName="group"
        interactionPlan={groupPlan()}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-tanstack-group-row]").length,
      ).toBe(2);
    });

    // Group rows are rows to the harness: the settle signature and the row
    // walk read the same attributes off them as off leaves.
    const groupRows = [
      ...container.querySelectorAll<HTMLElement>("[data-tanstack-group-row]"),
    ];
    for (const row of groupRows) {
      expect(row.hasAttribute("data-tanstack-row")).toBe(true);
      expect(row.getAttribute("data-row-id")).toBeTruthy();
      expect(row.getAttribute("data-row-index")).toBeTruthy();
    }

    // All four leaves survive alongside the two groups...
    expect(container.querySelectorAll("[data-tanstack-row]").length).toBe(6);
    // ...and the published count is what the plan's arithmetic predicts
    // (leaves + one group row per distinct key), or the settle detector
    // refuses to complete the run against `plan.resultRowCount`.
    expect(
      container
        .querySelector("[data-benchmark-adapter]")
        ?.getAttribute("data-bench-result-row-count"),
    ).toBe("6");

    // The aggregation stage really ran: the group rows render the MEAN of
    // their numeric column, which forces the computation inside the measured
    // window exactly as pretable's formatAggregate does.
    const texts = groupRows.map((row) => row.textContent ?? "");
    expect(texts.some((t) => t.includes("20"))).toBe(true); // mean(10, 30)
    expect(texts.some((t) => t.includes("60"))).toBe(true); // mean(50, 70)
  });

  test("no plan means no grouping — the render is the ungrouped one", async () => {
    // The negative arm that protects every other scenario: registering the
    // grouping features must be inert until a plan asks for groups.
    const { container } = render(
      <TanstackAdapter dataset={groupableDataset as never} runKey={0} />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("[data-tanstack-row]").length).toBe(4);
    });

    expect(container.querySelectorAll("[data-tanstack-group-row]").length).toBe(
      0,
    );
    expect(
      container
        .querySelector("[data-benchmark-adapter]")
        ?.getAttribute("data-bench-result-row-count"),
    ).toBe("4");
  });
});
