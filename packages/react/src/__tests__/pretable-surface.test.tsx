import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import * as rowHeight from "../row-height";
import { type PretableSurfaceState, usePretableModel } from "../use-pretable";
import type {
  PretableFocusState,
  PretableSelectionState,
} from "@pretable/core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type DemoRow = {
  id: string;
  timestamp: string;
  severity: string;
  tags: string[];
  message: string;
};

const columns = [
  {
    id: "timestamp",
    header: "Timestamp",
    pinned: "left" as const,
    widthPx: 188,
  },
  { id: "severity", header: "Severity", pinned: "left" as const, widthPx: 112 },
  {
    id: "tags",
    header: "Tags",
    widthPx: 200,
    getValue: (row: DemoRow) => row.tags.join(" / "),
  },
  { id: "message", header: "Message", wrap: true, widthPx: 320 },
];

const rows: DemoRow[] = [
  {
    id: "evt-001",
    timestamp: "2026-04-12T09:18:11Z",
    severity: "warn",
    tags: ["tenant-a", "cold-start"],
    message: "Short row",
  },
  {
    id: "evt-002",
    timestamp: "2026-04-12T09:18:44Z",
    severity: "error",
    tags: ["customer-facing", "timeout"],
    message: "Tall row",
  },
  {
    id: "evt-003",
    timestamp: "2026-04-12T09:19:03Z",
    severity: "info",
    tags: ["burst"],
    message: "Later row",
  },
];
const getDemoRowId = (row: DemoRow) => row.id;

