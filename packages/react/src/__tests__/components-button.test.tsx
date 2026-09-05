import "@testing-library/jest-dom/vitest";
import { cleanup, render, renderHook } from "@testing-library/react";
import { createRef, forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  PretableButton,
  PretableIconButton,
  type PretableIconButtonProps,
} from "../components/button";
import {
  DEFAULT_COMPONENTS,
  PretableComponentsProvider,
  usePretableComponents,
  useResolvedComponents,
} from "../components/context";
import { resetDevWarnings } from "../dev-warn";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetDevWarnings();
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
    expect(button).not.toHaveAttribute("site");
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
      <PretableButton
        data-pretable-button="no"
        data-pretable-variant="x"
        data-pretable-site="x"
        // @ts-expect-error — proving the runtime order, not the types
        type="submit"
      >
        x
      </PretableButton>,
    );
    const button = container.querySelector("button")!;
    expect(button).toHaveAttribute("data-pretable-button", "");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-pretable-variant", "ghost");
    expect(button).not.toHaveAttribute("data-pretable-site");
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

  test("warns in development when the accessible name is empty", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableIconButton aria-label="   " />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/PretableIconButton/);
    expect(warn.mock.calls[0]?.[0]).toMatch(/aria-label/);
    // Once per session, like every dev warning here — not once per render.
    render(<PretableIconButton aria-label="" />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("does not warn when the name is present", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableIconButton aria-label="Remove Alpha" />);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a missing name (possible from JavaScript) warns rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The type requires it; the runtime cannot, so the guard must not assume it.
    const props = {
      "aria-label": undefined,
    } as unknown as PretableIconButtonProps;
    expect(() => render(<PretableIconButton {...props} />)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("components context", () => {
  test("outside any provider, the hook returns the built-in components", () => {
    const { result } = renderHook(() => usePretableComponents());
    expect(result.current).toBe(DEFAULT_COMPONENTS);
    expect(result.current.Button).toBe(PretableButton);
    expect(result.current.IconButton).toBe(PretableIconButton);
  });

  test("resolving nothing yields the default map, by identity", () => {
    // Identity matters: the provider's value is what every button re-renders
    // on, so an unchanged input must produce an unchanged output.
    const { result, rerender } = renderHook(
      ({ components }) => useResolvedComponents(components),
      {
        initialProps: {
          components: undefined as
            undefined | { Button?: typeof PretableButton },
        },
      },
    );
    expect(result.current).toBe(DEFAULT_COMPONENTS);
    rerender({ components: {} });
    expect(result.current).toBe(DEFAULT_COMPONENTS);
  });

  test("a replacement is merged over the defaults, and a stable input is a stable output", () => {
    const MyButton = forwardRef<
      HTMLButtonElement,
      ComponentProps<typeof PretableButton>
    >((props, ref) => <button {...props} ref={ref} data-mine="" />);
    const { result, rerender } = renderHook(
      ({ components }) => useResolvedComponents(components),
      { initialProps: { components: { Button: MyButton } } },
    );
    const first = result.current;
    expect(first.Button).toBe(MyButton);
    expect(first.IconButton).toBe(PretableIconButton);
    // A NEW object literal with the SAME values — what an inline
    // `components={{ Button: MyButton }}` produces on every render.
    rerender({ components: { Button: MyButton } });
    expect(result.current).toBe(first);
  });

  test("a changed slot yields a new map carrying the replacement", () => {
    const A = forwardRef<
      HTMLButtonElement,
      ComponentProps<typeof PretableButton>
    >((props, ref) => <button {...props} ref={ref} />);
    const B = forwardRef<
      HTMLButtonElement,
      ComponentProps<typeof PretableButton>
    >((props, ref) => <button {...props} ref={ref} />);
    const { result, rerender } = renderHook(
      ({ components }) => useResolvedComponents(components),
      { initialProps: { components: { Button: A } as { Button?: typeof A } } },
    );
    const first = result.current;
    rerender({ components: { Button: B } });
    expect(result.current).not.toBe(first);
    expect(result.current.Button).toBe(B);
    // And back to nothing returns the frozen default by identity.
    rerender({ components: {} });
    expect(result.current).toBe(DEFAULT_COMPONENTS);
  });

  test("the provider's value is what the hook reads", () => {
    const MyIcon = forwardRef<
      HTMLButtonElement,
      ComponentProps<typeof PretableIconButton>
    >((props, ref) => <button {...props} ref={ref} data-mine="" />);
    const value = { Button: PretableButton, IconButton: MyIcon };
    const { result } = renderHook(() => usePretableComponents(), {
      wrapper: ({ children }) => (
        <PretableComponentsProvider value={value}>
          {children}
        </PretableComponentsProvider>
      ),
    });
    expect(result.current.IconButton).toBe(MyIcon);
  });
});
