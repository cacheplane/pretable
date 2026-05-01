import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { PositioningStrip } from "../../app/components/PositioningStrip";

afterEach(() => {
  cleanup();
});

it("renders four differentiation cards", () => {
  const { container } = render(<PositioningStrip />);
  const headings = container.querySelectorAll("h3");
  expect(headings.length).toBe(4);
});

it("includes the Performance card with the bench:matrix verification line", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/performance/i);
  expect(container.textContent ?? "").toContain("pnpm bench:matrix");
});

it("includes the AI-native card", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/ai-native|ai isn't a feature/i);
});

it("includes the Wrapped text card", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/wrapped text|multi-line/i);
});

it("includes the Ecosystem card mentioning the AI SDKs", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/ecosystem/i);
  expect(container.textContent ?? "").toMatch(
    /vercel ai sdk|openai responses|langgraph/i,
  );
});
