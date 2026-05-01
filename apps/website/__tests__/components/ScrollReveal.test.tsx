import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ScrollReveal } from "../../app/components/ScrollReveal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders its children", () => {
  const { getByText } = render(
    <ScrollReveal>
      <p>visible-marker</p>
    </ScrollReveal>,
  );
  expect(getByText("visible-marker")).toBeInTheDocument();
});

it("registers an IntersectionObserver on the wrapper", () => {
  const observeSpy = vi.fn();
  class SpyObserver {
    observe = observeSpy;
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  // Override the global mock just for this test.
  globalThis.IntersectionObserver =
    SpyObserver as unknown as typeof IntersectionObserver;

  render(
    <ScrollReveal>
      <p>child</p>
    </ScrollReveal>,
  );

  expect(observeSpy).toHaveBeenCalledTimes(1);
});
