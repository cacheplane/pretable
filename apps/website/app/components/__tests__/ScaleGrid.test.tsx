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

  // jsdom has no layout, so column virtualization can't engage (clientWidth is
  // 0) and the surface renders all 501 columns for the visible rows. That makes
  // the synchronous mount heavy — fast locally but several seconds on CI's
  // slower runners — so this test gets a generous timeout. The real
  // virtualization proof (DOM cells far below the model) lives in the Playwright
  // smoke, which runs in a browser with real layout.
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
  }, 30_000);
});
