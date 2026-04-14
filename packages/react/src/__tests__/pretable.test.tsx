import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";

import {
  Pretable,
  measureRenderedRowHeight,
  usePretableModel,
} from "../index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders a placeholder label", () => {
  const view = render(<Pretable rows={[]} columns={[]} />);

  expect(view.getByText("Pretable React adapter")).toBeInTheDocument();
});

it("exposes the benchmark viewport, content, row, and cell DOM markers", () => {
  const view = render(
    <Pretable
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      rows={[
        {
          id: "row-0",
          message: "Hello from Pretable",
        },
      ]}
    />,
  );

  const viewport = view.container.querySelector("[data-pretable-scroll-viewport]");
  const content = view.container.querySelector("[data-pretable-scroll-content]");
  const row = view.container.querySelector("[data-pretable-row]");
  const cells = row?.querySelectorAll("[data-pretable-cell]");

  expect(viewport).toHaveAttribute("role", "grid");
  expect(viewport).toHaveAttribute("tabindex", "0");
  expect(content).toBeInTheDocument();
  expect(view.getByRole("button", { name: "Sort Message" })).toBeInTheDocument();
  expect(row).toHaveAttribute("data-row-index", "0");
  expect(cells).toHaveLength(1);
});

it("preserves the benchmark viewport policy on the public wrapper path", () => {
  const view = render(
    <Pretable
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      rows={[
        {
          id: "row-0",
          message: "Hello from Pretable",
        },
      ]}
    />,
  );

  const viewport = view.getByRole("grid", { name: "Pretable React adapter" });

  expect(viewport).toHaveStyle({
    contain: "none",
    contentVisibility: "visible",
    containIntrinsicSize: "none",
    overflowAnchor: "none",
    overscrollBehavior: "contain",
  });
});

it("renders accessor-driven values correctly through the public wrapper", () => {
  const view = render(
    <Pretable
      columns={[
        {
          id: "fullName",
          header: "Full name",
          getValue: (row: { firstName: string; lastName: string }) =>
            `${row.firstName} ${row.lastName}`,
        },
      ]}
      rows={[
        {
          id: "person-0",
          firstName: "Ada",
          lastName: "Lovelace",
        },
      ]}
    />,
  );

  expect(view.getByText("Ada Lovelace")).toBeInTheDocument();
});

it("measures wrapped rows and applies the measured height back to data-row-height", async () => {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    borderBottomWidth: "1px",
    paddingBottom: "10px",
    paddingTop: "10px",
  } as CSSStyleDeclaration);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function scrollHeight() {
      if (
        this instanceof HTMLElement &&
        this.dataset.pretableCell !== undefined &&
        this.textContent?.includes("Tall measurement target")
      ) {
        return 180;
      }

      return 22;
    },
  );

  const view = render(
    <Pretable
      columns={[
        {
          id: "message",
          header: "Message",
          wrap: true,
        },
      ]}
      rows={[
        {
          id: "row-0",
          message: "Tall measurement target",
        },
      ]}
    />,
  );

  const row = view.getByTestId("pretable-row");

  await waitFor(() => {
    expect(row).toHaveAttribute("data-row-height", "201");
  });
});

it("renders a scrollable viewport and virtualizes rows on scroll", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `row-${index}`,
    message: `Row ${index}`,
  }));

  const view = render(
    <Pretable
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      rows={rows}
    />,
  );

  const viewport = view.getByRole("grid", { name: "Pretable React adapter" });

  expect(view.getByText("Row 0")).toBeInTheDocument();
  expect(view.queryByText("Row 99")).not.toBeInTheDocument();

  fireEvent.scroll(viewport, {
    target: {
      scrollTop: 44 * 90,
    },
  });

  expect(view.getByText("Row 90")).toBeInTheDocument();
});

it("uses caller-provided row ids in the public component path", () => {
  const rows = [
    {
      eventId: "evt-001",
      message: "First message",
    },
    {
      eventId: "evt-002",
      message: "Second message",
    },
  ];
  const view = render(
    <Pretable
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      getRowId={(row) => row.eventId}
      rows={rows}
    />,
  );

  const renderedRows = view.getAllByTestId("pretable-row");

  expect(renderedRows[0]).toHaveAttribute("data-row-id", "evt-001");
  expect(renderedRows[1]).toHaveAttribute("data-row-id", "evt-002");
});

