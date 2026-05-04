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

it("renders the pipeline diagram above the layer cards", () => {
  const { container } = render(<HowItWorks />);
  const diagram = container.querySelector('[data-testid="pipeline-diagram"]');
  const layers = container.querySelector(
    '[data-testid="howitworks-layers"]',
  );
  expect(diagram).toBeInTheDocument();
  expect(layers).toBeInTheDocument();
  // Diagram must come before layer cards in the DOM.
  expect(
    diagram!.compareDocumentPosition(layers!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("renders five layer cards with the same border treatment (no per-layer accent)", () => {
  const { container } = render(<HowItWorks />);
  const cards = container.querySelectorAll(
    "[data-testid='howitworks-layers'] > *",
  );
  expect(cards.length).toBe(5);
  // Every card uses border-rule (none uses border-accent/40).
  for (const card of cards) {
    expect(card.className).toContain("border-rule");
    expect(card.className).not.toContain("border-accent/40");
  }
});

it("renders five layers with correct names", () => {
  const { container } = render(<HowItWorks />);
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
  expect(container.textContent ?? "").toMatch(/dom is expensive/i);
});
