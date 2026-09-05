import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { PretableButton, PretableIconButton } from "../components/button";

afterEach(() => {
  cleanup();
});

describe("PretableButton", () => {
  test("is always type=button, and carries its attributes", () => {
    // Every grid button is type="button" today; a stray submit inside a
    // consumer's <form> is a real bug class, so `type` is not a prop at all.
    const { container } = render(
      <PretableButton site="filter-clear">Clear</PretableButton>,
    );
    const button = container.querySelector("button")!;
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-pretable-button", "");
    expect(button).toHaveAttribute("data-pretable-variant", "ghost");
    expect(button).toHaveAttribute("data-pretable-site", "filter-clear");
    expect(button).toHaveTextContent("Clear");
  });

  test("takes the link variant, and leaves the site attribute off when none is given", () => {
    const { container } = render(
      <PretableButton variant="link">Reset</PretableButton>,
    );
    const button = container.querySelector("button")!;
    expect(button).toHaveAttribute("data-pretable-variant", "link");
    expect(button).not.toHaveAttribute("data-pretable-site");
  });

  test("passes className, style and any other button attribute through", () => {
    // The styling channel is the attributes plus the consumer's own class —
    // a component that dropped className would have no styling channel.
    const { container } = render(
      <PretableButton
        className="mine"
        style={{ marginLeft: 4 }}
        disabled
        data-pretable-tool-reset=""
        aria-describedby="why"
      >
        x
      </PretableButton>,
    );
    const button = container.querySelector("button")!;
    expect(button).toHaveClass("mine");
    expect(button.style.marginLeft).toBe("4px");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-pretable-tool-reset", "");
    expect(button).toHaveAttribute("aria-describedby", "why");
  });

  test("forwards its ref to the button node", () => {
    // The tool panel returns focus to button nodes and anchors menus on
    // them; a component that hid the node would break both.
    const ref = createRef<HTMLButtonElement>();
    render(<PretableButton ref={ref}>x</PretableButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  test("a consumer cannot override the contract attributes by spreading", () => {
    // The data attributes follow the spread on purpose: they are the
    // component's contract with grid.css, not inputs.
    const { container } = render(
      // @ts-expect-error — proving the runtime order, not the types
      <PretableButton data-pretable-button="no" type="submit">
        x
      </PretableButton>,
    );
    const button = container.querySelector("button")!;
    expect(button).toHaveAttribute("data-pretable-button", "");
    expect(button).toHaveAttribute("type", "button");
  });
});

describe("PretableIconButton", () => {
  test("carries the icon-button attributes and its required name", () => {
    const { container } = render(
      <PretableIconButton aria-label="Remove Alpha" site="chip-remove">
        <svg />
      </PretableIconButton>,
    );
    const button = container.querySelector("button")!;
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-pretable-icon-button", "");
    expect(button).toHaveAttribute("data-pretable-site", "chip-remove");
    expect(button).not.toHaveAttribute("data-pretable-variant");
    expect(button).toHaveAccessibleName("Remove Alpha");
  });

  test("forwards its ref and passes attributes through", () => {
    const ref = createRef<HTMLButtonElement>();
    const { container } = render(
      <PretableIconButton
        ref={ref}
        aria-label="Filter Title"
        tabIndex={-1}
        aria-expanded={false}
        data-pretable-filter-funnel=""
      />,
    );
    expect(ref.current).toBe(container.querySelector("button"));
    expect(ref.current).toHaveAttribute("tabindex", "-1");
    expect(ref.current).toHaveAttribute("aria-expanded", "false");
    expect(ref.current).toHaveAttribute("data-pretable-filter-funnel", "");
  });
});
