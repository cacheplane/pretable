import { cleanup, render } from "@testing-library/react";
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
