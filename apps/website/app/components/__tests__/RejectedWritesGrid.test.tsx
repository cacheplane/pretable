import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RejectedWritesGrid } from "../showcase/RejectedWritesGrid";
import { priceFor } from "../showcase/rejectedWritesData";

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

// Real timers with tiny injected durations — no fake timers (a recorded plan
// deviation: PretableSurface schedules internally, and fake timers coupling
// to its internals is exactly the flake class the sibling tests avoid).
const FAST = { tickMs: 40, healMs: 300 } as const;

async function readTicks() {
  const sent = Number(screen.getByTestId("rw-sent-tick").textContent);
  const grid = Number(screen.getByTestId("rw-grid-tick").textContent);
  return { sent, grid };
}

describe("RejectedWritesGrid", () => {
  const originalIO = globalThis.IntersectionObserver;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.IntersectionObserver = originalIO;
    warnSpy.mockRestore();
  });

  it("streams clean ticks with no banner, counters in lockstep", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    await waitFor(async () => {
      const { sent, grid } = await readTicks();
      expect(sent).toBeGreaterThan(2); // ticks advanced
      expect(grid).toBe(sent); // and every write landed
    });
    expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument();
  });

  it("corrupt → grid keeps the pre-corruption page, banner names the fault, counters split", async () => {
    const { container } = render(<RejectedWritesGrid {...FAST} />);
    await waitFor(async () =>
      expect((await readTicks()).sent).toBeGreaterThan(1),
    );
    fireEvent.click(screen.getByTestId("rw-corrupt"));
    const banner = await screen.findByTestId("rw-banner");
    expect(within(banner).getByText(/duplicate-row-id/)).toBeInTheDocument();
    // While diverged, the corrupt affordance is off.
    expect(screen.getByTestId("rw-corrupt")).toBeDisabled();
    const { sent, grid } = await readTicks();
    expect(sent).toBe(grid + 1); // the corrupt page was sent but never landed
    // The AAPL price cell still shows the LANDED tick's price, not the sent one.
    const landedPrice = `$${priceFor("AAPL", grid).toFixed(2)}`;
    expect(container.textContent).toContain(landedPrice);
    // And the stream is paused: sent does not advance while diverged.
    const sentBefore = sent;
    await new Promise((resolve) => setTimeout(resolve, FAST.tickMs * 4));
    expect((await readTicks()).sent).toBe(sentBefore);
  });

  it("Refetch recovers immediately: banner gone, counters re-converge, stream resumes", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    fireEvent.click(screen.getByTestId("rw-corrupt"));
    await screen.findByTestId("rw-banner");
    fireEvent.click(screen.getByTestId("rw-refetch"));
    await waitFor(() =>
      expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument(),
    );
    await waitFor(async () => {
      const { sent, grid } = await readTicks();
      expect(grid).toBe(sent);
    });
    // Recovery re-arms the corrupt affordance.
    expect(screen.getByTestId("rw-corrupt")).toBeEnabled();
    // Stream resumed.
    const { sent } = await readTicks();
    await waitFor(async () =>
      expect((await readTicks()).sent).toBeGreaterThan(sent),
    );
  });

  it("auto-heal recovers without a click", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    fireEvent.click(screen.getByTestId("rw-corrupt"));
    await screen.findByTestId("rw-banner");
    await waitFor(
      () => expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument(),
      { timeout: FAST.healMs * 4 },
    );
  });

  it("a second corruption banners again — nothing latches", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    const duplicatedId = (banner: HTMLElement) => {
      const match = /Duplicate row ID (\w+)/.exec(banner.textContent ?? "");
      expect(match).not.toBeNull();
      return match![1];
    };
    fireEvent.click(screen.getByTestId("rw-corrupt"));
    const first = await screen.findByTestId("rw-banner");
    const firstText = first.textContent;
    const firstId = duplicatedId(first);
    fireEvent.click(screen.getByTestId("rw-refetch"));
    await waitFor(() =>
      expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("rw-corrupt"));
    const second = await screen.findByTestId("rw-banner");
    // Different duplicated id → different fault detail (the variant rotation:
    // variant 0 duplicates AAPL, variant 1 duplicates NVDA).
    expect(second.textContent).not.toBe(firstText);
    expect(firstId).toBe("AAPL");
    expect(duplicatedId(second)).toBe("NVDA");
  });
});
