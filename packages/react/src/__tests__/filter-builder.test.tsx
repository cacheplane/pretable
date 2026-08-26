// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SurfaceFilterGroup } from "../filter-tree";
import { JoinControl } from "../tool-panel/filters/JoinControl";

afterEach(() => {
  cleanup();
});

/**
 * A sibling run, rendered the way the section will render one: ONE `op` held
 * above the rows and handed to every connective in the run.
 *
 * The run is the unit under test as much as the component is. A sibling list
 * has exactly one `op` in the engine, so "changing any one changes them all"
 * is not an emergent nicety — it is the model, and the only way to see it is
 * to render more than one control over shared state.
 */
function Run({
  count,
  initial = "and",
  onChange,
}: {
  count: number;
  initial?: SurfaceFilterGroup["op"];
  onChange?: (op: SurfaceFilterGroup["op"]) => void;
}) {
  const [op, setOp] = useState<SurfaceFilterGroup["op"]>(initial);
  return (
    <>
      {Array.from({ length: count }, (_unused, index) => (
        <JoinControl
          key={index}
          index={index}
          op={op}
          onChange={(next) => {
            setOp(next);
            onChange?.(next);
          }}
        />
      ))}
    </>
  );
}

const joins = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-pretable-filter-join]"),
  );

describe("JoinControl", () => {
  it("gives the run's first row a non-interactive `Where`", () => {
    const { container } = render(<Run count={1} />);

    const [where, ...rest] = joins(container);
    expect(rest).toHaveLength(0);
    expect(where).toHaveTextContent("Where");
    expect(where?.tagName).not.toBe("BUTTON");
    expect(container.querySelector("button")).toBeNull();
  });

  it("gives every later row a button reading the run's join", () => {
    const { container } = render(<Run count={2} />);

    const [where, second] = joins(container);
    expect(where).toHaveTextContent("Where");
    // The CSS has a rule keyed on `button[data-pretable-filter-join]`; a
    // non-button here would silently lose its box, border and hit target.
    expect(second?.tagName).toBe("BUTTON");
    expect(second).toHaveTextContent("and");
    // It sets a value rather than toggling itself, so it is not pressed-state.
    expect(second).not.toHaveAttribute("aria-pressed");
    expect(second?.getAttribute("aria-label")).toMatch(/\bor\b/);
  });

  it("reports the OTHER join when clicked", () => {
    const onChange = vi.fn();
    const { container } = render(<Run count={2} onChange={onChange} />);

    fireEvent.click(joins(container)[1]!);
    expect(onChange).toHaveBeenCalledWith("or");

    fireEvent.click(joins(container)[1]!);
    expect(onChange).toHaveBeenLastCalledWith("and");
  });

  it("changes the WHOLE run, not the row that was clicked", () => {
    const { container } = render(<Run count={3} />);

    const before = joins(container);
    expect(before[1]).toHaveTextContent("and");
    expect(before[2]).toHaveTextContent("and");

    // The third row's control — so a component that kept its own state would
    // leave the second one reading `and`.
    fireEvent.click(before[2]!);

    const after = joins(container);
    expect(after[1]).toHaveTextContent("or");
    expect(after[2]).toHaveTextContent("or");
    // And the label now offers the way back, for the whole run.
    expect(after[1]?.getAttribute("aria-label")).toBe(
      after[2]?.getAttribute("aria-label"),
    );
  });

  it("names the run, not the row, to a screen reader", () => {
    const { container } = render(<Run count={2} initial="or" />);

    const button = joins(container)[1]!;
    expect(button).toHaveTextContent("or");
    expect(button.getAttribute("aria-label")).toBe(
      "or, join all conditions in this list with and",
    );
  });

  /* SC 2.5.3 Label in Name. `and` is the ONLY text on the control, so it is
     the visible label — and an accessible name that named only what a press
     would DO left it out of the name entirely. This is the assertion the
     suite was missing: a name may add to the visible text, never replace it.
     The sibling this component's voice came from (`ColumnPinMenu`) is safe
     from the same bug by mechanism, not by wording — its items carry no
     aria-label at all, so their visible text IS their accessible name. */
  it("contains its visible text in its accessible name, both ways round", () => {
    for (const initial of ["and", "or"] as const) {
      const { container, getByRole, unmount } = render(
        <Run count={2} initial={initial} />,
      );

      const button = joins(container)[1]!;
      // The caret is decorative and aria-hidden; the word is the label.
      const visible = button.textContent?.replace("\u25be", "").trim();
      expect(visible).toBe(initial);
      expect(button.getAttribute("aria-label")).toContain(visible);

      // And the literal speech-input path: a Voice Control user reads the
      // word off the screen and says "click and". Anchored, because the
      // trailing promise names the OTHER join and would match either way.
      expect(getByRole("button", { name: new RegExp(`^${initial}\\b`) })).toBe(
        button,
      );

      unmount();
    }
  });

  /* The stylesheet's row-alignment argument rests on BOTH shapes taking the
     shared 24px box, which they do by both carrying the attribute — the
     button rule only adds to it. No CSS guard can see the DOM, so this is
     the only place that can hold the non-button half of the contract. */
  it("puts the join attribute on the non-button `Where` too", () => {
    const { container } = render(<Run count={2} />);

    const where = container.querySelector("[data-pretable-filter-join]")!;
    expect(where.tagName).toBe("SPAN");
    expect(where).toHaveTextContent("Where");
  });
});
