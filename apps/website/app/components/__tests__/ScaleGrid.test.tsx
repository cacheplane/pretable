import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaleGrid } from "../showcase/ScaleGrid";
import { TOTAL_CELLS } from "../showcase/scaleData";

// Firing IntersectionObserver so useInView mounts the grid.
class FiringIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

describe("ScaleGrid", () => {
  const original = globalThis.IntersectionObserver;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  it("shows the model-cell total and renders far fewer cells than the model", async () => {
    const { container } = render(<ScaleGrid />);
    // Counter shows the formatted model total (1,250,000).
    expect(
      screen.getByText(TOTAL_CELLS.toLocaleString("en-US"), { exact: false }),
    ).toBeInTheDocument();
    // The grid mounts and renders SOME cells, but far fewer than rows*cols.
    await waitFor(() => {
      const cells = container.querySelectorAll("[data-pretable-cell]").length;
      expect(cells).toBeGreaterThan(0);
      expect(cells).toBeLessThan(TOTAL_CELLS);
    });
  });
});
