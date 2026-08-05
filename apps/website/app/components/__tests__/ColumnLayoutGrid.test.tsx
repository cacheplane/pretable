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

describe("ColumnLayoutGrid", () => {
  const original = globalThis.IntersectionObserver;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
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
      expect((cell as HTMLElement).style.position).toBe("sticky");
      expect((cell as HTMLElement).style.right).toBe("0px");
    }

    // No other column is pinned.
    expect(
      container.querySelectorAll("[data-pretable-cell][data-pretable-pinned]")
        .length,
    ).toBe(noteCells.length);
  });
});
