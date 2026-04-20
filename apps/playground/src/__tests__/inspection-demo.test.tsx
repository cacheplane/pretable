import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { App } from "../app";

afterEach(() => {
  cleanup();
});

describe("playground inspection demo", () => {
  test("defaults to a large local-inspection dataset and lets the user switch scales", () => {
    render(<App />);

    const scaleSelect = screen.getByLabelText("Dataset scale");

    expect(scaleSelect).toHaveValue("dev");
    expect(screen.getByText("250 matching rows")).toBeInTheDocument();

    fireEvent.change(scaleSelect, {
      target: { value: "tiny" },
    });

    expect(screen.getByText("7 matching rows")).toBeInTheDocument();

    fireEvent.change(scaleSelect, {
      target: { value: "stress" },
    });

    expect(screen.getByText("2500 matching rows")).toBeInTheDocument();
  });

  test("renders shared diagnostics for local inspection without scraping the grid DOM", () => {
    render(<App />);

    const diagnostics = screen.getByTestId("inspection-diagnostics");

    expect(within(diagnostics).getByText("Rendered rows")).toBeInTheDocument();
    expect(within(diagnostics).getByText("Selected row")).toBeInTheDocument();
    expect(within(diagnostics).getByText("none")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("pretable-row")[0]!);

    expect(within(diagnostics).getByText("evt-dev-0000")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dataset scale"), {
      target: { value: "stress" },
    });

    expect(within(diagnostics).getByText("stress")).toBeInTheDocument();
  });

  test("filters rows by column input without leaving the placeholder scaffold behind", () => {
    render(<App />);

    expect(
      screen.queryByText(
        "Manual debugging, tiny repros, and adapter smoke tests.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Read-heavy inspection table")).toBeInTheDocument();

    expect(
      screen.getByRole("grid", { name: "Inspection grid" }),
    ).toHaveAttribute("data-pretable-scroll-viewport", "");

    fireEvent.change(screen.getByLabelText("Filter Severity"), {
      target: { value: "error" },
    });

    const rows = screen.getAllByTestId("pretable-row");

    expect(rows).toHaveLength(7);
    expect(screen.getByText("62 matching rows")).toBeInTheDocument();
    expect(screen.queryByText("Trace")).not.toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("data-row-id", "evt-dev-0002");
    expect(rows[0]?.querySelector("[data-pretable-cell]")).toHaveAttribute(
      "data-pretable-cell",
      "",
    );
    expect(
      screen.getByRole("button", { name: "Sort Timestamp" }),
    ).toHaveAttribute("data-pinned", "left");
  });

  test("sort toggles reorder the rendered rows", () => {
    render(<App />);

    const timestampHeader = screen.getByRole("button", {
      name: "Sort Timestamp",
    });

    fireEvent.click(timestampHeader);

    let rows = screen.getAllByTestId("pretable-row");
    expect(rows[0]).toHaveAttribute("data-row-id", "evt-dev-0249");

    fireEvent.click(timestampHeader);

    rows = screen.getAllByTestId("pretable-row");
    expect(rows[0]).toHaveAttribute("data-row-id", "evt-dev-0000");
  });

  test("row selection and arrow navigation update the detail panel", () => {
    render(<App />);
    const detail = screen.getByTestId("inspection-detail");

    fireEvent.click(screen.getAllByTestId("pretable-row")[0]!);

    expect(screen.getByText("Selected event")).toBeInTheDocument();
    expect(within(detail).getByText("evt-dev-0000")).toBeInTheDocument();

    return waitFor(() => {
      const firstRow = screen.getAllByTestId("pretable-row")[0];

      expect(firstRow).toHaveAttribute("data-selected", "true");
      expect(firstRow).toHaveAttribute("data-focused", "true");
    }).then(() => {
      const viewport = screen.getByRole("grid", { name: "Inspection grid" });
      viewport.focus();
      fireEvent.keyDown(viewport, { key: "ArrowDown" });

      expect(within(detail).getByText("evt-dev-0001")).toBeInTheDocument();
      expect(within(detail).getByText("warn")).toBeInTheDocument();
    });
  });

  test("selection persists in the detail panel when filters hide the selected row", () => {
    render(<App />);

    fireEvent.click(screen.getAllByTestId("pretable-row")[0]!);
    fireEvent.change(screen.getByLabelText("Filter Severity"), {
      target: { value: "error" },
    });

    const detail = screen.getByTestId("inspection-detail");

    expect(within(detail).getByText("evt-dev-0000")).toBeInTheDocument();
    expect(within(detail).getByText("info")).toBeInTheDocument();
    expect(screen.getByText("62 matching rows")).toBeInTheDocument();
  });
});
