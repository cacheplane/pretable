import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroGrid } from "../HeroGrid";
import { ControlStateProvider } from "../heroGrid/controlState";

const renderHeroGrid = () =>
  render(
    <ControlStateProvider>
      <HeroGrid />
    </ControlStateProvider>,
  );

describe("HeroGrid", () => {
  // The global setup stubs requestAnimationFrame as a no-op. We don't need
  // a real rAF here because we only test structural rendering, not streaming
  // behavior (covered by replay-engine.test.ts).
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("wraps the grid in a bezel container with the expected testid", () => {
    renderHeroGrid();
    expect(screen.getByTestId("hero-bezel")).toBeInTheDocument();
  });

  it("renders the portfolio summary sidebar inside the bezel", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("complementary", { name: /portfolio summary/i }),
    ).toBeInTheDocument();
  });

  it("renders the portfolio grid with an accessible label", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("grid", {
        name: /live portfolio positions/i,
      }),
    ).toBeInTheDocument();
  });
});
