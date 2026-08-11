import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableDelta, PretableStatus } from "../cells";
import { resetDevWarnings } from "../dev-warn";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetDevWarnings();
});

describe("PretableDelta", () => {
  test.each([
    [1, "up"],
    [1234.56, "up"],
    [Number.MAX_SAFE_INTEGER, "up"],
    [-1, "down"],
    [-0.004, "down"],
    [0, "flat"],
  ])("reads direction %s from the sign as %s", (value, direction) => {
    const { container } = render(
      <PretableDelta value={value}>x</PretableDelta>,
    );
    expect(container.querySelector("[data-pretable-delta]")).toHaveAttribute(
      "data-pretable-delta",
      direction,
    );
  });

  test("treats negative zero and NaN as flat, not as a direction", () => {
    // -0 is what a rounded-to-zero loss produces (`Math.round(-0.2)`), and it
    // compares false against both `> 0` and `< 0`. NaN compares false against
    // everything. Neither is a direction, and painting either red would assert
    // a movement the data does not contain.
    for (const value of [-0, Number.NaN]) {
      const { container } = render(
        <PretableDelta value={value}>x</PretableDelta>,
      );
      expect(container.querySelector("[data-pretable-delta]")).toHaveAttribute(
        "data-pretable-delta",
        "flat",
      );
      cleanup();
    }
  });

  test("renders the caller's formatted text and invents none of its own", () => {
    // Formatting is locale-dependent and the consumer's concern: this component
    // must never call toLocaleString/toFixed on `value`. The number below is
    // deliberately NOT how any default formatter would render 1234.5.
    const { container } = render(
      <PretableDelta value={1234.5}>+1 234,50 €</PretableDelta>,
    );
    const el = container.querySelector("[data-pretable-delta]")!;
    expect(el).toHaveTextContent("+1 234,50 €");
    expect(el.textContent).not.toContain("1234.5");
  });

  test("carries direction by a marker element, not by colour alone", () => {
    // The whole reason the delta has a marker: colour alone is not an
    // accessible signal, and red/green is the worst possible pair for the
    // commonest deficiency. The marker must be a real element from the icon
    // set — SP2b removed Unicode ▲/▼ from this grid because a text glyph
    // re-renders in whatever font the active theme picked.
    const seen = new Map<string, string>();
    for (const value of [1, -1, 0]) {
      const { container } = render(
        <PretableDelta value={value}>x</PretableDelta>,
      );
      const el = container.querySelector("[data-pretable-delta]")!;
      const marker = el.querySelector("svg[data-pretable-icon]");
      expect(marker, `no marker element for value ${value}`).not.toBeNull();
      // Silent to assistive tech: the sign is already in the formatted text,
      // so announcing the marker too would double-report every delta cell.
      expect(marker!.getAttribute("aria-hidden")).toBe("true");
      seen.set(el.getAttribute("data-pretable-delta")!, marker!.innerHTML);
      cleanup();
    }
    // Three directions, three distinct shapes — a marker that looked the same
    // in all three would convey nothing and leave colour doing the work again.
    expect(new Set(seen.values()).size, "marker shapes are not distinct").toBe(
      3,
    );
  });

  test("passes className and other span props through", () => {
    const { container } = render(
      <PretableDelta value={1} className="app-num" title="Day P&L">
        x
      </PretableDelta>,
    );
    const el = container.querySelector("[data-pretable-delta]")!;
    expect(el).toHaveClass("app-num");
    expect(el).toHaveAttribute("title", "Day P&L");
  });

  test("does not let a caller overwrite the direction attribute", () => {
    // React's HTMLAttributes admits any `data-*` key, so the type system cannot
    // refuse this — the component has to. `data-pretable-delta` is its contract
    // with grid.css, and a caller who could set it could paint a loss green.
    const { container } = render(
      <PretableDelta value={-5} data-pretable-delta="up">
        x
      </PretableDelta>,
    );
    expect(container.querySelector("[data-pretable-delta]")).toHaveAttribute(
      "data-pretable-delta",
      "down",
    );
  });
});

describe("PretableStatus", () => {
  test.each(["positive", "negative", "warning", "info", "neutral"] as const)(
    "renders tone %s with its label",
    (tone) => {
      const { container } = render(
        <PretableStatus tone={tone}>Settled</PretableStatus>,
      );
      const el = container.querySelector("[data-pretable-status]")!;
      expect(el).toHaveAttribute("data-pretable-status", tone);
      expect(el).toHaveTextContent("Settled");
    },
  );

  test("passes className and other span props through", () => {
    const { container } = render(
      <PretableStatus tone="warning" className="app-status">
        Pending
      </PretableStatus>,
    );
    expect(container.querySelector("[data-pretable-status]")).toHaveClass(
      "app-status",
    );
  });

  test("warns when a status ships without a label", () => {
    // The dot is a colour and nothing else. Without the label beside it the
    // state is unreadable in greyscale, unreadable to a colour-blind reader,
    // and completely absent to a screen reader — the ::before that draws the
    // dot has `content: ""`, so there is no text for anything to announce.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableStatus tone="negative" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/label/i);
  });

  test("does not warn when a label is present", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableStatus tone="negative">Rejected</PretableStatus>);
    expect(warn).not.toHaveBeenCalled();
  });
});
