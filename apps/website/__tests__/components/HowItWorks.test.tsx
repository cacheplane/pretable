// apps/website/__tests__/components/HowItWorks.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { HowItWorks } from "../../app/components/HowItWorks";

afterEach(() => {
  cleanup();
});

it("renders the section header (eyebrow + h2)", () => {
  const { container } = render(<HowItWorks />);
  expect(container.textContent ?? "").toMatch(/how it works/i);
  const h2 = container.querySelector("h2");
  expect(h2).toBeInTheDocument();
  expect(h2?.textContent ?? "").toMatch(/deterministic pipeline/i);
});

it("renders five layers with correct names", () => {
  const { container } = render(<HowItWorks />);
  // Layer rows are <h3> headings — one per layer.
  const layerHeadings = container.querySelectorAll(
    "[data-testid='howitworks-layers'] h3",
  );
  expect(layerHeadings.length).toBe(5);
  const text = container.textContent ?? "";
  for (const name of ["Source", "Engine", "Viewport", "Renderer", "Frame"]) {
    expect(text).toContain(name);
  }
});

it("renders four callouts including the DOM/math callout", () => {
  const { container } = render(<HowItWorks />);
  const calloutHeadings = container.querySelectorAll(
    "[data-testid='howitworks-callouts'] h4",
  );
  expect(calloutHeadings.length).toBe(4);
  // The DOM/math callout was explicitly tweaked between spec drafts —
  // assert it specifically as a regression guard.
  expect(container.textContent ?? "").toMatch(/dom is expensive/i);
});
