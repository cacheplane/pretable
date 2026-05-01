// apps/website/__tests__/components/UseCases.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { UseCases } from "../../app/components/UseCases";

afterEach(() => {
  cleanup();
});

it("renders three use-case cards (3 h3 headings under the section h2)", () => {
  const { container } = render(<UseCases />);
  const cardHeadings = container.querySelectorAll("h3");
  expect(cardHeadings.length).toBe(3);
});

it("renders the section heading 'If you're shipping live data...'", () => {
  const { container } = render(<UseCases />);
  expect(container.textContent ?? "").toMatch(/if you're shipping live data/i);
});

it("includes a card for AI-driven analytics dashboards", () => {
  const { container } = render(<UseCases />);
  expect(container.textContent ?? "").toMatch(/ai-driven analytics/i);
});

it("includes a card for real-time financial dashboards (key ICP)", () => {
  const { container } = render(<UseCases />);
  expect(container.textContent ?? "").toMatch(/real-time financial/i);
});

it("renders integration chips on each card", () => {
  const { container } = render(<UseCases />);
  // chips are styled spans with mono font; minimum 9 chips total (3 per card)
  expect(container.textContent ?? "").toMatch(/openai responses/i);
  expect(container.textContent ?? "").toMatch(/langgraph/i);
  expect(container.textContent ?? "").toMatch(/websocket/i);
});
