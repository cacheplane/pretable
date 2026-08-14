import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DistinctValuesDemo } from "../DistinctValuesDemo";

describe("DistinctValuesDemo", () => {
  it("loads all 12 teams on mount", async () => {
    render(<DistinctValuesDemo />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("12 matching teams");
    });
    expect(screen.getByText(/payments/)).toBeInTheDocument();
  });

  it("narrows to a search term", async () => {
    render(<DistinctValuesDemo />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("12 matching teams"),
    );

    fireEvent.change(screen.getByLabelText(/search teams/i), {
      target: { value: "pay" },
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 matching team");
    });
    expect(screen.getByText(/payments/)).toBeInTheDocument();
  });

  it("only keeps the result of the latest search when typed quickly", async () => {
    render(<DistinctValuesDemo />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("12 matching teams"),
    );

    const input = screen.getByLabelText(/search teams/i);
    fireEvent.change(input, { target: { value: "s" } });
    fireEvent.change(input, { target: { value: "se" } });
    fireEvent.change(input, { target: { value: "sec" } });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("1 matching team");
    });
    expect(screen.getByText(/security/)).toBeInTheDocument();
  });
});
