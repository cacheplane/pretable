import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroGrid } from "../HeroGrid";
import { ControlStateProvider } from "../heroGrid/controlState";

const renderHeroGrid = () =>
  render(
    <ControlStateProvider>
      <HeroGrid />
    </ControlStateProvider>,
  );

const stubMatchMedia = (matches: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

/**
 * jsdom ships neither `ClipboardEvent` nor `DataTransfer`, so a paste is a
 * plain bubbling/cancelable `Event` carrying the slice of `clipboardData` the
 * surface listener actually reads. The real browser path is covered by the
 * Playwright smoke test.
 */
const firePaste = (target: Element, text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  fireEvent(target, event);
};

const visibleRowIds = (): string[] =>
  [...document.querySelectorAll("[data-pretable-row]")].map(
    (row) => row.getAttribute("data-pretable-row-id") ?? "",
  );

const qtyCell = (rowId: string) =>
  document.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="qty"]`,
  ) as HTMLElement;

const groupRowNamed = (label: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>("[data-pretable-group-row]")].find(
    (row) =>
      row.querySelector("[data-pretable-group-label]")?.textContent === label,
  ) ?? null;

describe("HeroGrid", () => {
  // The global setup stubs requestAnimationFrame as a no-op. We don't need
  // a real rAF here because we only test structural rendering, not streaming
  // behavior (covered by replay-engine.test.ts).
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("wraps the grid in a bezel container with the expected testid", () => {
    renderHeroGrid();
    expect(screen.getByTestId("hero-bezel")).toBeInTheDocument();
  });

  it("renders the portfolio summary sidebar inside the bezel", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("complementary", { name: /portfolio summary/i }),
    ).toBeInTheDocument();
  });

  it("renders the portfolio grid with an accessible label", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("grid", {
        name: /live portfolio positions/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders built-in filter funnels on filterable columns", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("button", { name: "Filter Sector" }),
    ).toBeInTheDocument();
  });

  it("mentions paste in the legend", () => {
    renderHeroGrid();
    expect(screen.getByText(/⌘V paste into\s+Qty/i)).toBeInTheDocument();
  });

  it("starts ungrouped with an empty grouping panel and direct legend", () => {
    stubMatchMedia(true);
    renderHeroGrid();
    expect(
      document.querySelector("[data-pretable-group-panel]"),
    ).toHaveTextContent("Drag a column here to group");
    expect(
      screen.getByRole("grid", { name: /live portfolio positions/i }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll("[data-pretable-group-row]")).toHaveLength(
      0,
    );
    expect(screen.getByTestId("summary-nav")).toHaveTextContent("$66.1M");
    expect(
      screen.getByRole("grid", { name: /live portfolio positions/i }),
    ).toHaveAttribute("aria-rowcount", "21");
    expect(screen.getByText(/drag to group/i)).toBeInTheDocument();
  });

  it("groups Sector through its column menu", async () => {
    stubMatchMedia(true);
    renderHeroGrid();
    const menuButton = screen.getByRole("button", {
      name: /column menu for sector/i,
    });
    fireEvent.pointerDown(menuButton);
    fireEvent.click(menuButton);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /group by this column/i }),
    );
    await waitFor(
      () =>
        expect(
          document.querySelector("[data-pretable-group-row]"),
        ).not.toBeNull(),
      { interval: 250, timeout: 5_000 },
    );
    expect(
      screen.getByRole("treegrid", { name: /live portfolio positions/i }),
    ).toBeInTheDocument();
  }, 10_000);

  it("keeps grouping and leaf-row sidebar totals through replay updates", async () => {
    const rafCallbacks: Array<(timestamp: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const flushAnimationFrame = (timestamp: number) => {
      const callbacks = rafCallbacks.splice(0);
      for (const callback of callbacks) callback(timestamp);
    };

    renderHeroGrid();
    await waitFor(() => {
      expect(screen.getByTestId("summary-nav")).toHaveTextContent("$66.1M");
      expect(
        screen.getByRole("grid", { name: /live portfolio positions/i }),
      ).toHaveAttribute("aria-rowcount", "21");
    });
    await act(async () => {
      flushAnimationFrame(0);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /column menu for sector/i }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: /group by this column/i }),
    );
    await waitFor(() => expect(groupRowNamed("Consumer")).not.toBeNull(), {
      interval: 250,
      timeout: 5_000,
    });

    const panel = document.querySelector("[data-pretable-group-panel]");
    const aggregateBefore = groupRowNamed("Consumer")!.querySelector(
      '[data-pretable-column-id="dayPnl"]',
    )!.textContent;
    const sidebarBefore = screen.getByTestId("summary-pnl").textContent;
    expect(screen.getByTestId("summary-nav")).toHaveTextContent("$66.1M");

    await act(async () => {
      flushAnimationFrame(1_000);
      flushAnimationFrame(1_016);
    });

    await waitFor(() => {
      expect(
        groupRowNamed("Consumer")!.querySelector(
          '[data-pretable-column-id="dayPnl"]',
        ),
      ).not.toHaveTextContent(aggregateBefore ?? "");
      expect(screen.getByTestId("summary-pnl")).not.toHaveTextContent(
        sidebarBefore ?? "",
      );
    });
    expect(panel).toHaveTextContent("Sector");
    expect(
      screen.getByRole("treegrid", { name: /live portfolio positions/i }),
    ).toBeInTheDocument();
  }, 10_000);
});

describe("HeroGrid paste", () => {
  // Reduced motion seeds the settled book synchronously, so rows exist without
  // the (rAF-stubbed) replay engine ever ticking.
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    stubMatchMedia(true);
  });
  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("applies a pasted qty block and reports the count in the sidebar", async () => {
    renderHeroGrid();
    // The book is ranked by weight, not roster order, so read the neighbour the
    // block's second row will land on from the DOM rather than assuming it.
    const order = visibleRowIds();
    const anchorId = "XOM";
    const nextId = order[order.indexOf(anchorId) + 1]!;
    const anchor = qtyCell(anchorId);
    expect(anchor).toBeTruthy();
    fireEvent.pointerDown(anchor, { pointerId: 1, button: 0 });

    // 2×1 block: the anchor row and the one below it. Both quantities are
    // within the 10× sanity rule and keep the name under the 7% guardrail.
    firePaste(anchor, "23000\n5300");

    await waitFor(
      () => {
        expect(screen.getByTestId("paste-summary")).toHaveTextContent(
          "Pasted 2 of 2",
        );
      },
      { timeout: 3000 },
    );
    expect(qtyCell(anchorId)).toHaveTextContent("23,000");
    expect(qtyCell(nextId)).toHaveTextContent("5,300");
  });

  it("reports cells the grid refused (Last is not editable)", async () => {
    renderHeroGrid();
    const anchor = qtyCell("JPM");
    expect(anchor).toBeTruthy();
    fireEvent.pointerDown(anchor, { pointerId: 1, button: 0 });

    // Two columns wide: qty takes the first field, the non-editable Last column
    // consumes the second and comes back rejected.
    firePaste(anchor, "12500\t999");

    await waitFor(
      () => {
        expect(screen.getByTestId("paste-summary")).toHaveTextContent(
          "Pasted 1 of 2 · 1 rejected",
        );
      },
      { timeout: 3000 },
    );
    expect(qtyCell("JPM")).toHaveTextContent("12,500");
  });
});
