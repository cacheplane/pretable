// apps/website/__tests__/components/TrustStrip.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { TrustStrip } from "../../app/components/TrustStrip";

afterEach(() => {
  cleanup();
});

it("renders the Google Developer Experts pill", () => {
  const { container } = render(<TrustStrip />);
  expect(container.textContent ?? "").toMatch(/google developer experts/i);
});

it("renders the cacheplane attribution", () => {
  const { container } = render(<TrustStrip />);
  expect(container.textContent ?? "").toMatch(/cacheplane/i);
});

it("renders all four named financial-tier logos", () => {
  const { container } = render(<TrustStrip />);
  const text = container.textContent ?? "";
  expect(text).toContain("Santander");
  expect(text).toContain("M&T Bank");
  expect(text).toContain("The Motley Fool");
  expect(text).toContain("AG Grid");
});

it("renders the cheeky AG Grid line", () => {
  const { container } = render(<TrustStrip />);
  expect(container.textContent ?? "").toMatch(/yes,\s+that\s+ag\s+grid/i);
});
