import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RejectedWritesShowcase } from "../RejectedWritesShowcase";

// The grid child needs the IO stub; stub the whole grid instead — the shell
// test is about the section, and the grid has its own suite.
vi.mock("../showcase/RejectedWritesGrid", () => ({
  RejectedWritesGrid: () => <div data-testid="rw-grid-stub" />,
}));

describe("RejectedWritesShowcase", () => {
  it("renders the numbered eyebrow, headline, and the grid", () => {
    render(<RejectedWritesShowcase />);
    expect(screen.getByText("10 · when the data goes bad")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /shouldn't blank your grid/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rw-grid-stub")).toBeInTheDocument();
    expect(document.querySelector("#rejected-writes")).not.toBeNull();
  });

  it("the code strip teaches the real wiring — onRejectedWriteChange is on the page", () => {
    render(<RejectedWritesShowcase />);
    // Drift guard: the strip's key line must not silently vanish (the docs
    // guard cannot see homepage components).
    expect(screen.getByTestId("rw-code-strip").textContent).toContain(
      "onRejectedWriteChange",
    );
    expect(screen.getByTestId("rw-code-strip").textContent).toContain(
      "rejected?.rows",
    );
  });
});