describe("PretableSurface", () => {
  it("exposes renderer telemetry from usePretableModel for internal consumers", () => {
    function Harness() {
      const model = usePretableModel({
        columns,
        getRowId: getDemoRowId,
        overscan: 0,
        rows,
        viewportHeight: 132,
      });

      return (
        <output data-testid="telemetry">
          {JSON.stringify(model.telemetry)}
        </output>
      );
    }

    const view = render(<Harness />);
    const telemetry = JSON.parse(
      view.getByTestId("telemetry").textContent ?? "{}",
    ) as Record<string, unknown>;

    expect(telemetry).toMatchObject({
      rowModelRowCount: rows.length,
      renderedRowCount: expect.any(Number),
      selectedRowId: null,
      totalHeight: expect.any(Number),
      visibleRowCount: expect.any(Number),
      visibleRowRange: {
        end: expect.any(Number),
        start: expect.any(Number),
      },
    });
  });

  it("renders benchmark markers on the scrolling subtree, preserves viewport policy notes, and applies sticky pinned offsets", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const viewport = view.getByRole("grid", { name: "Inspection grid" });
    const scrollContent = viewport.querySelector(
      "[data-pretable-scroll-content]",
    );
    const renderedRows = view.getAllByTestId("pretable-row");
    const headerButton = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });
    const firstPinnedCell = renderedRows[0]?.querySelectorAll(
      "[data-pretable-cell]",
    )[0];
    const secondPinnedCell = renderedRows[0]?.querySelectorAll(
      "[data-pretable-cell]",
    )[1];

    expect(viewport).toHaveAttribute("data-pretable-scroll-viewport", "");
    expect(scrollContent).toBeTruthy();
    expect(renderedRows[0]).toHaveAttribute("data-pretable-row", "");
    expect(viewport).toHaveStyle({
      contain: "content",
      containIntrinsicSize: "auto 132px",
      contentVisibility: "auto",
      overflowAnchor: "none",
      overscrollBehavior: "contain",
    });
    expect(scrollContent).toHaveStyle({ height: "198px" });
    expect(renderedRows[0]).toHaveStyle({ top: "0px" });
    expect(firstPinnedCell).toHaveStyle({ position: "sticky", left: "0px" });
    expect(secondPinnedCell).toHaveStyle({ position: "sticky", left: "188px" });
    expect(headerButton).toHaveStyle({ position: "sticky", left: "0px" });
  });

  it("does not stack pinned and absolute header cells vertically (regression: backdrop-over-body)", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const pinnedHeader = view.getByRole("columnheader", {
      name: "Sort Timestamp",
    });
    const headerRow = pinnedHeader.parentElement!;
    const allHeaderButtons = view.getAllByRole("columnheader", {
      name: /^Sort /,
    });
    const absoluteHeader = view.getByRole("columnheader", {
      name: "Sort Tags",
    });

    expect(headerRow).toHaveStyle({ display: "flex" });
    expect(headerRow).toHaveStyle({ height: "52px" });

    for (const button of allHeaderButtons) {
      expect(button).toHaveStyle({ top: "0px" });
    }

    expect(pinnedHeader).toHaveStyle({ position: "sticky", left: "0px" });
    expect(absoluteHeader).toHaveStyle({ position: "absolute", top: "0px" });

    const firstRow = view.getAllByTestId("pretable-row")[0]!;
    expect(firstRow).toHaveStyle({ display: "flex" });
    const bodyCells = firstRow.querySelectorAll("[data-pretable-cell]");
    for (const cell of bodyCells) {
      expect(cell).toHaveStyle({ top: "0px" });
    }
    const pinnedBodyCell = bodyCells[0]!;
    const absoluteBodyCell = bodyCells[bodyCells.length - 1]!;
    expect(pinnedBodyCell).toHaveStyle({ position: "sticky" });
    expect(absoluteBodyCell).toHaveStyle({ position: "absolute" });
  });

  it("renders sort buttons that reflect sort state and dispatch sort changes", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const severityButton = view.getByRole("columnheader", {
      name: "Sort Severity",
    });

    expect(severityButton).toHaveTextContent("Sort");

    fireEvent.click(severityButton);

    expect(severityButton).toHaveTextContent("Newest");
    expect(
      view
        .getAllByTestId("pretable-row")
        .map((row) => row.getAttribute("data-row-id")),
    ).toEqual(["evt-001", "evt-003"]);

    fireEvent.click(severityButton);

    expect(severityButton).toHaveTextContent("Oldest");
    expect(
      view
        .getAllByTestId("pretable-row")
        .map((row) => row.getAttribute("data-row-id")),
    ).toEqual(["evt-002", "evt-003"]);
  });

  it("uses column accessors for body-cell content", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const firstRow = view.getAllByTestId("pretable-row")[0];

    expect(
      within(firstRow).getByText("tenant-a / cold-start"),
    ).toBeInTheDocument();
  });

  it("marks wrapped cells so row-height measurement can target them directly", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const firstRow = view.getAllByTestId("pretable-row")[0];
    const wrappedCell = firstRow?.querySelector('[data-column-id="message"]');

    expect(wrappedCell).toHaveAttribute("data-pretable-wrap", "true");
  });

  it("exposes focus and selection state and supports ArrowUp, ArrowDown, Enter, and Space keyboard navigation", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const viewport = view.getByRole("grid", { name: "Inspection grid" });

    fireEvent.keyDown(viewport, { key: "ArrowDown" });

    let renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[0]).toHaveAttribute("data-focused", "true");
    expect(
      renderedRows[0]?.querySelector("[data-pretable-cell]"),
    ).toHaveAttribute("data-focused", "true");

    fireEvent.keyDown(viewport, { key: "Enter" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[0]).toHaveAttribute("aria-selected", "true");
    expect(renderedRows[0]).toHaveAttribute("data-selected", "true");

    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "Space" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[1]).toHaveAttribute("data-focused", "true");
    expect(renderedRows[1]).toHaveAttribute("data-selected", "true");

    fireEvent.keyDown(viewport, { key: "ArrowUp" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[0]).toHaveAttribute("data-focused", "true");
  });

  it("can advance selection with arrow-key focus movement when configured", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        selectFocusedRowOnArrowKey
        viewportHeight={132}
      />,
    );

    const viewport = view.getByRole("grid", { name: "Inspection grid" });

    fireEvent.keyDown(viewport, { key: "ArrowDown" });

    let renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[0]).toHaveAttribute("data-focused", "true");
    expect(renderedRows[0]).toHaveAttribute("data-selected", "true");

    fireEvent.keyDown(viewport, { key: "ArrowDown" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[1]).toHaveAttribute("data-focused", "true");
    expect(renderedRows[1]).toHaveAttribute("data-selected", "true");
    expect(renderedRows[0]).toHaveAttribute("data-selected", "false");
  });

  it("emits selected row id changes for click and keyboard-driven selection", () => {
    const onSelectedRowIdChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        onSelectedRowIdChange={onSelectedRowIdChange}
        overscan={0}
        rows={rows}
        selectFocusedRowOnArrowKey
        viewportHeight={132}
      />,
    );

    fireEvent.click(view.getAllByTestId("pretable-row")[1]!);

    const viewport = view.getByRole("grid", { name: "Inspection grid" });
    fireEvent.keyDown(viewport, { key: "ArrowUp" });

    expect(onSelectedRowIdChange).toHaveBeenNthCalledWith(1, "evt-002");
    expect(onSelectedRowIdChange).toHaveBeenNthCalledWith(2, "evt-001");
  });

  it("reports internal telemetry without forcing DOM scraping in the parent surface", async () => {
    const onTelemetryChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        onTelemetryChange={onTelemetryChange}
        overscan={0}
        rows={rows}
        selectFocusedRowOnArrowKey
        viewportHeight={132}
      />,
    );

    await waitFor(() => {
      expect(onTelemetryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          renderedRowCount: expect.any(Number),
          selectedRowId: null,
          totalHeight: expect.any(Number),
          visibleRowCount: expect.any(Number),
          visibleRowRange: {
            end: expect.any(Number),
            start: expect.any(Number),
          },
        }),
      );
    });

    fireEvent.click(view.getAllByTestId("pretable-row")[1]!);

    await waitFor(() => {
      expect(onTelemetryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedRowId: "evt-002",
        }),
      );
    });
  });

  it("uses the body viewport height for row planning and telemetry when the header is sticky", async () => {
    const onTelemetryChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        onTelemetryChange={onTelemetryChange}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    await waitFor(() => {
      expect(onTelemetryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          renderedRowCount: 2,
          visibleRowCount: 2,
          visibleRowRange: {
            start: 0,
            end: 2,
          },
        }),
      );
    });

    expect(view.getAllByTestId("pretable-row")).toHaveLength(2);
    expect(view.queryByText("Later row")).not.toBeInTheDocument();
  });

  it("captures measured row heights from the row shell and feeds changed heights back into the render path", async () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          paddingTop: "10px",
          paddingBottom: "10px",
          borderBottomWidth: "1px",
        }) as CSSStyleDeclaration,
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function () {
        if (this.getAttribute("data-pretable-cell") === null) {
          return 0;
        }

        return this.textContent?.includes("Tall row") ? 120 : 22;
      },
    );

    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "141");
    });
  });

  it("remeasures a cached tall row when its wrapped content changes", async () => {
    const measureRenderedRowHeightSpy = vi.spyOn(
      rowHeight,
      "measureRenderedRowHeight",
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          paddingTop: "10px",
          paddingBottom: "10px",
          borderBottomWidth: "1px",
        }) as CSSStyleDeclaration,
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function () {
        if (this.getAttribute("data-pretable-cell") === null) {
          return 0;
        }

        if (this.textContent?.includes("Tall row v2")) {
          return 150;
        }

        if (this.textContent?.includes("Tall row")) {
          return 120;
        }

        return 22;
      },
    );

    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "141");
    });

    measureRenderedRowHeightSpy.mockClear();

    view.rerender(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows.map((row) =>
          row.id === "evt-002"
            ? {
                ...row,
                message: "Tall row v2",
              }
            : row,
        )}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "171");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-row-id") === "evt-002",
        ),
      ).not.toHaveLength(0);
    });
  });

  it("clears a stale tall cache when the same row shrinks back to default height", async () => {
    const measureRenderedRowHeightSpy = vi.spyOn(
      rowHeight,
      "measureRenderedRowHeight",
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          paddingTop: "10px",
          paddingBottom: "10px",
          borderBottomWidth: "1px",
        }) as CSSStyleDeclaration,
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function () {
        if (this.getAttribute("data-pretable-cell") === null) {
          return 0;
        }

        if (this.textContent?.includes("Tall row")) {
          return 120;
        }

        return 22;
      },
    );

    const shortRows = rows.map((row) =>
      row.id === "evt-002"
        ? {
            ...row,
            message: "Short row",
          }
        : row,
    );
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "141");
    });

    measureRenderedRowHeightSpy.mockClear();

    view.rerender(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={shortRows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const shortRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(shortRow).toHaveAttribute("data-row-height", "66");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-row-id") === "evt-002",
        ),
      ).not.toHaveLength(0);
    });
  });

  it("refreshes the cached measurement key when a same-height row class changes", async () => {
    const measureRenderedRowHeightSpy = vi.spyOn(
      rowHeight,
      "measureRenderedRowHeight",
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          paddingTop: "10px",
          paddingBottom: "10px",
          borderBottomWidth: "1px",
        }) as CSSStyleDeclaration,
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function () {
        if (this.getAttribute("data-pretable-cell") === null) {
          return 0;
        }

        return this.textContent?.includes("Tall row") ? 120 : 22;
      },
    );

    let rowClassName = "row-class-a";
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getBodyCellClassName={({ rowId }) => `cell-${rowId}`}
        getRowClassName={() => rowClassName}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "141");
    });

    measureRenderedRowHeightSpy.mockClear();
    rowClassName = "row-class-b";

    view.rerender(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getBodyCellClassName={({ rowId }) => `cell-${rowId}`}
        getRowClassName={() => rowClassName}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "141");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-row-id") === "evt-002",
        ),
      ).not.toHaveLength(0);
    });

    measureRenderedRowHeightSpy.mockClear();

    view.rerender(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getBodyCellClassName={({ rowId }) => `cell-${rowId}`}
        getRowClassName={() => rowClassName}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", "141");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-row-id") === "evt-002",
        ),
      ).toHaveLength(0);
    });
  });

  it("renders fewer cells than total columns when column count exceeds viewport width", () => {
    // Mock clientWidth for the viewport element since jsdom returns 0
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 1024;
      },
    });

    const manyColumns = Array.from({ length: 50 }, (_, i) => ({
      id: `col_${i}`,
      header: `Column ${i}`,
      widthPx: 140,
    }));
    const manyRows = [
      {
        id: "row-0",
        ...Object.fromEntries(manyColumns.map((c) => [c.id, `val-${c.id}`])),
      },
    ] as DemoRow[];

    const view = render(
      <PretableSurface
        ariaLabel="Wide grid"
        columns={manyColumns}
        getRowId={(row) => row.id}
        overscan={2}
        rows={manyRows}
        viewportHeight={132}
      />,
    );

    const renderedCells = view.container.querySelectorAll(
      "[data-pretable-cell]",
    );

    // 50 columns at 140px = 7000px total. With a default viewport, far fewer should render.
    expect(renderedCells.length).toBeLessThan(50);
    expect(renderedCells.length).toBeGreaterThan(0);
  });

  it("always renders pinned column cells even with column virtualization", () => {
    // Mock clientWidth for the viewport element since jsdom returns 0
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 1024;
      },
    });

    const wideColumns = [
      {
        id: "pinned_ts",
        header: "Timestamp",
        pinned: "left" as const,
        widthPx: 188,
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        id: `col_${i}`,
        header: `Column ${i}`,
        widthPx: 140,
      })),
    ];
    const wideRows = [
      {
        id: "row-0",
        ...Object.fromEntries(wideColumns.map((c) => [c.id, "val"])),
      },
    ] as DemoRow[];

    const view = render(
      <PretableSurface
        ariaLabel="Wide grid"
        columns={wideColumns}
        getRowId={(row) => row.id}
        overscan={2}
        rows={wideRows}
        viewportHeight={132}
      />,
    );

    const pinnedCells = view.container.querySelectorAll(
      '[data-column-id="pinned_ts"]',
    );

    // Should have at least 1 pinned cell (in the body) + 1 header
    expect(pinnedCells.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onSortChange when a column header is clicked", () => {
    const onSortChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        onSortChange={onSortChange}
        overscan={0}
        rows={rows}
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

    fireEvent.click(timestampHeader);

    expect(onSortChange).toHaveBeenCalledWith({
      columnId: "timestamp",
      direction: "asc",
    });

    fireEvent.click(timestampHeader);

    expect(onSortChange).toHaveBeenCalledWith(null);
  });

  it("does not remeasure a cached tall row height when a sort reorders the same rows", async () => {
    const measureRenderedRowHeightSpy = vi.spyOn(
      rowHeight,
      "measureRenderedRowHeight",
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          paddingTop: "10px",
          paddingBottom: "10px",
          borderBottomWidth: "1px",
        }) as CSSStyleDeclaration,
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function () {
        if (this.textContent?.includes("Tall row")) {
          return 120;
        }

        return 22;
      },
    );

    const expectedTallRowHeight = "141";
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={520}
      />,
    );

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", expectedTallRowHeight);
    });

    measureRenderedRowHeightSpy.mockClear();

    const severityButton = view.container.querySelector(
      'button[aria-label="Sort Severity"]',
    );
    expect(severityButton).not.toBeNull();

    fireEvent.click(severityButton!);

    await waitFor(() => {
      const tallRow = view
        .getAllByTestId("pretable-row")
        .find((row) => row.getAttribute("data-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-row-height", expectedTallRowHeight);
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-row-id") === "evt-002",
        ),
      ).toHaveLength(0);
    });
  });

  it("exposes data-pretable-header-row, data-pretable-header-cell, and data-pinned for theming", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Theming attribute grid"
        columns={columns}
        getRowId={getDemoRowId}
        overscan={0}
        rows={rows}
        viewportHeight={400}
      />,
    );

    const { container } = view;

    expect(
      container.querySelector("[data-pretable-header-row]"),
    ).not.toBeNull();

    const headerCells = container.querySelectorAll(
      "[data-pretable-header-cell]",
    );
    expect(headerCells.length).toBe(columns.length);
    // First two columns are pinned: left, third+ are not.
    expect(headerCells[0]?.getAttribute("data-pinned")).toBe("left");
    expect(headerCells[1]?.getAttribute("data-pinned")).toBe("left");
    expect(headerCells[2]?.getAttribute("data-pinned")).toBeNull();

    const bodyCells = container.querySelectorAll("[data-pretable-cell]");
    expect(bodyCells.length).toBeGreaterThan(0);
    const pinnedBodyCell = container.querySelector(
      '[data-pretable-cell][data-pinned="left"]',
    );
    expect(pinnedBodyCell).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 Task 5 — keyboard contract, controlled-mode round-trips, ARIA
