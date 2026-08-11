import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  PretableBadge,
  PretableDelta,
  PretableEntity,
  PretableStatus,
} from "../cells";
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

describe("PretableBadge", () => {
  test.each(["positive", "negative", "warning", "info"] as const)(
    "renders its label and carries tone %s",
    (tone) => {
      const { container } = render(
        <PretableBadge tone={tone}>trim</PretableBadge>,
      );
      const el = container.querySelector("[data-pretable-badge]")!;
      expect(el).toHaveAttribute("data-pretable-tone", tone);
      expect(el).toHaveTextContent("trim");
    },
  );

  test("sets no tone attribute when no tone is given", () => {
    // Absence IS the neutral badge — grid.css's base rule paints it in the
    // ordinary cell ink. A `data-pretable-tone` present but empty would be a
    // second spelling of the same state and a value no rule matches.
    const { container } = render(<PretableBadge>hold</PretableBadge>);
    const el = container.querySelector("[data-pretable-badge]")!;
    expect(el).not.toHaveAttribute("data-pretable-tone");
  });

  test("passes className and other span props through", () => {
    const { container } = render(
      <PretableBadge tone="warning" className="app-badge" title="Analyst flag">
        watch
      </PretableBadge>,
    );
    const el = container.querySelector("[data-pretable-badge]")!;
    expect(el).toHaveClass("app-badge");
    expect(el).toHaveAttribute("title", "Analyst flag");
  });

  test("does not let a caller clobber the attribute grid.css keys on", () => {
    // React's HTMLAttributes admits any `data-*` key, so the type system cannot
    // refuse these. `data-pretable-badge` is the whole of the chip's styling
    // contract — overwritten, the badge renders as bare text — and
    // `data-pretable-tone` must agree with the `tone` prop rather than with
    // whatever a spread happened to carry in.
    const { container } = render(
      <PretableBadge
        tone="negative"
        data-pretable-badge={undefined}
        data-pretable-tone="positive"
      >
        risk
      </PretableBadge>,
    );
    const el = container.querySelector("[data-pretable-badge]");
    expect(el, "the badge attribute was clobbered away").not.toBeNull();
    expect(el).toHaveAttribute("data-pretable-tone", "negative");
  });
});

describe("PretableEntity", () => {
  test("renders both lines", () => {
    const { container } = render(
      <PretableEntity primary="NVDA" secondary="NVIDIA Corp" />,
    );
    const el = container.querySelector("[data-pretable-entity]")!;
    expect(
      el.querySelector("[data-pretable-entity-primary]"),
    ).toHaveTextContent("NVDA");
    expect(
      el.querySelector("[data-pretable-entity-secondary]"),
    ).toHaveTextContent("NVIDIA Corp");
  });

  test("renders only the primary when no secondary is given", () => {
    // Not an empty secondary element: grid.css gives it its own line-box, so an
    // empty one still reserves a line and every row in the column grows by it.
    const { container } = render(<PretableEntity primary="NVDA" />);
    const el = container.querySelector("[data-pretable-entity]")!;
    expect(
      el.querySelector("[data-pretable-entity-primary]"),
    ).toHaveTextContent("NVDA");
    expect(el.querySelector("[data-pretable-entity-secondary]")).toBeNull();
  });

  test("renders a secondary of 0, which is a value and not an absence", () => {
    // `secondary && <span>` would swallow 0 and the empty string. Both are
    // legitimate secondary lines — a count, a code — and the test exists
    // because the falsy-guard version of this component passes every other
    // test in this block.
    const { container } = render(
      <PretableEntity primary="NVDA" secondary={0} />,
    );
    expect(
      container.querySelector("[data-pretable-entity-secondary]"),
    ).toHaveTextContent("0");
  });

  test("passes className and other span props through", () => {
    const { container } = render(
      <PretableEntity primary="NVDA" className="app-entity" title="Symbol" />,
    );
    const el = container.querySelector("[data-pretable-entity]")!;
    expect(el).toHaveClass("app-entity");
    expect(el).toHaveAttribute("title", "Symbol");
  });
});