it("measures rendered row height from the tallest cell plus row chrome", () => {
  const row = document.createElement("div");
  row.innerHTML = `
    <div data-pretable-cell=""></div>
    <div data-pretable-cell=""></div>
  `;
  Object.defineProperty(row, "querySelectorAll", {
    configurable: true,
    value: () => [...row.children],
  });
  Object.defineProperty(row.children[0]!, "scrollHeight", {
    configurable: true,
    value: 84,
  });
  Object.defineProperty(row.children[1]!, "scrollHeight", {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () =>
      ({
        paddingTop: "10px",
        paddingBottom: "10px",
        borderBottomWidth: "1px",
      }) satisfies Partial<CSSStyleDeclaration>,
  });

  expect(measureRenderedRowHeight(row)).toBe(141);
});

it("prefers wrapped cells when measuring rendered row height", () => {
  const row = document.createElement("div");
  row.innerHTML = `
    <div data-pretable-cell="" data-pretable-wrap="true"></div>
    <div data-pretable-cell=""></div>
  `;
  Object.defineProperty(row, "querySelectorAll", {
    configurable: true,
    value: row.querySelectorAll.bind(row),
  });
  Object.defineProperty(row.children[0]!, "scrollHeight", {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(row.children[1]!, "scrollHeight", {
    configurable: true,
    value: 240,
  });
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () =>
      ({
        paddingTop: "10px",
        paddingBottom: "10px",
        borderBottomWidth: "1px",
      }) satisfies Partial<CSSStyleDeclaration>,
  });

  expect(measureRenderedRowHeight(row)).toBe(141);
});

it("exposes a public render model hook that reacts to grid viewport updates", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `row-${index}`,
    message: index === 0 ? "Short row" : `Row ${index}`,
  }));
  const columns = [
    {
      id: "message",
      header: "Message",
      wrap: true,
      widthPx: 220,
    },
  ];
  const getRowId = (row: { id: string }) => row.id;
  const HookProbe = () => {
    const model = usePretableModel({
      columns,
      getRowId,
      rows,
      viewportHeight: 88,
      overscan: 0,
    });

    useEffect(() => {
      model.grid.setViewport({ scrollTop: 44 * 6, height: 88 });
    }, [model.grid]);

    return (
      <output
        data-first-row-id={model.renderSnapshot.rows[0]?.id ?? ""}
        data-rendered-row-ids={model.renderSnapshot.rows.map((row) => row.id).join(",")}
        data-kind={model.grid.kind}
        data-rendered-row-count={model.renderSnapshot.rows.length}
        data-total-height={model.renderSnapshot.totalHeight}
        data-total-width={model.renderSnapshot.totalWidth}
        data-total-rows={model.snapshot.totalRowCount}
      />
    );
  };

  const view = render(<HookProbe />);
  const output = view.container.querySelector("output");

  expect(output).toHaveAttribute("data-kind", "pretable-grid");
  expect(output).toHaveAttribute("data-total-rows", "12");
  expect(output).toHaveAttribute("data-total-width", "220");
  expect(output).toHaveAttribute("data-first-row-id", "row-4");
  expect(output).toHaveAttribute("data-rendered-row-ids", "row-4,row-5");
  expect(Number(output?.getAttribute("data-total-height"))).toBeGreaterThan(0);
  expect(Number(output?.getAttribute("data-rendered-row-count"))).toBe(2);
});

it("plans and reports visible rows from the provided body viewport height", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `row-${index}`,
    message: `Row ${index}`,
  }));
  const columns = [
    {
      id: "message",
      header: "Message",
    },
  ];
  const getRowId = (row: { id: string }) => row.id;

  const HookProbe = () => {
    const model = usePretableModel({
      columns,
      getRowId,
      rows,
      viewportHeight: 80,
      overscan: 0,
    });

    return (
      <output
        data-first-row-id={model.renderSnapshot.rows[0]?.id ?? ""}
        data-rendered-row-count={model.renderSnapshot.rows.length}
        data-visible-row-count={model.telemetry.visibleRowCount}
        data-visible-row-range={`${model.telemetry.visibleRowRange.start}:${model.telemetry.visibleRowRange.end}`}
      />
    );
  };

  const view = render(<HookProbe />);
  const output = view.container.querySelector("output");

  expect(output).toHaveAttribute("data-first-row-id", "row-0");
  expect(output).toHaveAttribute("data-rendered-row-count", "2");
  expect(output).toHaveAttribute("data-visible-row-count", "2");
  expect(output).toHaveAttribute("data-visible-row-range", "0:2");
});