// ---------------------------------------------------------------------------

type GridRow = { id: string; a: string; b: string; c: string };

const gridColumns = [
  { id: "a", header: "A", widthPx: 100 },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
];

const gridRows: GridRow[] = [
  { id: "r1", a: "a1", b: "b1", c: "c1" },
  { id: "r2", a: "a2", b: "b2", c: "c2" },
  { id: "r3", a: "a3", b: "b3", c: "c3" },
  { id: "r4", a: "a4", b: "b4", c: "c4" },
  { id: "r5", a: "a5", b: "b5", c: "c5" },
];

interface RenderHarnessOpts {
  initialState?: PretableSurfaceState;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
  tabBehavior?: "wrap-rows" | "exit";
  viewportHeight?: number;
}

function renderHarness(opts: RenderHarnessOpts = {}) {
  return render(
    <PretableSurface
      ariaLabel="test-grid"
      columns={gridColumns}
      getRowId={(row: GridRow) => row.id}
      onFocusChange={opts.onFocusChange}
      onSelectionChange={opts.onSelectionChange}
      overscan={0}
      rows={gridRows}
      state={opts.initialState}
      tabBehavior={opts.tabBehavior}
      viewportHeight={opts.viewportHeight ?? 300}
    />,
  );
}

/**
 * Seed focus uncontrolled by walking from a null-focus initial state through
 * a series of plain arrow keypresses. Plain arrow movement always resets the
 * selection to a single-cell range at the new focus and sets the anchor to
 * that same cell, so the resulting state is: focus=(rowId,columnId),
 * selection={(rowId,columnId)}, anchor=(rowId,columnId) — clean for
 * shift-extend assertions.
 */
