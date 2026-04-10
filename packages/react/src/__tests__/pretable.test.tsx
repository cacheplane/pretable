import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Pretable, measureRenderedRowHeight } from "../index";

afterEach(() => {
  cleanup();
});

it("renders a placeholder label", () => {
  const view = render(<Pretable rows={[]} columns={[]} />);

  expect(view.getByText("Pretable React adapter")).toBeInTheDocument();
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

it("renders variable row heights for wrapped benchmark-style data", () => {
  const columns = [
    { id: "col_0", header: "Wrapped 0", wrap: true, widthPx: 220 },
    { id: "col_1", header: "Wrapped 1", wrap: true, widthPx: 220 },
    { id: "col_2", header: "Wrapped 2", wrap: true, widthPx: 220 },
    { id: "col_3", header: "Status", widthPx: 140 },
  ];
  const rows = [
    {
      id: "row-0",
      col_0: "Short row",
      col_1: "Short row",
      col_2: "Short row",
      col_3: "ready",
    },
    {
      id: "row-1",
      col_0:
        "A much longer multilingual row that should wrap across several lines in the benchmark renderer surface.",
      col_1:
        "Bonjour depuis Pretable with enough extra text to force the estimated height above the fixed baseline.",
      col_2:
        "Pretableからこんにちは and another clause to keep the row taller than the compact baseline.",
      col_3: "running",
    },
  ];
  const view = render(
    <Pretable columns={columns} rows={rows} />,
  );

  const rowHeights = view
    .getAllByTestId("pretable-row")
    .map((row) => Number(row.getAttribute("data-row-height")));

  expect(new Set(rowHeights).size).toBeGreaterThan(1);
  expect(rowHeights.some((height) => height > 44)).toBe(true);
  expect(Math.max(...rowHeights)).toBeGreaterThanOrEqual(140);
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
