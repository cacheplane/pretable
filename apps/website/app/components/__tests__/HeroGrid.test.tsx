import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeroGrid } from "../HeroGrid";
import { ControlStateProvider } from "../heroGrid/controlState";
import { isDeskRejected } from "../heroGrid/qty-edit";

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

  it("survives a StrictMode remount", () => {
    // React StrictMode mounts, unmounts and remounts every component in dev,
    // and the model lives in `useState` — so the remount gets the same instance
    // back. A plain `() => rowModel.dispose()` cleanup therefore destroyed it
    // for good: the layout controller marked itself disposed through its
    // model-subscription failure path, and `setColumns` threw "A disposed
    // row-layout controller cannot change its columns" out of a layout effect.
    // The hero rendered NOTHING in `next dev` from #321 until this was fixed,
    // while every e2e run stayed green — they all measure production builds,
    // where StrictMode does not double-invoke.
    stubMatchMedia(true); // settled snapshot, no rAF needed
    expect(() =>
      render(
        <StrictMode>
          <ControlStateProvider>
            <HeroGrid />
          </ControlStateProvider>
        </StrictMode>,
      ),
    ).not.toThrow();
    expect(
      screen.getByRole("grid", { name: /live portfolio positions/i }),
    ).toBeInTheDocument();
    expect(visibleRowIds().length).toBeGreaterThan(5);
  });

  it("draws the book ranked by weight, largest first", () => {
    // The hero's stated default: largest positions first. It was lost once
    // already — the ranking moved into a local array that stopped being
    // rendered, so the grid drew arrival order (weights ran 16.4, 9.7, 8.2, 5,
    // 4.3, 7 down the page) while the ranking code kept running and feeding
    // nothing. The order the ENGINE draws is the only one that can be asserted.
    stubMatchMedia(true); // settled snapshot, no rAF needed
    renderHeroGrid();

    const drawn = visibleRowIds();
    expect(drawn.length).toBeGreaterThan(5);
    const weights = drawn.map((id) =>
      Number(
        document
          .querySelector(
            `[data-pretable-row-id="${id}"] [data-pretable-column-id="weight"]`,
          )!
          .textContent!.replace(/[^0-9.]/g, ""),
      ),
    );
    for (let i = 1; i < weights.length; i += 1) {
      expect(
        weights[i]!,
        `${drawn[i]} (${weights[i]}%) is drawn below ${drawn[i - 1]} (${weights[i - 1]}%)`,
      ).toBeLessThanOrEqual(weights[i - 1]! + 0.05); // display rounds to 1dp
    }

    // Non-vacuous: ranked order is NOT the order the rows arrive in, so this
    // would fail if the grid ever drew the source order again. AVGO ranks third
    // by weight while arriving thirteenth.
    expect(drawn.indexOf("AVGO")).toBeLessThan(drawn.indexOf("AAPL"));
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
    expect(
      screen.getByText(/drag a header up to\s+group/i),
    ).toBeInTheDocument();
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

    // `requestAnimationFrame` is stubbed, so the replay only advances when a
    // frame is flushed by hand — `waitFor` alone cannot rescue a value that has
    // not been ticked. Two frames were not always enough to move THIS sector's
    // aggregate, and the retry loop then span against a frozen clock until it
    // timed out. Drive the clock inside the wait instead: each attempt flushes
    // another frame, so the loop advances the thing it is waiting on.
    let frame = 1_000;
    await waitFor(
      () => {
        flushAnimationFrame((frame += 16));
        expect(
          groupRowNamed("Consumer")!.querySelector(
            '[data-pretable-column-id="dayPnl"]',
          ),
        ).not.toHaveTextContent(aggregateBefore ?? "");
        expect(screen.getByTestId("summary-pnl")).not.toHaveTextContent(
          sidebarBefore ?? "",
        );
      },
      { timeout: 5_000 },
    );
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
    //
    // The anchor sits mid-book on purpose. A paste changes both names' market
    // values, which RE-RANKS the book, and the grid renders a window — an
    // anchor near the bottom of that window can push its own neighbour out of
    // it, and the assertion below then fails on a missing node rather than on a
    // wrong quantity. These two are adjacent, comfortably inside the window,
    // and stay adjacent under the re-rank these values cause.
    const order = visibleRowIds();
    const anchorId = "AMZN";
    const nextId = order[order.indexOf(anchorId) + 1]!;
    const anchor = qtyCell(anchorId);
    expect(anchor).toBeTruthy();
    fireEvent.pointerDown(anchor, { pointerId: 1, button: 0 });

    // 2×1 block: the anchor row and the one below it. Both quantities are
    // within the 10× sanity rule and keep the name under the 7% guardrail.
    //
    // They must also clear the desk, which rejects ~1 in 7 orders on a hash of
    // symbol+qty. That makes the fixture depend on WHICH row the second value
    // lands on: this test used 11,500, the neighbour became V when the book
    // went back to being ranked by weight, and `isDeskRejected("V", 11500)` is
    // true — so `beforeRowChange` threw, no `onPaste` fired, and the failure
    // read as a missing summary node rather than as a rejected order. Assert
    // the premise so the next reordering fails with its actual reason.
    const anchorQty = 19_000;
    const nextQty = 12_000;
    expect(isDeskRejected(anchorId, anchorQty)).toBe(false);
    expect(
      isDeskRejected(nextId, nextQty),
      `the desk rejects ${nextQty} on ${nextId}; pick another quantity`,
    ).toBe(false);
    firePaste(anchor, `${anchorQty}\n${nextQty}`);

    await waitFor(
      () => {
        expect(screen.getByTestId("paste-summary")).toHaveTextContent(
          "Pasted 2 of 2",
        );
      },
      { timeout: 3000 },
    );
    expect(qtyCell(anchorId)).toHaveTextContent("19,000");
    // Stated as a premise so a future window change fails as "the neighbour
    // scrolled out", not as an unexplained null.
    expect(
      qtyCell(nextId),
      `${nextId} left the rendered window after the paste`,
    ).toBeTruthy();
    expect(qtyCell(nextId)).toHaveTextContent("12,000");
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