function seedFocus(
  view: ReturnType<typeof render>,
  rowId: string,
  columnId: string,
) {
  const grid = view.getByRole("grid");
  const rowIndex = gridRows.findIndex((r) => r.id === rowId);
  const colIndex = gridColumns.findIndex((c) => c.id === columnId);
  if (rowIndex < 0 || colIndex < 0) {
    throw new Error(`unknown cell ${rowId}/${columnId}`);
  }

  // First ArrowDown from null focus lands at (r1, a). Each subsequent
  // ArrowDown advances one row; ArrowRight advances one column.
  for (let i = 0; i <= rowIndex; i += 1) {
    fireEvent.keyDown(grid, { key: "ArrowDown" });
  }
  for (let i = 0; i < colIndex; i += 1) {
    fireEvent.keyDown(grid, { key: "ArrowRight" });
  }
  return grid;
}

function getCell(
  view: ReturnType<typeof render>,
  rowId: string,
  colId: string,
) {
  return view.container.querySelector<HTMLDivElement>(
    `[data-pretable-row][data-row-id="${rowId}"] [data-column-id="${colId}"]`,
  );
}

function getFocusedCell(view: ReturnType<typeof render>) {
  return view.container.querySelector<HTMLDivElement>(
    '[data-pretable-cell][data-focused="true"]',
  );
}

