import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { FeatureGrid } from "../../app/components/FeatureGrid";

afterEach(() => {
  cleanup();
});

it("renders a feature grid with multiple feature blocks", () => {
  const { container } = render(<FeatureGrid />);
  // Assert at least two heading-bearing children. The grid renders ≥6 features
  // so two is a conservative floor that won't churn if a feature is renamed.
  const headings = container.querySelectorAll("h3, h4");
  expect(headings.length).toBeGreaterThanOrEqual(2);
});
