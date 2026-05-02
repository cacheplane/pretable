import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { FeatureGrid } from "../../app/components/FeatureGrid";

afterEach(() => {
  cleanup();
});

it("renders four feature cards", () => {
  render(<FeatureGrid />);
  const cards = screen.getAllByRole("listitem");
  expect(cards).toHaveLength(4);
});

it("renders a trail marker on each feature card", () => {
  render(<FeatureGrid />);
  const markers = screen.getAllByRole("img");
  expect(markers.length).toBeGreaterThanOrEqual(4);
});
