import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import * as rowHeight from "../../row-height";
import { usePretableModel } from "../../use-pretable";

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
    const headerButton = view.getByRole("button", { name: "Sort Timestamp" });
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
    expect(scrollContent).toHaveStyle({ height: "192px" });
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

    const pinnedHeader = view.getByRole("button", { name: "Sort Timestamp" });
    const headerRow = pinnedHeader.parentElement!;
    const allHeaderButtons = view.getAllByRole("button", {
      name: /^Sort /,
    });
    const absoluteHeader = view.getByRole("button", { name: "Sort Tags" });

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

    const severityButton = view.getByRole("button", { name: "Sort Severity" });

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

      expect(shortRow).toHaveAttribute("data-row-height", "64");
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

    const timestampHeader = view.getByRole("button", {
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
});
