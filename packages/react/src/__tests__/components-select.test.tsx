import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableSelect } from "../components/select";
import { resetDevWarnings } from "../dev-warn";
import { chooseOption, readOptions, selectValue } from "./select-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetDevWarnings();
});

const OPTIONS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "custom", label: "Custom", disabled: true },
];

function renderSelect(
  props: Partial<ComponentProps<typeof PretableSelect>> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <PretableSelect
      aria-label="Operator"
      options={OPTIONS}
      value="contains"
      onChange={onChange}
      site="filter-operator"
      data-pretable-filter-operator=""
      {...props}
    />,
  );
  const trigger = view.getByRole("combobox", {
    name: props["aria-label"] ?? "Operator",
  });
  return { view, trigger, onChange };
}

describe("PretableSelect", () => {
  test("is a select-only combobox carrying the kit attributes and the value", () => {
    const { trigger } = renderSelect();
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-pretable-select", "");
    expect(trigger).toHaveAttribute("data-pretable-site", "filter-operator");
    expect(trigger).toHaveAttribute("data-pretable-filter-operator", "");
    expect(selectValue(trigger)).toBe("contains");
    expect(trigger).toHaveTextContent("contains");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
  });

  test("opens on click with the current value highlighted, and commits a clicked option", () => {
    const { view, trigger, onChange } = renderSelect();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = document.querySelector("[data-pretable-listbox]")!;
    // The list carries the trigger's name: a screen reader announcing the
    // popup should say what it is choosing.
    expect(view.getByRole("listbox", { name: "Operator" })).toBe(list);
    expect(trigger).toHaveAttribute("aria-controls", list.id);
    expect(trigger).toHaveAttribute("aria-activedescendant", `${list.id}-0`);
    fireEvent.click(list.querySelector('[data-value="equals"]')!);
    expect(onChange).toHaveBeenCalledWith("equals");
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test("a press on the open trigger closes it — it does not close and reopen", () => {
    // The toggling-anchor contract: the document's outside-press listener
    // must not see the trigger's own pointerdown.
    const { trigger } = renderSelect();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("the keyboard opens, moves, commits and closes", () => {
    const { trigger, onChange } = renderSelect();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const list = document.querySelector("[data-pretable-listbox]")!;
    expect(trigger).toHaveAttribute("aria-activedescendant", `${list.id}-1`);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("equals");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(trigger, { key: " " });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  test("Tab closes without trapping, and an outside press closes", () => {
    const { trigger } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("a value absent from the options renders as its own label, not a wrong option", () => {
    // The pruned-operator case: the applied operator is not in the permitted
    // list; a native <select> would silently display its first option.
    const { trigger } = renderSelect({ value: "endsWith" });
    expect(trigger).toHaveTextContent("endsWith");
    expect(selectValue(trigger)).toBe("endsWith");
  });

  test("the helpers drive it: chooseOption commits, readOptions lists", () => {
    const { trigger, onChange } = renderSelect();
    expect(readOptions(trigger)).toEqual({
      values: ["contains", "equals", "custom"],
      labels: ["contains", "equals", "Custom"],
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false"); // readOptions closed it again
    chooseOption(trigger, "equals");
    expect(onChange).toHaveBeenCalledWith("equals");
  });

  test("re-selecting the committed value commits without calling onChange", () => {
    const { trigger, onChange } = renderSelect();
    chooseOption(trigger, "contains");
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("an absent value seeds the highlight on the first ENABLED option", () => {
    const { trigger } = renderSelect({
      value: "endsWith",
      options: [
        { value: "contains", label: "contains", disabled: true },
        { value: "equals", label: "equals" },
      ],
    });
    fireEvent.click(trigger);
    const list = document.querySelector("[data-pretable-listbox]")!;
    expect(trigger).toHaveAttribute("aria-activedescendant", `${list.id}-1`);
  });

  test("disabling an open select closes it — Escape would die with the keydown", () => {
    const { view, trigger, onChange } = renderSelect();
    fireEvent.click(trigger);
    expect(document.querySelector("[data-pretable-listbox]")).not.toBeNull();
    view.rerender(
      <PretableSelect
        aria-label="Operator"
        options={OPTIONS}
        value="contains"
        onChange={onChange}
        site="filter-operator"
        data-pretable-filter-operator=""
        disabled
      />,
    );
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("disabled takes the standard treatment and does not open", () => {
    const { trigger } = renderSelect({ disabled: true });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
  });

  test("forwards its ref; className and style pass through", () => {
    const ref = createRef<HTMLButtonElement>();
    const { trigger } = renderSelect({
      ref,
      className: "mine",
      style: { width: 120 },
    });
    expect(ref.current).toBe(trigger);
    expect(trigger).toHaveClass("mine");
    expect(trigger.style.width).toBe("120px");
  });

  test("warns in development on an empty accessible name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PretableSelect
        aria-label="  "
        options={OPTIONS}
        value="contains"
        onChange={() => {}}
      />,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/PretableSelect/);
  });
});
