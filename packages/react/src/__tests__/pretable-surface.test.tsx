import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PretableSurface,
  ROW_SELECT_COLUMN_ID,
  type PretableSurfaceMessages,
  type RowSelectionColumnConfig,
} from "../pretable-surface";
import type { CopyPayload, SerializeRangesArgs } from "../copy";
import * as rowHeight from "../row-height";
import { type PretableSurfaceState, usePretable } from "../use-pretable";
import type {
  PretableFocusState,
  PretableGrid,
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
    value: (row: DemoRow) => row.tags.join(" / "),
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
  it("exposes renderer telemetry from usePretable for internal consumers", () => {
    function Harness() {
      const model = usePretable({
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
    expect(headerRow).toHaveStyle({ height: "36px" });

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
        .map((row) => row.getAttribute("data-pretable-row-id")),
    ).toEqual(["evt-001", "evt-003"]);

    fireEvent.click(severityButton);

    expect(severityButton).toHaveTextContent("Oldest");
    expect(
      view
        .getAllByTestId("pretable-row")
        .map((row) => row.getAttribute("data-pretable-row-id")),
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
    const wrappedCell = firstRow?.querySelector(
      '[data-pretable-column-id="message"]',
    );

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
    expect(renderedRows[0]).toHaveAttribute("data-pretable-focused", "true");
    expect(
      renderedRows[0]?.querySelector("[data-pretable-cell]"),
    ).toHaveAttribute("data-pretable-focused", "true");

    fireEvent.keyDown(viewport, { key: "Enter" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[0]).toHaveAttribute("aria-selected", "true");
    expect(renderedRows[0]).toHaveAttribute("data-pretable-selected", "true");

    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "Space" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[1]).toHaveAttribute("data-pretable-focused", "true");
    expect(renderedRows[1]).toHaveAttribute("data-pretable-selected", "true");

    fireEvent.keyDown(viewport, { key: "ArrowUp" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[0]).toHaveAttribute("data-pretable-focused", "true");
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
    expect(renderedRows[0]).toHaveAttribute("data-pretable-focused", "true");
    expect(renderedRows[0]).toHaveAttribute("data-pretable-selected", "true");

    fireEvent.keyDown(viewport, { key: "ArrowDown" });

    renderedRows = view.getAllByTestId("pretable-row");
    expect(renderedRows[1]).toHaveAttribute("data-pretable-focused", "true");
    expect(renderedRows[1]).toHaveAttribute("data-pretable-selected", "true");
    expect(renderedRows[0]).toHaveAttribute("data-pretable-selected", "false");
  });

  it("emits selected row id changes for keyboard-driven full-row selection", () => {
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

    // selectFocusedRowOnArrowKey: ArrowDown selects the focused row's full
    // range, which the surface forwards as a row-id change.
    const viewport = view.getByRole("grid", { name: "Inspection grid" });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "ArrowUp" });

    expect(onSelectedRowIdChange).toHaveBeenNthCalledWith(1, "evt-001");
    expect(onSelectedRowIdChange).toHaveBeenNthCalledWith(2, "evt-002");
    expect(onSelectedRowIdChange).toHaveBeenNthCalledWith(3, "evt-001");
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

    // Drive selection via keyboard (Phase 3 cell-click no longer full-row-selects).
    const viewport = view.getByRole("grid", { name: "Inspection grid" });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });

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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "141");
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "141");
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "171");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-pretable-row-id") === "evt-002",
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "141");
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(shortRow).toHaveAttribute("data-pretable-row-height", "66");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-pretable-row-id") === "evt-002",
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "141");
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "141");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-pretable-row-id") === "evt-002",
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute("data-pretable-row-height", "141");
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-pretable-row-id") === "evt-002",
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
      '[data-pretable-column-id="pinned_ts"]',
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute(
        "data-pretable-row-height",
        expectedTallRowHeight,
      );
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
        .find((row) => row.getAttribute("data-pretable-row-id") === "evt-002");

      expect(tallRow).toHaveAttribute(
        "data-pretable-row-height",
        expectedTallRowHeight,
      );
      expect(
        measureRenderedRowHeightSpy.mock.calls.filter(
          ([node]) => node.getAttribute("data-pretable-row-id") === "evt-002",
        ),
      ).toHaveLength(0);
    });
  });

  it("exposes data-pretable-header-row, data-pretable-header-cell, and data-pretable-pinned for theming", () => {
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
    expect(headerCells[0]?.getAttribute("data-pretable-pinned")).toBe("left");
    expect(headerCells[1]?.getAttribute("data-pretable-pinned")).toBe("left");
    expect(headerCells[2]?.getAttribute("data-pretable-pinned")).toBeNull();

    const bodyCells = container.querySelectorAll("[data-pretable-cell]");
    expect(bodyCells.length).toBeGreaterThan(0);
    const pinnedBodyCell = container.querySelector(
      '[data-pretable-cell][data-pretable-pinned="left"]',
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

const getGridRowId = (row: GridRow) => row.id;

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
  onSelectedRowIdChange?: (rowId: string | null) => void;
  rowSelectionColumn?: RowSelectionColumnConfig;
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
      onSelectedRowIdChange={opts.onSelectedRowIdChange}
      onSelectionChange={opts.onSelectionChange}
      overscan={0}
      rows={gridRows}
      rowSelectionColumn={opts.rowSelectionColumn}
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
    `[data-pretable-row][data-pretable-row-id="${rowId}"] [data-pretable-column-id="${colId}"]`,
  );
}

function getFocusedCell(view: ReturnType<typeof render>) {
  return view.container.querySelector<HTMLDivElement>(
    '[data-pretable-cell][data-pretable-focused="true"]',
  );
}

function getSelectedCells(view: ReturnType<typeof render>) {
  return Array.from(
    view.container.querySelectorAll<HTMLDivElement>(
      '[data-pretable-cell][data-pretable-selected="true"]',
    ),
  );
}

describe("keyboard contract", () => {
  it("ArrowDown moves focus down one row", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute("tabIndex", "0");
  });

  it("ArrowUp moves focus up one row", () => {
    const view = renderHarness();
    seedFocus(view, "r3", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("ArrowRight moves focus right one column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(getCell(view, "r1", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("ArrowLeft moves focus left one column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(getCell(view, "r1", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Shift+ArrowDown extends the selection range downward by one row", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({ onSelectionChange });
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });

    const selected = getSelectedCells(view);
    expect(selected.length).toBeGreaterThanOrEqual(2);
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    // Other-column cells in those rows should NOT be selected
    expect(getCell(view, "r1", "b")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );
  });

  it("Shift+ArrowRight extends the selection range rightward by one column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });

    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r1", "b")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );
  });

  it("Cmd+ArrowDown jumps focus to last visible row", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown", metaKey: true });
    expect(getCell(view, "r5", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Cmd+ArrowRight jumps focus to last column", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowRight", metaKey: true });
    expect(getCell(view, "r1", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Ctrl+ArrowUp jumps focus to first row (ctrl works as cmd alias)", () => {
    const view = renderHarness();
    seedFocus(view, "r5", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowUp", ctrlKey: true });
    expect(getCell(view, "r1", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
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
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r5", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
  });

  it("Home moves focus to first column in the current row", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Home" });
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("End moves focus to last column in the current row", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "End" });
    expect(getCell(view, "r2", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Cmd+Home moves focus to the first cell in the grid", () => {
    const view = renderHarness();
    seedFocus(view, "r4", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Home", metaKey: true });
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Cmd+End moves focus to the last cell in the grid", () => {
    const view = renderHarness();
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "End", metaKey: true });
    expect(getCell(view, "r5", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
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
      ?.getAttribute("data-pretable-row-id");
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
      ?.getAttribute("data-pretable-row-id");
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
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    const r2sel = getCell(view, "r2", "a")?.getAttribute(
      "data-pretable-selected",
    );
    expect(r2sel).toBe("true");
  });

  it("Tab in middle of row moves focus to next column (default wrap-rows)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Tab at end of row wraps to next row's first cell (wrap-rows)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "c");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(getCell(view, "r3", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Shift+Tab moves focus left", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab", shiftKey: true });
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Shift+Tab at start of row wraps to previous row's last cell", () => {
    const view = renderHarness();
    seedFocus(view, "r3", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Tab", shiftKey: true });
    expect(getCell(view, "r2", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
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
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
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
    expect(selected[0]?.getAttribute("data-pretable-column-id")).toBe("a");
    expect(
      selected[0]
        ?.closest("[data-pretable-row]")
        ?.getAttribute("data-pretable-row-id"),
    ).toBe("r1");
  });

  it("Enter selects the focused row (Phase 1 behavior)", () => {
    const view = renderHarness();
    seedFocus(view, "r2", "b");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Enter" });

    const r2 = view.container.querySelector(
      '[data-pretable-row][data-pretable-row-id="r2"]',
    );
    expect(r2).toHaveAttribute("aria-selected", "true");
    expect(r2).toHaveAttribute("data-pretable-selected", "true");
  });

  it("Space selects the focused row (Phase 1 behavior)", () => {
    const view = renderHarness();
    seedFocus(view, "r3", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: " " });

    const r3 = view.container.querySelector(
      '[data-pretable-row][data-pretable-row-id="r3"]',
    );
    expect(r3).toHaveAttribute("data-pretable-selected", "true");
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
  it("does not emit to the external store during render when a controlled prop changes (no React 'update while rendering' warning)", () => {
    // Repro of the website-hero bug: the headless `usePretable` grid is shared
    // between the surface and a sibling control panel (both subscribe to the
    // grid's external store). A controlled prop (`state.filters`) is driven by
    // sibling state. Applying the grid mutation *during render* emits to the
    // store synchronously, which notifies the *already-mounted sibling*
    // subscriber mid-render — tripping React's "Cannot update a component
    // while rendering a different component" warning on every keystroke.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // A sibling that independently subscribes to the same grid store — stands
    // in for the hero's control-panel / result-count readout.
    function ResultCount({ grid }: { grid: PretableGrid<GridRow> }) {
      const snap = React.useSyncExternalStore(grid.subscribe, grid.getSnapshot);
      return <span data-testid="count">{snap.visibleRows.length}</span>;
    }

    function HeadlessHarness() {
      const [query, setQuery] = React.useState("");
      const { grid, renderSnapshot } = usePretable<GridRow>({
        columns: gridColumns,
        getRowId: getGridRowId,
        overscan: 0,
        rows: gridRows,
        state: {
          filters: query
            ? { a: { operator: "contains" as const, value: query } }
            : {},
        },
        viewportHeight: 300,
      });

      return (
        <div>
          <input
            aria-label="filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ResultCount grid={grid} />
          <output data-testid="rendered">{renderSnapshot.rows.length}</output>
        </div>
      );
    }

    const view = render(<HeadlessHarness />);
    const input = view.getByLabelText("filter");

    fireEvent.change(input, { target: { value: "a1" } });
    fireEvent.change(input, { target: { value: "a12" } });

    const renderWhileRenderingWarning = errorSpy.mock.calls.some((call) =>
      String(call[0]).includes("Cannot update a component"),
    );
    expect(renderWhileRenderingWarning).toBe(false);

    // Filtering still works: query "a1" matches only r1 (column a = "a1").
    fireEvent.change(input, { target: { value: "a1" } });
    expect(view.getByTestId("count")).toHaveTextContent("1");

    errorSpy.mockRestore();
  });

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

    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );

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
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
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
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );

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

    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
  });

  it("state.focus: arrow does not move rendered focus when consumer ignores callback", () => {
    const view = renderHarness({
      initialState: { focus: { rowId: "r1", columnId: "a" } },
    });
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });

    // Engine moves focus, but controlled state forces it back to (r1,a) on
    // the next render — the rendered focus stays where the prop pinned it.
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
    expect(getCell(view, "r2", "a")).toHaveAttribute(
      "data-pretable-focused",
      "false",
    );
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
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );

    view.rerender(
      <ControlledFocusHarness focus={{ rowId: "r2", columnId: "b" }} />,
    );
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-focused",
      "false",
    );
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
    expect(tabStops[0]?.getAttribute("data-pretable-column-id")).toBe("b");
    expect(
      tabStops[0]
        ?.closest("[data-pretable-row]")
        ?.getAttribute("data-pretable-row-id"),
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
      (r) => r.getAttribute("data-pretable-row-id") === "r1",
    );
    const second = renderedRows.find(
      (r) => r.getAttribute("data-pretable-row-id") === "r2",
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

// ---------------------------------------------------------------------------
// Phase 3 Task 4 — click + drag selection
// ---------------------------------------------------------------------------

describe("click + drag selection", () => {
  // ---- Click semantics ----

  it("plain click on a cell focuses it and collapses selection", () => {
    const view = renderHarness();
    const cell = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(cell, { pointerId: 1, button: 0 });
    fireEvent.click(cell);

    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    // Only one selected cell
    expect(getSelectedCells(view)).toHaveLength(1);
  });

  it("plain click on a different cell collapses any prior wider selection", () => {
    const view = renderHarness();
    const grid = view.getByRole("grid");
    // Cmd+A selects everything
    fireEvent.keyDown(grid, { key: "a", metaKey: true });
    expect(getSelectedCells(view).length).toBeGreaterThan(1);

    const cell = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(cell, { pointerId: 1, button: 0 });
    fireEvent.click(cell);

    expect(getSelectedCells(view)).toHaveLength(1);
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("shift+click with no prior anchor behaves as plain click", () => {
    const view = renderHarness();
    const cell = getCell(view, "r2", "b")!;
    // shift+click — pointerDown short-circuits when shift is held
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(cell, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.click(cell, { shiftKey: true });

    // No anchor before -> falls through to plain-click branch -> single cell.
    expect(getSelectedCells(view)).toHaveLength(1);
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("shift+click extends from existing anchor", () => {
    const view = renderHarness();
    // Plain click on (r1, a) sets anchor.
    const start = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(start, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(start, { pointerId: 1, button: 0 });
    fireEvent.click(start);

    // Shift+click on (r3, c).
    const end = getCell(view, "r3", "c")!;
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(end, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.click(end, { shiftKey: true });

    // 3x3 block selected.
    expect(getSelectedCells(view)).toHaveLength(9);
    for (const r of ["r1", "r2", "r3"]) {
      for (const c of ["a", "b", "c"]) {
        expect(getCell(view, r, c)).toHaveAttribute(
          "data-pretable-selected",
          "true",
        );
      }
    }
    expect(getCell(view, "r3", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("cmd+click adds a discontiguous range", () => {
    const view = renderHarness();
    const start = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(start, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(start, { pointerId: 1, button: 0 });
    fireEvent.click(start);

    // Cmd+click on (r3, c).
    const end = getCell(view, "r3", "c")!;
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, metaKey: true });
    fireEvent.pointerUp(end, { pointerId: 1, button: 0, metaKey: true });
    fireEvent.click(end, { metaKey: true });

    // Two single cells selected — discontiguous.
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r3", "c")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );
    expect(getSelectedCells(view)).toHaveLength(2);
    expect(getCell(view, "r3", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("onSelectionChange fires on plain click", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({ onSelectionChange });
    const cell = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(cell, { pointerId: 1, button: 0 });
    fireEvent.click(cell);

    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).toHaveLength(1);
    expect(last.ranges[0]).toMatchObject({
      startRowId: "r2",
      endRowId: "r2",
      startColumnId: "b",
      endColumnId: "b",
    });
  });

  it("onSelectionChange fires on shift+click extension", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({ onSelectionChange });
    const start = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(start, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(start, { pointerId: 1, button: 0 });
    fireEvent.click(start);
    onSelectionChange.mockClear();

    const end = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(end, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.click(end, { shiftKey: true });

    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).toHaveLength(1);
    const r = last.ranges[0]!;
    // Range spans (r1,a) to (r2,b) regardless of orientation.
    expect(new Set([r.startRowId, r.endRowId])).toEqual(new Set(["r1", "r2"]));
    expect(new Set([r.startColumnId, r.endColumnId])).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("onSelectionChange fires on cmd+click discontiguous add", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({ onSelectionChange });
    const start = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(start, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(start, { pointerId: 1, button: 0 });
    fireEvent.click(start);
    onSelectionChange.mockClear();

    const end = getCell(view, "r3", "c")!;
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, metaKey: true });
    fireEvent.pointerUp(end, { pointerId: 1, button: 0, metaKey: true });
    fireEvent.click(end, { metaKey: true });

    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).toHaveLength(2);
  });

  it("onFocusChange fires for each click variant", () => {
    const onFocusChange = vi.fn();
    const view = renderHarness({ onFocusChange });
    const a = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(a, { pointerId: 1, button: 0 });
    fireEvent.click(a);
    expect(onFocusChange).toHaveBeenCalled();
    const callsAfterPlain = onFocusChange.mock.calls.length;

    const b = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(b, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerUp(b, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.click(b, { shiftKey: true });
    expect(onFocusChange.mock.calls.length).toBeGreaterThan(callsAfterPlain);
    const callsAfterShift = onFocusChange.mock.calls.length;

    const c = getCell(view, "r3", "c")!;
    fireEvent.pointerDown(c, { pointerId: 1, button: 0, metaKey: true });
    fireEvent.pointerUp(c, { pointerId: 1, button: 0, metaKey: true });
    fireEvent.click(c, { metaKey: true });
    expect(onFocusChange.mock.calls.length).toBeGreaterThan(callsAfterShift);

    const lastFocus = onFocusChange.mock.calls.at(-1)![0] as PretableFocusState;
    expect(lastFocus).toMatchObject({ rowId: "r3", columnId: "c" });
  });

  it("onSelectedRowIdChange fires null on plain cell click after a full-row selection", () => {
    const onSelectedRowIdChange = vi.fn();
    const view = renderHarness({ onSelectedRowIdChange });
    const grid = view.getByRole("grid");

    // Seed focus, then Enter to make a full-row selection on r1.
    seedFocus(view, "r1", "a");
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onSelectedRowIdChange).toHaveBeenCalledWith("r1");
    onSelectedRowIdChange.mockClear();

    // Plain click on (r2, b) — collapses to single cell, no longer a full row.
    const cell = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(cell, { pointerId: 1, button: 0 });
    fireEvent.click(cell);

    expect(onSelectedRowIdChange).toHaveBeenCalledWith(null);
  });

  it("onSelectedRowIdChange does NOT fire transitioning from cell-range to cell-range", () => {
    const onSelectedRowIdChange = vi.fn();
    const view = renderHarness({ onSelectedRowIdChange });

    // Plain click (r1, a) — single cell, not a full row.
    const a = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(a, { pointerId: 1, button: 0 });
    fireEvent.click(a);

    // Plain click (r2, b) — still a single cell.
    const b = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(b, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(b, { pointerId: 1, button: 0 });
    fireEvent.click(b);

    expect(onSelectedRowIdChange).not.toHaveBeenCalled();
  });

  // ---- Marquee drag ----

  it("drag from cell A through B to C produces a range A→C", () => {
    const view = renderHarness();
    const a = getCell(view, "r1", "a")!;
    const b = getCell(view, "r2", "b")!;
    const c = getCell(view, "r3", "c")!;

    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerEnter(b, { pointerId: 1 });
    fireEvent.pointerEnter(c, { pointerId: 1 });
    fireEvent.pointerUp(c, { pointerId: 1, button: 0 });

    expect(getSelectedCells(view)).toHaveLength(9);
    for (const r of ["r1", "r2", "r3"]) {
      for (const col of ["a", "b", "c"]) {
        expect(getCell(view, r, col)).toHaveAttribute(
          "data-pretable-selected",
          "true",
        );
      }
    }
    expect(getCell(view, "r3", "c")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("drag with a single pointerEnter still works", () => {
    const view = renderHarness();
    const a = getCell(view, "r1", "a")!;
    const b = getCell(view, "r2", "b")!;

    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerEnter(b, { pointerId: 1 });
    fireEvent.pointerUp(b, { pointerId: 1, button: 0 });

    // 2x2 range
    expect(getSelectedCells(view)).toHaveLength(4);
    for (const r of ["r1", "r2"]) {
      for (const col of ["a", "b"]) {
        expect(getCell(view, r, col)).toHaveAttribute(
          "data-pretable-selected",
          "true",
        );
      }
    }
  });

  it("pointerUp without movement leaves single-cell selection", () => {
    const view = renderHarness();
    const cell = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(cell, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(cell, { pointerId: 1, button: 0 });

    expect(getSelectedCells(view)).toHaveLength(1);
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("Esc during drag reverts to pre-drag selection", () => {
    const view = renderHarness();
    const grid = view.getByRole("grid");

    // Establish a prior selection: plain click on (r1, a).
    const a = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(a, { pointerId: 1, button: 0 });
    fireEvent.click(a);

    // Begin drag at (r2, b) — collapses to (r2, b).
    const b = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(b, { pointerId: 1, button: 0 });
    expect(getCell(view, "r2", "b")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );

    // Move into (r3, c) — extends.
    const c = getCell(view, "r3", "c")!;
    fireEvent.pointerEnter(c, { pointerId: 1 });
    expect(getSelectedCells(view).length).toBeGreaterThan(1);

    // Esc reverts to pre-drag selection: single cell (r1, a).
    fireEvent.keyDown(grid, { key: "Escape" });

    expect(getSelectedCells(view)).toHaveLength(1);
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );

    // Subsequent pointerEnter should NOT extend (drag mode is off).
    const r4c = getCell(view, "r4", "c");
    if (r4c) {
      fireEvent.pointerEnter(r4c, { pointerId: 1 });
      expect(getSelectedCells(view)).toHaveLength(1);
      expect(getCell(view, "r1", "a")).toHaveAttribute(
        "data-pretable-selected",
        "true",
      );
    }
    fireEvent.pointerUp(b, { pointerId: 1, button: 0 });
    expect(getSelectedCells(view)).toHaveLength(1);
  });

  it("drag with shift held does NOT enter drag mode (pointerEnter ignored)", () => {
    const view = renderHarness();
    // Establish anchor at (r1, a).
    const a = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(a, { pointerId: 1, button: 0 });
    fireEvent.click(a);

    // Shift+pointerDown on (r2, b) — should short-circuit drag.
    const b = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(b, { pointerId: 1, button: 0, shiftKey: true });

    // pointerEnter on (r3, c) should NOT extend — drag anchor is null.
    const c = getCell(view, "r3", "c")!;
    fireEvent.pointerEnter(c, { pointerId: 1 });

    // Selection still anchored at (r1,a) (unchanged from anchor click).
    expect(getCell(view, "r1", "a")).toHaveAttribute(
      "data-pretable-selected",
      "true",
    );
    expect(getCell(view, "r3", "c")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );

    // Shift+click then completes the shift-extend semantics.
    fireEvent.pointerUp(b, { pointerId: 1, button: 0, shiftKey: true });
    fireEvent.click(b, { shiftKey: true });

    // Now (r1,a)..(r2,b) — 2x2 = 4 cells.
    expect(getSelectedCells(view)).toHaveLength(4);
  });

  it("drag with cmd held does NOT enter drag mode (pointerEnter ignored)", () => {
    const view = renderHarness();
    const a = getCell(view, "r1", "a")!;
    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(a, { pointerId: 1, button: 0 });
    fireEvent.click(a);

    const b = getCell(view, "r2", "b")!;
    fireEvent.pointerDown(b, { pointerId: 1, button: 0, metaKey: true });

    const c = getCell(view, "r3", "c")!;
    fireEvent.pointerEnter(c, { pointerId: 1 });

    // (r3, c) must not have been silently added.
    expect(getCell(view, "r3", "c")).toHaveAttribute(
      "data-pretable-selected",
      "false",
    );
  });

  it("onSelectionChange fires on each pointerEnter during a drag", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({ onSelectionChange });
    const a = getCell(view, "r1", "a")!;
    const b = getCell(view, "r2", "b")!;
    const c = getCell(view, "r3", "c")!;

    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    const afterDown = onSelectionChange.mock.calls.length;

    fireEvent.pointerEnter(b, { pointerId: 1 });
    const afterEnterB = onSelectionChange.mock.calls.length;
    expect(afterEnterB).toBeGreaterThan(afterDown);

    fireEvent.pointerEnter(c, { pointerId: 1 });
    const afterEnterC = onSelectionChange.mock.calls.length;
    expect(afterEnterC).toBeGreaterThan(afterEnterB);

    fireEvent.pointerUp(c, { pointerId: 1, button: 0 });
  });
});

function getRowCheckbox(view: ReturnType<typeof render>, rowId: string) {
  const row = view.container.querySelector(
    `[data-pretable-row][data-pretable-row-id="${rowId}"]`,
  );
  return row?.querySelector(
    "[data-pretable-row-select]",
  ) as HTMLButtonElement | null;
}

function getHeaderCheckbox(view: ReturnType<typeof render>) {
  return view.container.querySelector(
    "[data-pretable-row-select-all]",
  ) as HTMLButtonElement | null;
}

function fullRowRange(rowId: string) {
  // With the synthetic row-select column injected at column 0, a full-row
  // range produced by toggleRowSelection / setSelectAllVisible spans
  // ROW_SELECT_COLUMN_ID through the last data column (id "c").
  return {
    startRowId: rowId,
    endRowId: rowId,
    startColumnId: ROW_SELECT_COLUMN_ID,
    endColumnId: "c",
  };
}

describe("row-select checkbox column", () => {
  it("does not render the synthetic checkbox column when rowSelectionColumn is omitted", () => {
    const view = renderHarness();
    expect(
      view.container.querySelector("[data-pretable-row-select]"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-pretable-row-select-all]"),
    ).toBeNull();
    expect(
      view.container.querySelector(
        `[data-pretable-column-id="${ROW_SELECT_COLUMN_ID}"]`,
      ),
    ).toBeNull();
  });

  it("renders a leftmost row checkbox cell when rowSelectionColumn.enabled is true", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    const r1 = view.container.querySelector(
      '[data-pretable-row][data-pretable-row-id="r1"]',
    );
    const cells = r1?.querySelectorAll("[data-pretable-cell]");
    expect(cells?.[0]).toHaveAttribute("data-pretable-row-select-cell", "true");
    expect(
      cells?.[0]?.querySelector("[data-pretable-row-select]"),
    ).not.toBeNull();
  });

  it("hides the header checkbox when headerCheckbox: false", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true, headerCheckbox: false },
    });
    expect(getHeaderCheckbox(view)).toBeNull();
  });

  it("shows the header checkbox by default when rowSelectionColumn is enabled", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    expect(getHeaderCheckbox(view)).not.toBeNull();
  });

  it("plain click on a body checkbox creates a full-row range for that row", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      onSelectionChange,
    });
    fireEvent.click(getRowCheckbox(view, "r2")!);

    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).toContainEqual(fullRowRange("r2"));
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "true");
  });

  it("preserves a selected row across a streamed rows update with an inline rowSelectionColumn", () => {
    const renderAt = (rows: GridRow[]) => (
      <PretableSurface
        ariaLabel="stream-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={rows}
        rowSelectionColumn={{ enabled: true }} // inline: a new object every render
        viewportHeight={300}
      />
    );
    const view = render(
      renderAt([
        { id: "r1", a: "a1", b: "b1", c: "c1" },
        { id: "r2", a: "a2", b: "b2", c: "c2" },
      ]),
    );
    fireEvent.click(getRowCheckbox(view, "r2")!);
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "true");

    // New rows array, same ids, updated data — the streaming case. Recreating
    // the grid here (the old behavior) would discard the selection.
    view.rerender(
      renderAt([
        { id: "r1", a: "a1*", b: "b1*", c: "c1*" },
        { id: "r2", a: "a2*", b: "b2*", c: "c2*" },
      ]),
    );
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "true");
  });

  it("clicking the checkbox of an already fully-selected row toggles it off", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: {
          ranges: [fullRowRange("r1")],
          anchor: { rowId: "r1", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
      onSelectionChange,
    });

    expect(getRowCheckbox(view, "r1")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(getRowCheckbox(view, "r1")!);

    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).not.toContainEqual(fullRowRange("r1"));
    // (Rendered aria-checked stays "true" because the harness is in
    //  controlled mode and does not re-commit the selection prop.)
  });

  it("clicking a body checkbox does not move focus", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: "r3", columnId: "b" },
        selection: { ranges: [], anchor: null },
      },
    });

    expect(getCell(view, "r3", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
    fireEvent.click(getRowCheckbox(view, "r1")!);
    expect(getCell(view, "r3", "b")).toHaveAttribute(
      "data-pretable-focused",
      "true",
    );
  });

  it("clicking a body checkbox does not collapse an existing cell-range selection", () => {
    const onSelectionChange = vi.fn();
    const existingRange = {
      startRowId: "r1",
      endRowId: "r2",
      startColumnId: "a",
      endColumnId: "b",
    };
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [existingRange],
          anchor: { rowId: "r1", columnId: "a" },
        },
      },
      onSelectionChange,
    });

    fireEvent.click(getRowCheckbox(view, "r3")!);
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).toContainEqual(existingRange);
    expect(last.ranges).toContainEqual(fullRowRange("r3"));
  });

  it("shift+click on a body checkbox without a prior anchor behaves as plain click", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      onSelectionChange,
    });

    fireEvent.click(getRowCheckbox(view, "r2")!, { shiftKey: true });
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    expect(last.ranges).toContainEqual(fullRowRange("r2"));
    expect(last.ranges.filter((r) => r.startRowId === r.endRowId)).toHaveLength(
      1,
    );
  });

  it("shift+click extends the row-select range from the prior checkbox anchor (forward)", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    fireEvent.click(getRowCheckbox(view, "r1")!);
    fireEvent.click(getRowCheckbox(view, "r3")!, { shiftKey: true });

    expect(getRowCheckbox(view, "r1")).toHaveAttribute("aria-checked", "true");
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "true");
    expect(getRowCheckbox(view, "r3")).toHaveAttribute("aria-checked", "true");
  });

  it("shift+click extends the row-select range backward across the prior anchor", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    fireEvent.click(getRowCheckbox(view, "r3")!);
    fireEvent.click(getRowCheckbox(view, "r1")!, { shiftKey: true });

    expect(getRowCheckbox(view, "r1")).toHaveAttribute("aria-checked", "true");
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "true");
    expect(getRowCheckbox(view, "r3")).toHaveAttribute("aria-checked", "true");
  });

  it("header checkbox is unchecked when no rows are selected", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    expect(getHeaderCheckbox(view)).toHaveAttribute("aria-checked", "false");
  });

  it("header checkbox is checked when every visible row is fully selected", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: {
          ranges: gridRows.map((r) => fullRowRange(r.id)),
          anchor: { rowId: "r1", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
    });
    expect(getHeaderCheckbox(view)).toHaveAttribute("aria-checked", "true");
  });

  it("header checkbox is mixed when only some rows are fully selected", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: {
          ranges: [fullRowRange("r2")],
          anchor: { rowId: "r2", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
    });
    expect(getHeaderCheckbox(view)).toHaveAttribute("aria-checked", "mixed");
  });

  it("clicking the header checkbox when all rows are fully selected deselects every visible row", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: {
          ranges: gridRows.map((r) => fullRowRange(r.id)),
          anchor: { rowId: "r1", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
      onSelectionChange,
    });

    fireEvent.click(getHeaderCheckbox(view)!);
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    for (const r of gridRows) {
      expect(last.ranges).not.toContainEqual(fullRowRange(r.id));
    }
    // Rendered aria-checked remains "true" here because the harness is
    // controlled and does not commit the proposed selection back.
  });

  it("clicking the header checkbox when nothing/some is selected selects all visible rows", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      onSelectionChange,
    });

    fireEvent.click(getHeaderCheckbox(view)!);
    const last = onSelectionChange.mock.calls.at(
      -1,
    )![0] as PretableSelectionState;
    for (const r of gridRows) {
      expect(last.ranges).toContainEqual(fullRowRange(r.id));
    }
    expect(getHeaderCheckbox(view)).toHaveAttribute("aria-checked", "true");
  });

  it("row checkbox aria-checked='true' when its row is fully selected", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: {
          ranges: [fullRowRange("r2")],
          anchor: { rowId: "r2", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
    });
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "true");
  });

  it("row checkbox aria-checked='mixed' when its row is partially selected via a cell range", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: "r2", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r2",
              endRowId: "r2",
              startColumnId: "a",
              endColumnId: "b",
            },
          ],
          anchor: { rowId: "r2", columnId: "a" },
        },
      },
    });
    expect(getRowCheckbox(view, "r2")).toHaveAttribute("aria-checked", "mixed");
  });

  it("row checkbox aria-checked='false' when no cells in that row are selected", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    for (const r of gridRows) {
      expect(getRowCheckbox(view, r.id)).toHaveAttribute(
        "aria-checked",
        "false",
      );
    }
  });

  it("cell-range marquee drag does not affect the synthetic checkbox column", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    const a = getCell(view, "r1", "a")!;
    const r2Checkbox = view.container.querySelector(
      '[data-pretable-row][data-pretable-row-id="r2"] [data-pretable-row-select-cell="true"]',
    ) as HTMLElement;
    const c = getCell(view, "r3", "c")!;

    fireEvent.pointerDown(a, { pointerId: 1, button: 0 });
    fireEvent.pointerEnter(r2Checkbox, { pointerId: 1 });
    fireEvent.pointerEnter(c, { pointerId: 1 });
    fireEvent.pointerUp(c, { pointerId: 1, button: 0 });

    // Every body cell at columns a..c for rows r1..r3 must be selected, and
    // no synthetic checkbox cell should be marked selected.
    for (const rowId of ["r1", "r2", "r3"]) {
      for (const colId of ["a", "b", "c"]) {
        expect(getCell(view, rowId, colId)).toHaveAttribute(
          "data-pretable-selected",
          "true",
        );
      }
      const checkboxCell = view.container.querySelector(
        `[data-pretable-row][data-pretable-row-id="${rowId}"] [data-pretable-row-select-cell="true"]`,
      );
      expect(checkboxCell).toHaveAttribute("data-pretable-selected", "false");
    }
  });

  it("Cmd+A keyboard select-all does not mark the synthetic checkbox column as selected", () => {
    const onSelectionChange = vi.fn();
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
      onSelectionChange,
    });
    seedFocus(view, "r1", "a");
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });

    // The synthetic row-select cells must never render as data-pretable-selected="true";
    // they are excluded from the visual cell-selection set even if the engine
    // range happens to span the synthetic column id.
    for (const rowId of gridRows.map((r) => r.id)) {
      const checkboxCell = view.container.querySelector(
        `[data-pretable-row][data-pretable-row-id="${rowId}"] [data-pretable-row-select-cell="true"]`,
      );
      expect(checkboxCell).toHaveAttribute("data-pretable-selected", "false");
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — Cmd+C copy contract integration tests
// ---------------------------------------------------------------------------

interface RenderCopyHarnessOpts {
  initialState?: PretableSurfaceState;
  columns?: typeof gridColumns;
  copyWithHeaders?: boolean;
  onCopy?: (args: SerializeRangesArgs<GridRow>) => CopyPayload | null;
  copyToClipboard?: (payload: CopyPayload) => void | Promise<void>;
  rowSelectionColumn?: RowSelectionColumnConfig;
}

function renderCopyHarness(opts: RenderCopyHarnessOpts = {}) {
  return render(
    <PretableSurface
      ariaLabel="copy-grid"
      columns={opts.columns ?? gridColumns}
      copyToClipboard={opts.copyToClipboard}
      copyWithHeaders={opts.copyWithHeaders}
      getRowId={(row: GridRow) => row.id}
      onCopy={opts.onCopy}
      overscan={0}
      rows={gridRows}
      rowSelectionColumn={opts.rowSelectionColumn}
      state={opts.initialState}
      viewportHeight={300}
    />,
  );
}

function singleCellSelection(
  rowId: string,
  columnId: string,
): PretableSurfaceState {
  return {
    focus: { rowId, columnId },
    selection: {
      ranges: [
        {
          startRowId: rowId,
          endRowId: rowId,
          startColumnId: columnId,
          endColumnId: columnId,
        },
      ],
      anchor: { rowId, columnId },
    },
  };
}

describe("PretableSurface copy", () => {
  it("Cmd+C with a single-cell selection writes a single-cell TSV", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith({ text: "a1" });
  });

  it("Cmd+C with a multi-row range writes row-major TSV joined by newlines", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r1",
              endRowId: "r2",
              startColumnId: "a",
              endColumnId: "a",
            },
          ],
          anchor: { rowId: "r1", columnId: "a" },
        },
      },
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledWith({ text: "a1\na2" });
  });

  it("Cmd+C with a multi-column range writes columns joined by tabs", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r1",
              endRowId: "r1",
              startColumnId: "a",
              endColumnId: "b",
            },
          ],
          anchor: { rowId: "r1", columnId: "a" },
        },
      },
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledWith({ text: "a1\tb1" });
  });

  it("Cmd+C with multiple ranges joins blocks with a blank line", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r1",
              endRowId: "r1",
              startColumnId: "a",
              endColumnId: "a",
            },
            {
              startRowId: "r3",
              endRowId: "r3",
              startColumnId: "c",
              endColumnId: "c",
            },
          ],
          anchor: { rowId: "r1", columnId: "a" },
        },
      },
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledWith({ text: "a1\n\nc3" });
  });

  it("copyWithHeaders=true prepends a header row + blank line before the body", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r1",
              endRowId: "r1",
              startColumnId: "a",
              endColumnId: "b",
            },
          ],
          anchor: { rowId: "r1", columnId: "a" },
        },
      },
      copyWithHeaders: true,
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledWith({ text: "A\tB\n\na1\tb1" });
  });

  it("onCopy override receives args and its return value is what gets written", () => {
    const copyToClipboard = vi.fn();
    const onCopy = vi.fn((args: SerializeRangesArgs<GridRow>) => {
      // sanity: args contain the expected pieces
      expect(args.ranges).toHaveLength(1);
      expect(args.copyWithHeaders).toBe(false);
      return { text: "OVERRIDE", html: "<b>OVERRIDE</b>" };
    });
    const view = renderCopyHarness({
      initialState: singleCellSelection("r1", "a"),
      onCopy,
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith({
      text: "OVERRIDE",
      html: "<b>OVERRIDE</b>",
    });
  });

  it("onCopy returning null skips the clipboard write", () => {
    const copyToClipboard = vi.fn();
    const onCopy = vi.fn(() => null);
    const view = renderCopyHarness({
      initialState: singleCellSelection("r1", "a"),
      onCopy,
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("format on a column overrides default coercion in the body", () => {
    const copyToClipboard = vi.fn();
    const customColumns = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        format: ({ value }: { value: unknown }) => `FORMATTED:${String(value)}`,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = renderCopyHarness({
      columns: customColumns,
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledWith({ text: "FORMATTED:a1" });
  });

  it("Cmd+C with an empty selection does not call copyToClipboard", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: { ranges: [], anchor: null },
      },
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("row-select-driven copy emits all data columns of the row (synthetic column expands)", () => {
    const copyToClipboard = vi.fn();
    // toggleRowSelection / setSelectAllVisible / selectAll all emit ranges
    // whose startColumnId is the synthetic ROW_SELECT_COLUMN_ID. The
    // serializer treats that as "start at first data column" so Cmd+C
    // produces the full row, not just the last data column.
    const view = renderCopyHarness({
      rowSelectionColumn: { enabled: true },
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r1",
              endRowId: "r1",
              startColumnId: ROW_SELECT_COLUMN_ID,
              endColumnId: "c",
            },
          ],
          anchor: { rowId: "r1", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    const payload = copyToClipboard.mock.calls[0]![0] as CopyPayload;
    expect(payload.text).not.toContain(ROW_SELECT_COLUMN_ID);
    // Three data columns × one row.
    expect(payload.text.split("\t").length).toBe(3);
    expect(payload.text.startsWith("\t")).toBe(false);
  });

  it("Cmd+Shift+C does not trigger copy", () => {
    const copyToClipboard = vi.fn();
    const view = renderCopyHarness({
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
    });
    fireEvent.keyDown(view.getByRole("grid"), {
      key: "c",
      metaKey: true,
      shiftKey: true,
    });

    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("a failed clipboard write is logged via console.warn and does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const copyToClipboard = vi.fn().mockRejectedValue(new Error("boom"));
    const view = renderCopyHarness({
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
    });

    expect(() => {
      fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });
    }).not.toThrow();

    // Flush the catch microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[pretable] clipboard copy failed",
      expect.any(Error),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — ARIA live region announcement tests
// ---------------------------------------------------------------------------

interface RenderAnnounceHarnessOpts {
  initialState?: PretableSurfaceState;
  rowSelectionColumn?: RowSelectionColumnConfig;
  copyToClipboard?: (payload: CopyPayload) => void | Promise<void>;
  messages?: PretableSurfaceMessages;
}

function renderAnnounceHarness(opts: RenderAnnounceHarnessOpts = {}) {
  return render(
    <PretableSurface
      ariaLabel="announce-grid"
      columns={gridColumns}
      copyToClipboard={opts.copyToClipboard}
      getRowId={(row: GridRow) => row.id}
      messages={opts.messages}
      overscan={0}
      rows={gridRows}
      rowSelectionColumn={opts.rowSelectionColumn}
      state={opts.initialState}
      viewportHeight={300}
    />,
  );
}

function getLiveRegion(view: ReturnType<typeof render>) {
  return view.container.querySelector(
    "[data-pretable-live-region]",
  ) as HTMLDivElement | null;
}

describe("aria-live announcements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Cmd+A announces 'All rows selected' after the debounce window", () => {
    const view = renderAnnounceHarness();
    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "a", metaKey: true });

    // Live region is empty before the debounce expires.
    expect(getLiveRegion(view)).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("All rows selected");
  });

  it("custom messages.selectAllAnnouncement overrides the default text", () => {
    const view = renderAnnounceHarness({
      messages: {
        selectAllAnnouncement: () => "MOCK SELECTION",
      },
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "a", metaKey: true });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("MOCK SELECTION");
  });

  it("clicking the header checkbox to select all visible rows announces all-selected", () => {
    const view = renderAnnounceHarness({
      rowSelectionColumn: { enabled: true, headerCheckbox: true },
    });
    fireEvent.click(getHeaderCheckbox(view)!);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("All rows selected");
  });

  it("clicking the header checkbox to deselect does not announce", () => {
    const view = renderAnnounceHarness({
      rowSelectionColumn: { enabled: true, headerCheckbox: true },
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: {
          ranges: gridRows.map((r) => fullRowRange(r.id)),
          anchor: { rowId: "r1", columnId: ROW_SELECT_COLUMN_ID },
        },
      },
    });

    // Sanity: header checkbox is fully checked before click.
    expect(getHeaderCheckbox(view)).toHaveAttribute("aria-checked", "true");
    fireEvent.click(getHeaderCheckbox(view)!);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("");
  });

  it("Cmd+C success announces '{n} rows × {m} columns copied'", async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    const view = renderAnnounceHarness({
      initialState: {
        focus: { rowId: "r1", columnId: "a" },
        selection: {
          ranges: [
            {
              startRowId: "r1",
              endRowId: "r2",
              startColumnId: "a",
              endColumnId: "a",
            },
          ],
          anchor: { rowId: "r1", columnId: "a" },
        },
      },
      copyToClipboard,
    });

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    // Let the resolved-promise .then handler run (which schedules announcement).
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("2 rows × 1 columns copied");
  });

  it("custom messages.copyAnnouncement overrides the default copy text", async () => {
    const copyToClipboard = vi.fn().mockResolvedValue(undefined);
    const view = renderAnnounceHarness({
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
      messages: {
        copyAnnouncement: ({ rowCount, columnCount }) =>
          `OVR ${rowCount}/${columnCount}`,
      },
    });

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("OVR 1/1");
  });

  it("Cmd+C failure announces 'Copy failed'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const copyToClipboard = vi.fn().mockRejectedValue(new Error("boom"));
    const view = renderAnnounceHarness({
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
    });

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("Copy failed");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("custom messages.copyFailedAnnouncement overrides the failure text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const copyToClipboard = vi.fn().mockRejectedValue(new Error("boom"));
    const view = renderAnnounceHarness({
      initialState: singleCellSelection("r1", "a"),
      copyToClipboard,
      messages: {
        copyFailedAnnouncement: () => "NOPE",
      },
    });

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("NOPE");
  });

  it("programmatic state.selection updates do not announce", () => {
    const view = render(
      <PretableSurface
        ariaLabel="announce-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        state={{
          focus: { rowId: "r1", columnId: "a" },
          selection: {
            ranges: [
              {
                startRowId: "r1",
                endRowId: "r1",
                startColumnId: "a",
                endColumnId: "a",
              },
            ],
            anchor: { rowId: "r1", columnId: "a" },
          },
        }}
        viewportHeight={300}
      />,
    );

    // Re-render with a much larger selection — programmatic, not user-driven.
    view.rerender(
      <PretableSurface
        ariaLabel="announce-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        state={{
          focus: { rowId: "r1", columnId: "a" },
          selection: {
            ranges: [
              {
                startRowId: "r1",
                endRowId: "r5",
                startColumnId: "a",
                endColumnId: "c",
              },
            ],
            anchor: { rowId: "r1", columnId: "a" },
          },
        }}
        viewportHeight={300}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(getLiveRegion(view)).toHaveTextContent("");
  });

  it("Cmd+C with an empty selection does not announce", () => {
    const copyToClipboard = vi.fn();
    const view = renderAnnounceHarness({
      initialState: {
        focus: { rowId: null, columnId: null },
        selection: { ranges: [], anchor: null },
      },
      copyToClipboard,
    });

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(getLiveRegion(view)).toHaveTextContent("");
  });
});

// ---------------------------------------------------------------------------
// Column resize gesture
// ---------------------------------------------------------------------------

describe("column resize", () => {
  function getResizeHandle(view: ReturnType<typeof render>, columnId: string) {
    return view.container.querySelector<HTMLDivElement>(
      `[data-pretable-resize-handle][data-pretable-column-id="${columnId}"]`,
    );
  }

  it("renders a resize handle for each non-synthetic resizable column", () => {
    const view = renderHarness();
    expect(getResizeHandle(view, "a")).toBeTruthy();
    expect(getResizeHandle(view, "b")).toBeTruthy();
    expect(getResizeHandle(view, "c")).toBeTruthy();
  });

  it("does not render a handle for column.resizable === false", () => {
    const cols = [
      { id: "a", header: "A", widthPx: 100, resizable: false },
      { id: "b", header: "B", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    expect(getResizeHandle(view, "a")).toBeNull();
    expect(getResizeHandle(view, "b")).toBeTruthy();
  });

  it("does not render a handle for the synthetic row-select column", () => {
    const view = renderHarness({
      rowSelectionColumn: { enabled: true },
    });
    expect(
      view.container.querySelector(
        `[data-pretable-resize-handle][data-pretable-column-id="${ROW_SELECT_COLUMN_ID}"]`,
      ),
    ).toBeNull();
    // sanity: real columns still have handles
    expect(getResizeHandle(view, "a")).toBeTruthy();
  });

  it("pointerDown + pointerMove + pointerUp commits the new width", () => {
    const onColumnWidthsChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnWidthsChange={onColumnWidthsChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );

    const handle = getResizeHandle(view, "a");
    expect(handle).toBeTruthy();
    if (!handle) return;

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    expect(onColumnWidthsChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
    expect(onColumnWidthsChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 });

    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
    const payload = onColumnWidthsChange.mock.calls[0]?.[0] as Record<
      string,
      number
    >;
    expect(payload.a).toBe(150);
  });

  it("resize honors per-column minWidthPx", () => {
    const cols = [
      { id: "a", header: "A", widthPx: 100, minWidthPx: 80 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const onColumnWidthsChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        onColumnWidthsChange={onColumnWidthsChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );

    const handle = getResizeHandle(view, "a");
    if (!handle) throw new Error("handle missing");

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: -100 });

    const payload = onColumnWidthsChange.mock.calls[0]?.[0] as Record<
      string,
      number
    >;
    expect(payload.a).toBe(80);
  });

  it("resize honors per-column maxWidthPx", () => {
    const cols = [
      { id: "a", header: "A", widthPx: 100, maxWidthPx: 200 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const onColumnWidthsChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        onColumnWidthsChange={onColumnWidthsChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );

    const handle = getResizeHandle(view, "a");
    if (!handle) throw new Error("handle missing");

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600 });

    const payload = onColumnWidthsChange.mock.calls[0]?.[0] as Record<
      string,
      number
    >;
    expect(payload.a).toBe(200);
  });

  it("drag-live width re-renders the cell during pointerMove", () => {
    const view = renderHarness();
    const handle = getResizeHandle(view, "a");
    if (!handle) throw new Error("handle missing");

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 175 });

    const cell = getCell(view, "r1", "a");
    expect(cell).toBeTruthy();
    // Live drag width should be reflected in the cell's inline width.
    expect(cell?.style.width).toBe("175px");
    expect(handle.getAttribute("data-pretable-dragging")).toBe("true");
  });

  it("double-click on handle calls autosize and fires onColumnWidthsChange", () => {
    const onColumnWidthsChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnWidthsChange={onColumnWidthsChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const handle = getResizeHandle(view, "a");
    if (!handle) throw new Error("handle missing");

    fireEvent.doubleClick(handle);

    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
    const payload = onColumnWidthsChange.mock.calls[0]?.[0] as Record<
      string,
      number
    >;
    expect(payload.a).toBeDefined();
    expect(payload.a).not.toBe(100);
  });

  it("drag followed by dblclick suppresses autosize (single onColumnWidthsChange call)", () => {
    const onColumnWidthsChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnWidthsChange={onColumnWidthsChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const handle = getResizeHandle(view, "a");
    if (!handle) throw new Error("handle missing");

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 });
    // dblclick that immediately follows should be suppressed
    fireEvent.doubleClick(handle);

    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
  });

  it("programmatic grid.setColumnWidth does not fire onColumnWidthsChange", () => {
    const onColumnWidthsChange = vi.fn();
    let capturedGrid: PretableGrid<GridRow> | null = null;
    render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnWidthsChange={onColumnWidthsChange}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );

    expect(capturedGrid).not.toBeNull();
    act(() => {
      capturedGrid!.setColumnWidth("a", 250);
    });

    expect(onColumnWidthsChange).not.toHaveBeenCalled();
  });

  it("controlled state.columnWidths round-trip drives cell width", () => {
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        state={{ columnWidths: { a: 250 } }}
        viewportHeight={300}
      />,
    );
    let cell = getCell(view, "r1", "a");
    expect(cell?.style.width).toBe("250px");

    view.rerender(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        state={{ columnWidths: { a: 320 } }}
        viewportHeight={300}
      />,
    );
    cell = getCell(view, "r1", "a");
    expect(cell?.style.width).toBe("320px");
  });

  it("pointer events on the resize handle do not trigger column sort", () => {
    const onSortChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="resize-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onSortChange={onSortChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const handle = getResizeHandle(view, "a");
    if (!handle) throw new Error("handle missing");
    const grid = view.getByRole("grid");
    const snapshotBefore = JSON.stringify(
      // header-row sort attribute proxy — none should be ascending/descending
      Array.from(
        grid.querySelectorAll<HTMLElement>("[data-pretable-header-cell]"),
      ).map((h) => h.getAttribute("aria-sort")),
    );

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });

    expect(onSortChange).not.toHaveBeenCalled();
    const snapshotAfter = JSON.stringify(
      Array.from(
        grid.querySelectorAll<HTMLElement>("[data-pretable-header-cell]"),
      ).map((h) => h.getAttribute("aria-sort")),
    );
    expect(snapshotAfter).toBe(snapshotBefore);
  });
});

