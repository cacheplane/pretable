import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { HeroGrid } from "../HeroGrid";

const renderHeroGrid = () =>
  render(
    <ControlStateProvider>
      <HeroGrid />
    </ControlStateProvider>,
  );

describe("HeroGrid", () => {
  it("renders the streaming grid via PretableSurface (role=grid + accessible label)", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("grid", { name: /pretable streaming demo/i }),
    ).toBeInTheDocument();
  });

  it("exposes data-pretable-scroll-viewport via PretableSurface for bench parity", () => {
    const { container } = renderHeroGrid();
    expect(
      container.querySelector("[data-pretable-scroll-viewport]"),
    ).not.toBeNull();
  });
});
