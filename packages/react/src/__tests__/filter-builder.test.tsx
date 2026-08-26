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

describe("JoinControl", () => {
  /**
   * A sibling run, rendered the way the section will render one: ONE `op`
   * held above the rows and handed to every connective in the run.
   *
   * The run is the unit under test as much as the component is. A sibling
   * list has exactly one `op` in the engine, so "changing any one changes
   * them all" is not an emergent nicety — it is the model, and the only way
   * to see it is to render more than one control over shared state.
   *
   * `fixed` plays the root array, whose implicit AND has no `op` to set.
   */
  function SiblingRun({
    count,
    initial = "and",
    fixed = false,
    onChange,
  }: {
    count: number;
    initial?: SurfaceFilterGroup["op"];
    fixed?: boolean;
    onChange?: (op: SurfaceFilterGroup["op"]) => void;
  }) {
    const [op, setOp] = useState<SurfaceFilterGroup["op"]>(initial);
    const commit = (next: SurfaceFilterGroup["op"]) => {
      setOp(next);
      onChange?.(next);
    };
    return (
      <>
        {Array.from({ length: count }, (_unused, index) => (
          <JoinControl
            key={index}
            first={index === 0}
            op={op}
            onChange={fixed ? undefined : commit}
          />
        ))}
      </>
    );
  }

  /**
   * Every connective in `container`, in document order — FLAT. That is exact
   * for one run and meaningless for a tree: once the section renders nested
   * rails, each run brings its own `Where` and they interleave here by
   * position. A tree test must scope to a rail before it counts.
   */
  const joins = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-pretable-filter-join]"),
    );

  /** The word, as a sighted user reads it: the child that is not hidden. */
  const visibleText = (join: HTMLElement) =>
    join.querySelector("span:not([aria-hidden])")?.textContent ??
    join.textContent;

  it("gives the run's first row a non-interactive `Where`", () => {
    const { container } = render(<SiblingRun count={1} />);

    const [where, ...rest] = joins(container);
    expect(rest).toHaveLength(0);
    expect(where).toHaveTextContent("Where");
    expect(where?.tagName).not.toBe("BUTTON");
    expect(container.querySelector("button")).toBeNull();
  });

  it("gives every later row a button reading the run's join", () => {
    const { container } = render(<SiblingRun count={2} />);

    const [where, second] = joins(container);
    expect(joins(container)).toHaveLength(2);
    expect(where).toHaveTextContent("Where");
    // The CSS has a rule keyed on `button[data-pretable-filter-join]`; a
    // non-button here would silently lose its box, border and hit target.
    expect(second?.tagName).toBe("BUTTON");
    expect(second).toHaveTextContent("and");
    // It sets a value rather than toggling itself, so it is not pressed-state.
    expect(second).not.toHaveAttribute("aria-pressed");
    expect(second?.getAttribute("aria-label")).toMatch(/\bor\b/);
  });

  /* The root of the tree is a bare array — an implicit AND with no `op` field
     to set — so its run has a join to SHOW and nothing to change. A button
     wired to a no-op would look live, take focus and promise a change it
     cannot make. */
  it("renders a run whose join is fixed without an affordance to change it", () => {
    const { container } = render(<SiblingRun count={3} fixed />);

    const [where, ...rest] = joins(container);
    expect(where).toHaveTextContent("Where");
    expect(rest).toHaveLength(2);
    for (const join of rest) {
      expect(join.tagName).toBe("SPAN");
      expect(join).toHaveTextContent("and");
      expect(join).not.toHaveAttribute("aria-label");
    }
    expect(container.querySelector("button")).toBeNull();
  });

  it("reports the OTHER join when clicked", () => {
    const onChange = vi.fn();
    const { container } = render(<SiblingRun count={2} onChange={onChange} />);

    fireEvent.click(joins(container)[1]!);
    expect(onChange).toHaveBeenCalledWith("or");

    fireEvent.click(joins(container)[1]!);
    expect(onChange).toHaveBeenLastCalledWith("and");
  });

  it("changes the WHOLE run, not the row that was clicked", () => {
    const { container } = render(<SiblingRun count={3} />);

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

  it("leads its accessible name with the join it is showing", () => {
    const { container } = render(<SiblingRun count={2} initial="or" />);

    const button = joins(container)[1]!;
    expect(button).toHaveTextContent("or");
    expect(button.getAttribute("aria-label")).toBe(
      "or, join all conditions in this list with and",
    );
  });

  /* SC 2.5.3 Label in Name — the assertion this suite was missing. The
     component's TSDoc carries the reasoning, including why `ColumnPinMenu`
     is no precedent for a bare next-value name. */
  it.each(["and", "or"] as const)(
    "contains its visible text `%s` in its accessible name",
    (initial) => {
      const { container, getByRole } = render(
        <SiblingRun count={2} initial={initial} />,
      );

      const button = joins(container)[1]!;
      expect(visibleText(button)).toBe(initial);
      expect(button.getAttribute("aria-label")).toContain(initial);

      // And the literal speech-input path: a Voice Control user reads the
      // word off the screen and says "click and". Anchored, because the
      // trailing promise names the OTHER join and would match either way.
      expect(getByRole("button", { name: new RegExp(`^${initial}\\b`) })).toBe(
        button,
      );
    },
  );

  /* The stylesheet's row-alignment argument rests on BOTH shapes taking the
     shared 24px box, which they do by both carrying the attribute — the
     button rule only adds to it. No CSS guard can see the DOM, so this is
     the only place that can hold the non-button half of the contract. */
  it("puts the join attribute on the non-button `Where` too", () => {
    const { container } = render(<SiblingRun count={2} />);

    const where = container.querySelector("[data-pretable-filter-join]")!;
    expect(where.tagName).toBe("SPAN");
    expect(where).toHaveTextContent("Where");
  });
});
