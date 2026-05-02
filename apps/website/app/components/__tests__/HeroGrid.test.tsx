import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeroGrid } from "../HeroGrid";

describe("HeroGrid", () => {
  it("renders the streaming grid via PretableSurface (role=grid + accessible label)", () => {
    render(<HeroGrid />);
    expect(
      screen.getByRole("grid", { name: /pretable streaming demo/i }),
    ).toBeInTheDocument();
  });

  it("renders the top bar with the dataset metadata", () => {
    render(<HeroGrid />);
    expect(screen.getByText(/events\.stream/i)).toBeInTheDocument();
    expect(screen.getByText(/3,000 rows/i)).toBeInTheDocument();
  });

  it("exposes data-pretable-scroll-viewport via PretableSurface for bench parity", () => {
    const { container } = render(<HeroGrid />);
    expect(
      container.querySelector("[data-pretable-scroll-viewport]"),
    ).not.toBeNull();
  });
});
