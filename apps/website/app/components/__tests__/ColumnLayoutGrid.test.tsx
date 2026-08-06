import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnLayoutGrid } from "../showcase/ColumnLayoutGrid";

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

// jsdom has no layout, so every element reports clientWidth 0. A right-pinned
// column resolves its sticky inset against the scrollport's width, so the width
// has to be stubbed for the emitted inline style to be meaningful. Real
// stickiness is asserted in a browser by apps/website/e2e/smoke.spec.ts.
const VIEWPORT_WIDTH = 1240;
const NOTE_WIDTH = 240;

describe("ColumnLayoutGrid", () => {
  const original = globalThis.IntersectionObserver;
  let originalClientWidth: PropertyDescriptor | undefined;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => VIEWPORT_WIDTH,
    });
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        originalClientWidth,
      );
    }
  });

  it("renders the portfolio headers and a working reset button", async () => {
    render(<ColumnLayoutGrid />);
    await waitFor(() => {
      expect(screen.getByText("Symbol")).toBeInTheDocument();
      expect(screen.getByText("Analyst note")).toBeInTheDocument();
    });
    // Reset remounts the grid; the headers are still present afterward.
    fireEvent.click(screen.getByTestId("reset-layout"));
    await waitFor(() => {
      expect(screen.getByText("Symbol")).toBeInTheDocument();
    });
  });

  it("renders the analyst note column pinned right", async () => {
    const { container } = render(<ColumnLayoutGrid />);
    await waitFor(() => {
      expect(screen.getByText("Symbol")).toBeInTheDocument();
    });

    const noteCells = container.querySelectorAll(
      '[data-pretable-cell][data-pretable-column-id="note"]',
    );
    expect(noteCells.length).toBeGreaterThan(0);
    for (const cell of noteCells) {
      expect(cell).toHaveAttribute("data-pretable-pinned", "right");
      // Last column in the grid → flush against the viewport's right edge.
      // Right-pinning is expressed as a sticky `left` inset (a `right` inset
      // cannot push a box forward past its flow position in these flex rows),
      // so the leading edge lands at viewportWidth - width.
      expect((cell as HTMLElement).style.position).toBe("sticky");
      expect((cell as HTMLElement).style.left).toBe(
        `${VIEWPORT_WIDTH - NOTE_WIDTH}px`,
      );
      expect((cell as HTMLElement).style.right).toBe("");
    }

    // No other column is pinned.
    expect(
      container.querySelectorAll("[data-pretable-cell][data-pretable-pinned]")
        .length,
    ).toBe(noteCells.length);
  });
});
