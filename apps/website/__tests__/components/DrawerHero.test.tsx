import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DrawerHero,
  DRAWER_HERO_PROMPT,
} from "../../app/components/DrawerHero";

describe("DrawerHero", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => cleanup());

  it("renders the eyebrow, headline, and subhead", () => {
    render(<DrawerHero />);
    expect(screen.getByText(/pretable — vol\. 2/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /fastest data grid/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/60fps under live market load/i)).toBeInTheDocument();
  });

  it("renders all three CTAs: copy prompt + npm install + docs link", () => {
    render(<DrawerHero />);
    expect(
      screen.getByRole("button", { name: /copy ai agent setup prompt/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy install command/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the docs/i }),
    ).toHaveAttribute("href", "/docs");
  });

  it("renders the MIT footer line", () => {
    render(<DrawerHero />);
    expect(screen.getByText(/mit licensed/i)).toBeInTheDocument();
  });

  it("exports a non-empty DRAWER_HERO_PROMPT mentioning @pretable/react", () => {
    expect(DRAWER_HERO_PROMPT.length).toBeGreaterThan(50);
    expect(DRAWER_HERO_PROMPT).toMatch(/@pretable\/react/);
    expect(DRAWER_HERO_PROMPT).toMatch(/https:\/\/pretable\.ai\/docs/);
  });
});
