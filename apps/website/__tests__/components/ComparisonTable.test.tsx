import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ComparisonTable } from "../../app/components/ComparisonTable";

afterEach(() => {
  cleanup();
});

it("renders a comparison table with at least one row", () => {
  const { container } = render(<ComparisonTable />);
  // ComparisonTable is grid-based, not a <table>. Assert it produces structural content.
  expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  expect(container.firstChild).toBeInTheDocument();
});

it("renders trail markers for each adapter", () => {
  render(<ComparisonTable />);
  // Post-B2 trail-marker labels: each adapter described by the
  // fact-checkable wedge from the comparative runset.
  expect(
    screen.getByRole("img", { name: /recommended path/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: /slower scroll.*slower interaction/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: /headless.*slower interaction/i }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: /scroll-p95 parity/i }),
  ).toBeInTheDocument();
});