function getSelectedCells(view: ReturnType<typeof render>) {
  return Array.from(
    view.container.querySelectorAll<HTMLDivElement>(
      '[data-pretable-cell][data-selected="true"]',
    ),
  );
}

describe("keyboard contract", () => {
  it("ArrowDown moves focus down one row", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-focused", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("tabIndex", "0");
  });

  it("ArrowUp moves focus up one row", () => {
    const view = renderHarness();
    seedFocus(view, "r3", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(getCell(view, "r2", "b")).toHaveAttribute("data-focused", "true");
  });

  it("ArrowRight moves focus right one column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(getCell(view, "r1", "b")).toHaveAttribute("data-focused", "true");
  });

  it("ArrowLeft moves focus left one column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(getCell(view, "r1", "b")).toHaveAttribute("data-focused", "true");
  });

  it("Shift+ArrowDown extends the selection range downward by one row", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({ onSelectionChange });
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });

    const selected = getSelectedCells(view);
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-selected", "true");
    // Other-column cells in those rows should NOT be selected
    expect(getCell(view, "r1", "b")).toHaveAttribute("data-selected", "false");
  });

  it("Shift+ArrowRight extends the selection range rightward by one column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });

    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r1", "b")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-selected", "false");
  });

  it("Cmd+ArrowDown jumps focus to last visible row", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown", metaKey: true });
    expect(getCell(view, "r5", "a")).toHaveAttribute("data-focused", "true");
  });

  it("Cmd+ArrowRight jumps focus to last column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight", metaKey: true });
    expect(getCell(view, "r1", "c")).toHaveAttribute("data-focused", "true");
  });

  it("Ctrl+ArrowUp jumps focus to first row (ctrl works as cmd alias)", () => {
    const view = renderHarness();
    seedFocus(view, "r5", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowUp", ctrlKey: true });
    expect(getCell(view, "r1", "b")).toHaveAttribute("data-focused", "true");
  });

  it("Cmd+Shift+ArrowDown extends range to last row", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, {
      key: "ArrowDown",
      metaKey: true,
      shiftKey: true,
    });
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r5", "a")).toHaveAttribute("data-selected", "true");
  });

  it("Home moves focus to first column in the current row", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Home" });
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-focused", "true");
  });

  it("End moves focus to last column in the current row", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "End" });
    expect(getCell(view, "r2", "c")).toHaveAttribute("data-focused", "true");
  });

  it("Cmd+Home moves focus to the first cell in the grid", () => {
    const view = renderHarness();
    seedFocus(view, "r4", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Home", metaKey: true });
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-focused", "true");
  });

  it("Cmd+End moves focus to the last cell in the grid", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "End", metaKey: true });
    expect(getCell(view, "r5", "c")).toHaveAttribute("data-focused", "true");
  });

  it("PageDown moves focus down by ~viewport rows", () => {
    // bodyViewportHeight ≈ 132 -> pageRowCount = floor(132/32) = 4
    const view = renderHarness({ viewportHeight: 600 });
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "PageDown" });
    const focused = getFocusedCell(view);
    const focusedRowId = focused
      ?.closest("[data-pretable-row]")
      ?.getAttribute("data-row-id");
    // PageDown should advance focus to a row strictly below r1 (and not past
    // the last row r5).
    expect(focusedRowId).not.toBe("r1");
    expect(["r2", "r3", "r4", "r5"]).toContain(focusedRowId);
  });

  it("PageUp moves focus up by ~viewport rows", () => {
    const view = renderHarness({ viewportHeight: 600 });
    seedFocus(view, "r5", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "PageUp" });
    const focused = getFocusedCell(view);
    const focusedRowId = focused
      ?.closest("[data-pretable-row]")
      ?.getAttribute("data-row-id");
    expect(focusedRowId).not.toBe("r5");
    expect(["r1", "r2", "r3", "r4"]).toContain(focusedRowId);
  });

  it("Shift+PageDown extends the selection range", () => {
    const view = renderHarness({ viewportHeight: 600 });
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "PageDown", shiftKey: true });

    // r1/a is the anchor and should remain selected; some row below should
    // also be selected as part of the extended range.
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    const r2sel = getCell(view, "r2", "a")?.getAttribute("data-selected");
    expect(r2sel).toBe("true");
  });

  it("Tab in middle of row moves focus to next column (default wrap-rows)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(getCell(view, "r2", "b")).toHaveAttribute("data-focused", "true");
  });

  it("Tab at end of row wraps to next row's first cell (wrap-rows)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(getCell(view, "r3", "a")).toHaveAttribute("data-focused", "true");
  });

  it("Shift+Tab moves focus left", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab", shiftKey: true });
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-focused", "true");
  });

  it("Shift+Tab at start of row wraps to previous row's last cell", () => {
    const view = renderHarness();
    seedFocus(view, "r3", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab", shiftKey: true });
    expect(getCell(view, "r2", "c")).toHaveAttribute("data-focused", "true");
  });

  it("Tab with tabBehavior=exit does NOT preventDefault and does not move focus", () => {
    const view = renderHarness({ tabBehavior: "exit" });
    seedFocus(view, "r2", "a");
    const grid = view.getByRole("grid");
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    grid.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    // Focus should still be at r2/a
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-focused", "true");
  });

  it("Tab with tabBehavior=wrap-rows DOES preventDefault", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "a");
    const grid = view.getByRole("grid");
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    grid.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Cmd+A selects every cell in the grid", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });

    const totalCells = gridRows.length * gridColumns.length;
    const selected = getSelectedCells(view);
    expect(selected.length).toBe(totalCells);
  });

  it("Esc collapses selection to a single cell at the focused cell", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });
    expect(getSelectedCells(view).length).toBeGreaterThan(1);

    fireEvent.keyDown(grid, { key: "Escape" });
    const selected = getSelectedCells(view);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute("data-column-id")).toBe("a");
    expect(
      selected[0]?.closest("[data-pretable-row]")?.getAttribute("data-row-id"),
    ).toBe("r1");
  });

  it("Enter selects the focused row (Phase 1 behavior)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Enter" });

    const r2 = view.container.querySelector(
      '[data-pretable-row][data-row-id="r2"]',
    );
    expect(r2).toHaveAttribute("aria-selected", "true");
    expect(r2).toHaveAttribute("data-selected", "true");
  });

  it("Space selects the focused row (Phase 1 behavior)", () => {
    const view = renderHarness();
    seedFocus(view, "r3", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: " " });

    const r3 = view.container.querySelector(
      '[data-pretable-row][data-row-id="r3"]',
    );
    expect(r3).toHaveAttribute("data-selected", "true");
  });

  it("emits onFocusChange when arrow keys move focus", () => {
    const onFocusChange = vi.fn();
    const view = renderHarness({ onFocusChange });
    seedFocus(view, "r1", "a");
    onFocusChange.mockClear();
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(onFocusChange).toHaveBeenCalledWith({ rowId: "r2", columnId: "a" });
  });
});

