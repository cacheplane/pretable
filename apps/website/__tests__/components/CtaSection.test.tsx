import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CtaSection } from "../../app/components/CtaSection";

afterEach(() => {
  cleanup();
});

it("renders the CTA section with at least one link", () => {
  const { container } = render(<CtaSection />);
  expect(container.querySelector("a")).toBeInTheDocument();
});
