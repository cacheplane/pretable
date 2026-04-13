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
  test("filters rows by column input without leaving the placeholder scaffold behind", () => {
    render(<App />);

    expect(
      screen.queryByText("Manual debugging, tiny repros, and adapter smoke tests."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Read-heavy inspection table")).toBeInTheDocument();

    expect(screen.getByRole("grid", { name: "Inspection grid" })).toHaveAttribute(
      "data-pretable-scroll-viewport",
      "",
    );

    fireEvent.change(screen.getByLabelText("Filter Severity"), {
      target: { value: "error" },
    });

    const rows = screen.getAllByTestId("pretable-row");

    expect(rows).toHaveLength(2);
    expect(screen.getByText("2 matching rows")).toBeInTheDocument();
    expect(screen.queryByText("Trace")).not.toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("data-row-id", "evt-002");
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
    expect(rows[0]).toHaveAttribute("data-row-id", "evt-007");

    fireEvent.click(timestampHeader);

    rows = screen.getAllByTestId("pretable-row");
    expect(rows[0]).toHaveAttribute("data-row-id", "evt-001");
  });

  test("row selection and arrow navigation update the detail panel", () => {
    render(<App />);

    fireEvent.click(screen.getAllByTestId("pretable-row")[0]!);

    expect(screen.getByText("Selected event")).toBeInTheDocument();
    expect(screen.getByText("evt-001")).toBeInTheDocument();

    return waitFor(() => {
      const firstRow = screen.getAllByTestId("pretable-row")[0];

      expect(firstRow).toHaveAttribute("data-selected", "true");
      expect(firstRow).toHaveAttribute("data-focused", "true");
    }).then(() => {
      const viewport = screen.getByRole("grid", { name: "Inspection grid" });
      viewport.focus();
      fireEvent.keyDown(viewport, { key: "ArrowDown" });

      const detail = screen.getByTestId("inspection-detail");

      expect(within(detail).getByText("evt-002")).toBeInTheDocument();
      expect(within(detail).getByText("error")).toBeInTheDocument();
    });
  });
});
