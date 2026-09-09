import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableTextInput } from "../components/text-input";
import { resetDevWarnings } from "../dev-warn";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetDevWarnings();
});

describe("PretableTextInput", () => {
  test("is the native input carrying the kit attributes; type/inputMode/value/onChange pass through", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <PretableTextInput
        aria-label="Filter value"
        site="filter-value"
        data-pretable-filter-value=""
        type="text"
        inputMode="decimal"
        value="4"
        onChange={onChange}
      />,
    );
    const input = getByRole("textbox", {
      name: "Filter value",
    }) as HTMLInputElement;

    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("data-pretable-text-input", "");
    expect(input).toHaveAttribute("data-pretable-site", "filter-value");
    // A site's own attribute still arrives through the spread, so nothing
    // that identified a field before this component stops identifying it.
    expect(input).toHaveAttribute("data-pretable-filter-value", "");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input.value).toBe("4");

    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("a date field stays a native date input", () => {
    // The reason this component is the bare `<input>` and nothing more: a
    // wrapper that swallowed `type` would take the platform's date picker
    // away with it.
    const { container } = render(
      <PretableTextInput
        aria-label="On or after"
        site="filter-value"
        type="date"
        value="2026-09-05"
        onChange={() => {}}
      />,
    );
    const input = container.querySelector('input[type="date"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute("data-pretable-text-input", "");
  });

  test("forwards its ref; className, style and disabled pass through", () => {
    const ref = createRef<HTMLInputElement>();
    const { getByRole } = render(
      <PretableTextInput
        ref={ref}
        aria-label="Search"
        site="tool-search"
        className="mine"
        style={{ width: "80px" }}
        disabled
      />,
    );
    const input = getByRole("textbox", { name: "Search" });

    expect(ref.current).toBe(input);
    // The component sets neither className nor style, so the consumer's IS
    // the merge.
    expect(input).toHaveClass("mine");
    expect((input as HTMLInputElement).style.width).toBe("80px");
    expect(input).toBeDisabled();
  });

  test("warns once when nothing can name it; silent for aria-label, aria-labelledby, or a label-for", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<PretableTextInput />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/PretableTextInput/);

    // The warning is once-per-key, so a second unnamed field would say
    // nothing regardless: clear the set before asserting the named cases.
    warn.mockClear();
    resetDevWarnings();

    render(<PretableTextInput aria-label="A" />);
    render(
      <div>
        <span id="lbl">B</span>
        <PretableTextInput aria-labelledby="lbl" />
      </div>,
    );
    render(
      <div>
        <label htmlFor="q">C</label>
        <PretableTextInput id="q" />
      </div>,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