describe("column reorder", () => {
  function getHeaderButton(view: ReturnType<typeof render>, label: string) {
    return view.getByLabelText(`Sort ${label}`) as HTMLButtonElement;
  }

  it("pointerDown + small move (<5px) + pointerUp + click triggers sort, not reorder", () => {
    const onColumnOrderChange = vi.fn();
    const onSortChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        onSortChange={onSortChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const header = getHeaderButton(view, "A");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 50,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 102,
      clientY: 50,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      clientX: 102,
      clientY: 50,
    });
    fireEvent.click(header);

    expect(onColumnOrderChange).not.toHaveBeenCalled();
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it("pointerDown + 6+px move + pointerUp triggers reorder", () => {
    const onColumnOrderChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const header = getHeaderButton(view, "A");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 250,
      clientY: 10,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      clientX: 250,
      clientY: 10,
    });

    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
  });

  it("reorder fires onColumnOrderChange with the post-move ordering", () => {
    const onColumnOrderChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    // Drag column "a" (mid 50) to past mid of column "c" (mid 250) → drop at end (index 2).
    const header = getHeaderButton(view, "A");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 260,
      clientY: 10,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      clientX: 260,
      clientY: 10,
    });

    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
    const payload = onColumnOrderChange.mock.calls[0]?.[0] as readonly string[];
    expect(payload).not.toContain(ROW_SELECT_COLUMN_ID);
    expect(Array.from(payload).sort()).toEqual(["a", "b", "c"]);
    // "a" should no longer be first.
    expect(payload[0]).not.toBe("a");
  });

  it("cross-boundary auto-pin: dragging unpinned into pinned region fires both callbacks", () => {
    const onColumnOrderChange = vi.fn();
    const onColumnPinnedChange = vi.fn();
    const cols = [
      { id: "a", header: "A", widthPx: 100, pinned: "left" as const },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        onColumnPinnedChange={onColumnPinnedChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    // Drag unpinned "c" (sits at index 2, mid 250) leftward to position 0.
    const header = getHeaderButton(view, "C");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 250,
      clientY: 10,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });

    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
    expect(onColumnPinnedChange).toHaveBeenCalledTimes(1);
    const pinnedPayload = onColumnPinnedChange.mock.calls[0]?.[0] as Record<
      string,
      "left" | null
    >;
    expect(pinnedPayload.c).toBe("left");
  });

  it("cross-boundary auto-unpin: dragging pinned into unpinned region fires both callbacks", () => {
    const onColumnOrderChange = vi.fn();
    const onColumnPinnedChange = vi.fn();
    const cols = [
      { id: "a", header: "A", widthPx: 100, pinned: "left" as const },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        onColumnPinnedChange={onColumnPinnedChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    // Drag pinned "a" (index 0) rightward past column "c" (mid 250) → drops in unpinned region.
    const header = getHeaderButton(view, "A");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 280,
      clientY: 10,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      clientX: 280,
      clientY: 10,
    });

    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
    expect(onColumnPinnedChange).toHaveBeenCalledTimes(1);
    const pinnedPayload = onColumnPinnedChange.mock.calls[0]?.[0] as Record<
      string,
      "left" | null
    >;
    expect(pinnedPayload.a).toBeNull();
  });

  it("Escape during drag cancels reorder without engine mutation", () => {
    const onColumnOrderChange = vi.fn();
    let capturedGrid: PretableGrid<GridRow> | null = null;
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const orderBefore = capturedGrid!.options.columns.map((c) => c.id);

    const header = getHeaderButton(view, "A");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 250,
      clientY: 10,
    });
    expect(
      view.container.querySelector("[data-pretable-reorder-ghost]"),
    ).toBeTruthy();

    const grid = view.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Escape" });

    expect(onColumnOrderChange).not.toHaveBeenCalled();
    expect(
      view.container.querySelector("[data-pretable-reorder-ghost]"),
    ).toBeNull();
    const orderAfter = capturedGrid!.options.columns.map((c) => c.id);
    expect(orderAfter).toEqual(orderBefore);
  });

  it("synthetic row-select column header is non-draggable", () => {
    const onColumnOrderChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        overscan={0}
        rows={gridRows}
        rowSelectionColumn={{ enabled: true }}
        viewportHeight={300}
      />,
    );
    const synthetic = view.container.querySelector<HTMLElement>(
      "[data-pretable-row-select-header]",
    );
    expect(synthetic).toBeTruthy();
    if (!synthetic) return;
    fireEvent.pointerDown(synthetic, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(synthetic, {
      pointerId: 1,
      clientX: 250,
      clientY: 10,
    });
    fireEvent.pointerUp(synthetic, {
      pointerId: 1,
      clientX: 250,
      clientY: 10,
    });
    expect(onColumnOrderChange).not.toHaveBeenCalled();
  });

  it("column.reorderable === false skips reorder", () => {
    const onColumnOrderChange = vi.fn();
    const cols = [
      { id: "a", header: "A", widthPx: 100, reorderable: false },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const header = getHeaderButton(view, "A");
    fireEvent.pointerDown(header, {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      clientX: 260,
      clientY: 10,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      clientX: 260,
      clientY: 10,
    });
    expect(onColumnOrderChange).not.toHaveBeenCalled();
  });

  it("programmatic grid.moveColumn does not fire reorder callbacks", () => {
    const onColumnOrderChange = vi.fn();
    const onColumnPinnedChange = vi.fn();
    let capturedGrid: PretableGrid<GridRow> | null = null;
    render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onColumnOrderChange={onColumnOrderChange}
        onColumnPinnedChange={onColumnPinnedChange}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    expect(capturedGrid).not.toBeNull();
    act(() => {
      capturedGrid!.moveColumn("a", 2);
    });
    expect(onColumnOrderChange).not.toHaveBeenCalled();
    expect(onColumnPinnedChange).not.toHaveBeenCalled();
  });

  it("controlled state.columnOrder round-trip drives engine column order", () => {
    let capturedGrid: PretableGrid<GridRow> | null = null;
    const view = render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={gridRows}
        state={{ columnOrder: ["b", "a", "c"] }}
        viewportHeight={300}
      />,
    );
    expect(capturedGrid!.options.columns.map((c) => c.id)).toEqual([
      "b",
      "a",
      "c",
    ]);

    view.rerender(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={gridRows}
        state={{ columnOrder: ["c", "b", "a"] }}
        viewportHeight={300}
      />,
    );
    expect(capturedGrid!.options.columns.map((c) => c.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("controlled state.columnPinned round-trip pins the column in the engine", () => {
    let capturedGrid: PretableGrid<GridRow> | null = null;
    render(
      <PretableSurface
        ariaLabel="reorder-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={gridRows}
        state={{ columnPinned: { c: "left" } }}
        viewportHeight={300}
      />,
    );
    const colC = capturedGrid!.options.columns.find((c) => c.id === "c");
    expect(colC?.pinned).toBe("left");
  });
});

// ---------------------------------------------------------------------------
// Phase D2 Task 4 — cell renderers pipeline + React.memo bailout coverage
// ---------------------------------------------------------------------------

describe("cell renderers", () => {
  it("column.format runs on every cell; formattedValue is the rendered text", () => {
    const cols = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        format: ({ value }: { value: unknown }) => `F:${String(value)}`,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="fmt-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    for (const row of gridRows) {
      const cell = view.container.querySelector(
        `[data-pretable-row][data-pretable-row-id="${row.id}"] [data-pretable-column-id="a"]`,
      );
      expect(cell?.textContent).toBe(`F:${row.a}`);
    }
  });

  it("column.render returning a custom ReactNode renders correctly", () => {
    const cols = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        render: ({ formattedValue }: { formattedValue: string }) => (
          <span data-testid="custom-cell">{formattedValue}</span>
        ),
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="render-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const customs = view.getAllByTestId("custom-cell");
    expect(customs.length).toBe(gridRows.length);
    expect(customs[0]?.textContent).toBe("a1");
  });

  it("column.renderHeader returning a custom ReactNode renders in the header", () => {
    const cols = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        renderHeader: ({ label }: { label: string }) => (
          <em data-testid="custom-header">{label}</em>
        ),
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="header-render-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const headerEl = view.getByTestId("custom-header");
    expect(headerEl.textContent).toBe("A");
  });

  it("per-column render overrides grid-level renderBodyCell", () => {
    const cols = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        render: () => <span data-testid="per-col">P</span>,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="precedence-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        renderBodyCell={() => <span data-testid="grid-level">G</span>}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    // Column "a" uses per-col
    const aCell = view.container.querySelector(
      `[data-pretable-row][data-pretable-row-id="r1"] [data-pretable-column-id="a"]`,
    );
    expect(aCell?.querySelector('[data-testid="per-col"]')).not.toBeNull();
    expect(aCell?.querySelector('[data-testid="grid-level"]')).toBeNull();
    // Column "b" uses grid-level fallback
    const bCell = view.container.querySelector(
      `[data-pretable-row][data-pretable-row-id="r1"] [data-pretable-column-id="b"]`,
    );
    expect(bCell?.querySelector('[data-testid="grid-level"]')).not.toBeNull();
    expect(bCell?.querySelector('[data-testid="per-col"]')).toBeNull();
  });

  it("format result reaches grid-level renderBodyCell via formattedValue", () => {
    const renderBodyCell = vi.fn(() => null);
    const cols = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        format: ({ value }: { value: unknown }) => `F:${String(value)}`,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    render(
      <PretableSurface
        ariaLabel="fmt-fallback-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        renderBodyCell={renderBodyCell}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const aCalls = renderBodyCell.mock.calls.filter(
      ([input]) => (input as { column: { id: string } }).column.id === "a",
    );
    expect(aCalls.length).toBe(gridRows.length);
    const firstA = aCalls[0]?.[0] as { formattedValue: string };
    expect(firstA.formattedValue).toBe("F:a1");
  });

  it("synthetic row-select column ignores per-column hooks and renders the built-in checkbox", () => {
    const view = renderHarness({ rowSelectionColumn: { enabled: true } });
    const selectCells = view.container.querySelectorAll(
      `[data-pretable-row-select-cell="true"]`,
    );
    expect(selectCells.length).toBe(gridRows.length);
    for (const cell of selectCells) {
      const btn = cell.querySelector('[data-pretable-row-select="true"]');
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-checked")).toBe("false");
      expect(btn?.getAttribute("aria-label")).toBe("Select row");
    }
  });

  it("memo bailout: column.render is not called again on irrelevant parent re-render", () => {
    const renderFn = vi.fn(({ formattedValue }: { formattedValue: string }) => (
      <span>{formattedValue}</span>
    ));
    const cols = [
      { id: "a", header: "A", widthPx: 100, render: renderFn },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];

    function Harness() {
      const [tick, setTick] = React.useState(0);
      return (
        <>
          <button data-testid="tick" onClick={() => setTick((t) => t + 1)}>
            tick {tick}
          </button>
          <PretableSurface
            ariaLabel="memo-bailout-grid"
            columns={cols}
            getRowId={(row: GridRow) => row.id}
            overscan={0}
            rows={gridRows}
            viewportHeight={300}
          />
        </>
      );
    }

    const view = render(<Harness />);
    const initialCalls = renderFn.mock.calls.length;
    expect(initialCalls).toBe(gridRows.length);
    fireEvent.click(view.getByTestId("tick"));
    expect(renderFn.mock.calls.length).toBe(initialCalls);
  });

  it("memo busts when value changes: cell text updates on rows re-render", () => {
    const view = render(
      <PretableSurface
        ariaLabel="value-change-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const targetCellSel = `[data-pretable-row][data-pretable-row-id="r1"] [data-pretable-column-id="a"]`;
    expect(view.container.querySelector(targetCellSel)?.textContent).toBe("a1");
    const updatedRows = gridRows.map((r) =>
      r.id === "r1" ? { ...r, a: "a1-updated" } : r,
    );
    view.rerender(
      <PretableSurface
        ariaLabel="value-change-grid"
        columns={gridColumns}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={updatedRows}
        viewportHeight={300}
      />,
    );
    expect(view.container.querySelector(targetCellSel)?.textContent).toBe(
      "a1-updated",
    );
  });

  it("memo busts when column.render reference changes", () => {
    const colsV1 = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        render: () => <span data-testid="v1">v1</span>,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="render-ref-grid"
        columns={colsV1}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    expect(view.queryAllByTestId("v1").length).toBe(gridRows.length);

    const colsV2 = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        render: () => <span data-testid="v2">v2</span>,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    view.rerender(
      <PretableSurface
        ariaLabel="render-ref-grid"
        columns={colsV2}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    expect(view.queryAllByTestId("v1").length).toBe(0);
    expect(view.queryAllByTestId("v2").length).toBe(gridRows.length);
  });

  it("memo busts when isFocused changes: render fn called again for newly focused cell", () => {
    const renderFn = vi.fn(({ formattedValue }: { formattedValue: string }) => (
      <span>{formattedValue}</span>
    ));
    const cols = [
      { id: "a", header: "A", widthPx: 100, render: renderFn },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];

    function Harness({ focusRowId }: { focusRowId: string | null }) {
      return (
        <PretableSurface
          ariaLabel="focus-memo-grid"
          columns={cols}
          getRowId={(row: GridRow) => row.id}
          overscan={0}
          rows={gridRows}
          state={
            focusRowId
              ? { focus: { rowId: focusRowId, columnId: "a" } }
              : undefined
          }
          viewportHeight={300}
        />
      );
    }

    const view = render(<Harness focusRowId="r1" />);
    const initialCalls = renderFn.mock.calls.length;
    // Controlled focus is applied in a layout effect (post-commit, pre-paint)
    // rather than during render, so the focused cell (r1/a) re-renders once
    // after mount when focus lands on it — one extra call beyond the per-row
    // baseline. The non-focused rows still render exactly once.
    expect(initialCalls).toBe(gridRows.length + 1);

    // Re-render with focus moved from r1 -> r2 (column "a"). r1 loses focus,
    // r2 gains focus, both isFocused props change -> both should re-render.
    view.rerender(<Harness focusRowId="r2" />);
    const r1Calls = renderFn.mock.calls.filter(
      ([input]) => (input as { rowId: string }).rowId === "r1",
    );
    const r2Calls = renderFn.mock.calls.filter(
      ([input]) => (input as { rowId: string }).rowId === "r2",
    );
    expect(r1Calls.length).toBeGreaterThanOrEqual(2);
    expect(r2Calls.length).toBeGreaterThanOrEqual(2);
  });

  it("default rendering uses formattedValue not raw value", () => {
    const cols = [
      {
        id: "a",
        header: "A",
        widthPx: 100,
        format: ({ value }: { value: unknown }) => `F:${String(value)}`,
      },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="default-fmt-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        viewportHeight={300}
      />,
    );
    const cell = view.container.querySelector(
      `[data-pretable-row][data-pretable-row-id="r1"] [data-pretable-column-id="a"]`,
    );
    expect(cell?.textContent).toBe("F:a1");
    expect(cell?.textContent).not.toBe("a1");
  });

  it("memo bailout: column.renderHeader is not called again on irrelevant parent re-render", () => {
    const renderHeaderFn = vi.fn(({ label }: { label: string }) => (
      <em>{label}</em>
    ));
    const cols = [
      { id: "a", header: "A", widthPx: 100, renderHeader: renderHeaderFn },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];

    function Harness() {
      const [tick, setTick] = React.useState(0);
      return (
        <>
          <button data-testid="htick" onClick={() => setTick((t) => t + 1)}>
            tick {tick}
          </button>
          <PretableSurface
            ariaLabel="header-memo-grid"
            columns={cols}
            getRowId={(row: GridRow) => row.id}
            overscan={0}
            rows={gridRows}
            viewportHeight={300}
          />
        </>
      );
    }

    const view = render(<Harness />);
    const initialCalls = renderHeaderFn.mock.calls.length;
    expect(initialCalls).toBe(1);
    fireEvent.click(view.getByTestId("htick"));
    expect(renderHeaderFn.mock.calls.length).toBe(initialCalls);
  });

  it("header memo busts when sortDirection changes", () => {
    const renderHeaderFn = vi.fn(
      ({
        label,
        sortDirection,
      }: {
        label: string;
        sortDirection: "asc" | "desc" | null;
      }) => <em data-testid={`hdr-${sortDirection ?? "none"}`}>{label}</em>,
    );
    const cols = [
      { id: "a", header: "A", widthPx: 100, renderHeader: renderHeaderFn },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ];
    const view = render(
      <PretableSurface
        ariaLabel="sort-bust-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        state={{ sort: { columnId: "a", direction: "desc" } }}
        viewportHeight={300}
      />,
    );
    const beforeCalls = renderHeaderFn.mock.calls.length;
    expect(view.queryByTestId("hdr-desc")).not.toBeNull();

    view.rerender(
      <PretableSurface
        ariaLabel="sort-bust-grid"
        columns={cols}
        getRowId={(row: GridRow) => row.id}
        overscan={0}
        rows={gridRows}
        state={{ sort: { columnId: "a", direction: "asc" } }}
        viewportHeight={300}
      />,
    );
    expect(renderHeaderFn.mock.calls.length).toBeGreaterThan(beforeCalls);
    expect(view.queryByTestId("hdr-asc")).not.toBeNull();
    expect(view.queryByTestId("hdr-desc")).toBeNull();
  });
});