describe("controlled-mode round-trips", () => {
  it("state.selection: arrow does not mutate rendered selection when controlled and consumer ignores callback", () => {
    const onSelectionChange = vi.fn();
    const controlledSelection: PretableSelectionState = {
      ranges: [
        {
          startRowId: "r1",
          endRowId: "r1",
          startColumnId: "a",
          endColumnId: "a",
        },
      ],
      anchor: { rowId: "r1", columnId: "a" },
    };
    const view = renderHarness({
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: controlledSelection,
      },
      onSelectionChange,
    });
    const grid = view.getByRole("grid");

    // Shift+ArrowDown would extend selection — but selection is controlled and
    // the consumer doesn't update it on render. Engine is forced back to the
    // controlled value on each render, so the rendered selection should match
    // the prop, not the engine-internal extension.
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });

    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-selected", "false");

    // The callback fires with the proposed-by-engine extended selection,
    // even though the controlled prop forces it back to the original value
    // on render. This is what enables consumer-driven controlled mode: the
    // consumer can read the proposed change and decide whether to commit.
    expect(onSelectionChange).toHaveBeenCalled();
    const lastCall =
      onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1]!;
    const proposed = lastCall[0] as PretableSelectionState;
    expect(proposed.ranges[0]).toEqual({
      startRowId: "r1",
      endRowId: "r2",
      startColumnId: "a",
      endColumnId: "a",
    });
  });

  it("state.selection: consumer-driven loop — committing onSelectionChange to setState advances the rendered selection", () => {
    function ConsumerDrivenHarness() {
      const [selection, setSelection] = React.useState<PretableSelectionState>({
        ranges: [
          {
            startRowId: "r1",
            endRowId: "r1",
            startColumnId: "a",
            endColumnId: "a",
          },
        ],
        anchor: { rowId: "r1", columnId: "a" },
      });
      return (
        <PretableSurface
          ariaLabel="consumer-driven"
          columns={gridColumns}
          getRowId={(row: GridRow) => row.id}
          overscan={0}
          rows={gridRows}
          state={{
            focus: { rowId: "r1", columnId: "a" },
            selection,
          }}
          onSelectionChange={setSelection}
          viewportHeight={300}
        />
      );
    }

    const view = render(<ConsumerDrivenHarness />);
    const grid = view.getByRole("grid");

    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });

    // Consumer committed the change; rendered selection follows.
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-selected", "true");
  });

  it("state.selection: rerendering with an updated controlled selection prop forces the rendered selection to match the prop", () => {
    function ControlledSelectionHarness({
      selection,
    }: {
      selection: PretableSelectionState;
    }) {
      return (
        <PretableSurface
          ariaLabel="controlled-grid"
          columns={gridColumns}
          getRowId={(row: GridRow) => row.id}
          overscan={0}
          rows={gridRows}
          state={{ selection }}
          viewportHeight={300}
        />
      );
    }

    const initialSelection: PretableSelectionState = {
      ranges: [
        {
          startRowId: "r1",
          endRowId: "r1",
          startColumnId: "a",
          endColumnId: "a",
        },
      ],
      anchor: { rowId: "r1", columnId: "a" },
    };

    const view = render(
      <ControlledSelectionHarness selection={initialSelection} />,
    );
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-selected", "false");

    const extendedSelection: PretableSelectionState = {
      ranges: [
        {
          startRowId: "r1",
          endRowId: "r2",
          startColumnId: "a",
          endColumnId: "a",
        },
      ],
      anchor: { rowId: "r1", columnId: "a" },
    };
    view.rerender(<ControlledSelectionHarness selection={extendedSelection} />);

    expect(getCell(view, "r1", "a")).toHaveAttribute("data-selected", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-selected", "true");
  });

  it("state.focus: arrow does not move rendered focus when consumer ignores callback", () => {
    const view = renderHarness({
      initialState: { focus: { rowId: "r1", columnId: "a" } },
    });
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });

    // Engine moves focus, but controlled state forces it back to (r1,a) on
    // the next render — the rendered focus stays where the prop pinned it.
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-focused", "true");
    expect(getCell(view, "r2", "a")).toHaveAttribute("data-focused", "false");
  });

  it("state.focus: rerendering with an updated controlled focus prop forces the rendered focus to match the prop", () => {
    function ControlledFocusHarness({ focus }: { focus: PretableFocusState }) {
      return (
        <PretableSurface
          ariaLabel="controlled-grid"
          columns={gridColumns}
          getRowId={(row: GridRow) => row.id}
          overscan={0}
          rows={gridRows}
          state={{ focus }}
          viewportHeight={300}
        />
      );
    }

    const view = render(
      <ControlledFocusHarness focus={{ rowId: "r1", columnId: "a" }} />,
    );
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-focused", "true");

    view.rerender(
      <ControlledFocusHarness focus={{ rowId: "r2", columnId: "b" }} />,
    );
    expect(getCell(view, "r2", "b")).toHaveAttribute("data-focused", "true");
    expect(getCell(view, "r1", "a")).toHaveAttribute("data-focused", "false");
  });
});

