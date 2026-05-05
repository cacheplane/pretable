import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs/grid/pretable-component",
}));

import { DocsSidebar } from "../DocsSidebar";

describe("DocsSidebar", () => {
  it("renders all _nav.ts groups", () => {
    render(<DocsSidebar />);
    expect(screen.getByText(/Getting Started/i)).toBeInTheDocument();
    expect(screen.getByText(/^Grid$/)).toBeInTheDocument();
    expect(screen.getByText(/^Streaming$/)).toBeInTheDocument();
    expect(screen.getByText(/^Theming$/)).toBeInTheDocument();
  });
  it("marks active link with aria-current=page", () => {
    render(<DocsSidebar />);
    expect(
      screen.getByRole("link", { name: /<Pretable> component/i }),
    ).toHaveAttribute("aria-current", "page");
  });
  it("does not mark sibling group entries as active", () => {
    render(<DocsSidebar />);
    const apiRefs = screen.getAllByRole("link", { name: /API reference/i });
    apiRefs.forEach((el) => {
      expect(el).not.toHaveAttribute("aria-current", "page");
    });
  });
});
