import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  createElement,
  createRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableCheckbox } from "../components/checkbox";
import { resetDevWarnings } from "../dev-warn";
import { checkboxState } from "./checkbox-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetDevWarnings();
});

describe("PretableCheckbox", () => {
  test("is a button with the checkbox role, the kit attributes and the glyph per state", () => {
    const { rerender, getByRole } = render(
      <PretableCheckbox
        aria-label="Pick"
        checked={false}
        onCheckedChange={() => {}}
        site="hide-grouped"
        data-pretable-hide-grouped=""
      />,
    );
    const box = getByRole("checkbox", { name: "Pick" });
    expect(box.tagName).toBe("BUTTON");
    expect(box).toHaveAttribute("type", "button");
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toHaveAttribute("data-pretable-checkbox", "");
    expect(box).toHaveAttribute("data-pretable-site", "hide-grouped");
    // A site's own attribute still arrives through the spread, so nothing
    // that identified a checkbox before this component stops identifying it.
    expect(box).toHaveAttribute("data-pretable-hide-grouped", "");
    expect(box.querySelector("[data-pretable-icon]")).toBeNull();

    rerender(
      <PretableCheckbox aria-label="Pick" checked onCheckedChange={() => {}} />,
    );
    expect(checkboxState(box)).toBe(true);
    expect(box.querySelector("[data-pretable-icon]")).not.toBeNull();

    rerender(
      <PretableCheckbox
        aria-label="Pick"
        checked="mixed"
        onCheckedChange={() => {}}
      />,
    );
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(checkboxState(box)).toBe("mixed");
    expect(box.querySelector("[data-pretable-icon]")).not.toBeNull();
  });

  test("a click reports the next value: false→true, true→false, mixed→true", () => {
    const onCheckedChange = vi.fn();
    const { rerender, getByRole } = render(
      <PretableCheckbox
        aria-label="Pick"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    const box = getByRole("checkbox");

    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <PretableCheckbox
        aria-label="Pick"
        checked
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);

    // The header select-all's partial state: a click on a partial selection
    // selects everything, it does not clear it.
    rerender(
      <PretableCheckbox
        aria-label="Pick"
        checked="mixed"
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    expect(onCheckedChange).toHaveBeenCalledTimes(3);
  });

  test("a consumer onClick runs first and can veto the toggle with preventDefault", () => {
    const order: string[] = [];
    const onCheckedChange = vi.fn(() => order.push("toggle"));
    const onClick = vi.fn((e: ReactMouseEvent) => {
      order.push("consumer");
      // How a shift-click range select keeps its click without a second
      // write: it handles the event itself and vetoes the plain toggle.
      if (e.shiftKey) e.preventDefault();
    });
    const { getByRole } = render(
      <PretableCheckbox
        aria-label="Pick"
        checked={false}
        onCheckedChange={onCheckedChange}
        onClick={onClick}
      />,
    );
    const box = getByRole("checkbox");

    fireEvent.click(box);
    expect(order).toEqual(["consumer", "toggle"]);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);

    fireEvent.click(box, { shiftKey: true });
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["consumer", "toggle", "consumer"]);
  });

  test("disabled does not toggle; tabIndex and aria state attributes pass through", () => {
    const onCheckedChange = vi.fn();
    const { getByRole } = render(
      <PretableCheckbox
        aria-label="Pick"
        checked={false}
        onCheckedChange={onCheckedChange}
        disabled
        tabIndex={-1}
        aria-busy
        aria-invalid
      />,
    );
    const box = getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("tabindex", "-1");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  test("forwards its ref; className and style pass through", () => {
    const ref = createRef<HTMLButtonElement>();
    const { getByRole } = render(
      <PretableCheckbox
        ref={ref}
        aria-label="Pick"
        checked={false}
        onCheckedChange={() => {}}
        className="mine"
        style={{ margin: "3px" }}
      />,
    );
    const box = getByRole("checkbox");
    expect(ref.current).toBe(box);
    // The component sets neither className nor style, so the consumer's IS
    // the merge.
    expect(box).toHaveClass("mine");
    expect(box.style.margin).toBe("3px");
  });

  test("a wrapping label names it and clicking the label toggles it", () => {
    const onCheckedChange = vi.fn();
    const { getByRole, getByText } = render(
      <label>
        <PretableCheckbox checked={false} onCheckedChange={onCheckedChange} />
        Hide grouped
      </label>,
    );
    const box = getByRole("checkbox", { name: "Hide grouped" });
    expect(box).toBeInTheDocument();

    const label = getByText("Hide grouped").closest("label")!;
    // A <button> is a labelable element, so the label's labelled control is
    // the checkbox itself — the activation half of "clicking the label
    // toggles it".
    expect(label.control).toBe(box);

    fireEvent.click(label);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  test("warns in development when nothing names it, and not when a label or aria-label does", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const bare = render(
      <PretableCheckbox checked={false} onCheckedChange={() => {}} />,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/PretableCheckbox/);
    bare.unmount();

    // The warning is once-per-key, so a second unnamed checkbox would say
    // nothing regardless: clear the set before asserting the named cases.
    resetDevWarnings();
    warn.mockClear();

    const labelled = render(
      <label>
        <PretableCheckbox checked={false} onCheckedChange={() => {}} />
        Hide grouped
      </label>,
    );
    expect(warn).not.toHaveBeenCalled();
    labelled.unmount();

    render(
      <PretableCheckbox
        aria-label="Pick"
        checked={false}
        onCheckedChange={() => {}}
      />,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