describe("ARIA grid attributes", () => {
  it("root has role=grid, aria-multiselectable=true, aria-rowcount, aria-colcount", () => {
    const view = renderHarness();
    const grid = view.getByRole("grid");
    expect(grid).toHaveAttribute("aria-multiselectable", "true");
    // aria-rowcount = totalRowCount + 1 (header)
    expect(grid).toHaveAttribute("aria-rowcount", String(gridRows.length + 1));
    expect(grid).toHaveAttribute("aria-colcount", String(gridColumns.length));
    expect(grid).toHaveAttribute("aria-label", "test-grid");
  });

  it("Cmd+A marks every body cell with aria-selected=true", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });

    const ariaSelected = view.container.querySelectorAll(
      '[data-pretable-cell][aria-selected="true"]',
    );
    expect(ariaSelected.length).toBe(gridRows.length * gridColumns.length);
  });

  it("focused cell has tabIndex=0 and all other cells have tabIndex=-1 (single tab stop)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "b");

    const allCells = view.container.querySelectorAll<HTMLElement>(
      "[data-pretable-cell]",
    );
    const tabStops = Array.from(allCells).filter((c) => c.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]?.getAttribute("data-column-id")).toBe("b");
    expect(
      tabStops[0]?.closest("[data-pretable-row]")?.getAttribute("data-row-id"),
    ).toBe("r2");

    const negative = Array.from(allCells).filter((c) => c.tabIndex === -1);
    expect(negative.length).toBe(allCells.length - 1);
  });

  it("root viewport itself has tabIndex=-1 (not a tab stop)", () => {
    const view = renderHarness();
    const grid = view.getByRole("grid");
    expect(grid).toHaveAttribute("tabIndex", "-1");
  });

  it("header cells have role=columnheader and aria-sort reflecting sort state", () => {
    const view = renderHarness();
    const headers = view.getAllByRole("columnheader");
    expect(headers).toHaveLength(gridColumns.length);

    for (const h of headers) {
      expect(h).toHaveAttribute("aria-sort", "none");
    }

    fireEvent.click(headers[0]!);
    // first click yields desc
    expect(headers[0]).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(headers[0]!);
    expect(headers[0]).toHaveAttribute("aria-sort", "ascending");
  });

  it("body rows have aria-rowindex starting at 2 (header is 1)", () => {
    const view = renderHarness();
    const renderedRows = view
      .getAllByTestId("pretable-row")
      .filter((r) => r.getAttribute("data-pretable-row") !== null);

    // First body row -> aria-rowindex="2"
    const first = renderedRows.find(
      (r) => r.getAttribute("data-row-id") === "r1",
    );
    const second = renderedRows.find(
      (r) => r.getAttribute("data-row-id") === "r2",
    );
    expect(first).toHaveAttribute("aria-rowindex", "2");
    expect(second).toHaveAttribute("aria-rowindex", "3");
  });

  it("body cells have aria-colindex matching column position (1-based)", () => {
    const view = renderHarness();
    const cellA = getCell(view, "r1", "a");
    const cellB = getCell(view, "r1", "b");
    const cellC = getCell(view, "r1", "c");
    expect(cellA).toHaveAttribute("aria-colindex", "1");
    expect(cellB).toHaveAttribute("aria-colindex", "2");
    expect(cellC).toHaveAttribute("aria-colindex", "3");
  });

  it("header row has aria-rowindex=1", () => {
    const view = renderHarness();
    const headerRow = view.container.querySelector(
      "[data-pretable-header-row]",
    );
    expect(headerRow).toHaveAttribute("aria-rowindex", "1");
  });
});
