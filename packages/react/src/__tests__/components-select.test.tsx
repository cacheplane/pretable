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
    fireEvent.click(
      list.querySelector('[data-pretable-option-value="equals"]')!,
    );
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

  test("is a Tab stop everywhere: an explicit tabindex, which a consumer's own overrides", () => {
    // The parity claim, not a style one. The controls this replaced were
    // native <select>s, which WebKit puts in the sequential order; a plain
    // <button> it skips unless "Tab moves between all controls" is on.
    const { trigger } = renderSelect();
    expect(trigger).toHaveAttribute("tabindex", "0");

    // ...and it is a default, not a decree: a consumer running its own
    // roving tabindex still gets the value it passed.
    cleanup();
    const { trigger: roving } = renderSelect({ tabIndex: -1 });
    expect(roving).toHaveAttribute("tabindex", "-1");
  });

  test("an empty option set never opens — no list to announce", () => {
    const { trigger } = renderSelect({ options: [], value: "contains" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();

    // The keyboard path opens through the same `onOpen`, so it is covered by
    // the same guard.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
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

  test("preserves the active value across insertion and reorder before committing", () => {
    const { view, trigger, onChange } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const next = [OPTIONS[1]!, { value: "new", label: "New" }, OPTIONS[0]!];
    view.rerender(
      <PretableSelect
        aria-label="Operator"
        options={next}
        value="contains"
        onChange={onChange}
      />,
    );
    const active = document.getElementById(
      trigger.getAttribute("aria-activedescendant")!,
    );
    expect(active).toHaveAttribute("data-pretable-option-value", "equals");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("equals");
  });

  test.each(["removed", "disabled"])(
    "falls back to the first enabled option when the active value is %s",
    (change) => {
      const { view, trigger, onChange } = renderSelect();
      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const next =
        change === "removed"
          ? [OPTIONS[0]!]
          : OPTIONS.map((o) =>
              o.value === "equals" ? { ...o, disabled: true } : o,
            );
      view.rerender(
        <PretableSelect
          aria-label="Operator"
          options={next}
          value="missing"
          onChange={onChange}
        />,
      );
      const active = document.getElementById(
        trigger.getAttribute("aria-activedescendant")!,
      );
      expect(active).toHaveAttribute("data-pretable-option-value", "contains");
      fireEvent.keyDown(trigger, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("contains");
    },
  );

  test("an empty open roster closes and repopulating does not reopen it", () => {
    const { view, trigger, onChange } = renderSelect();
    fireEvent.click(trigger);
    view.rerender(
      <PretableSelect
        aria-label="Operator"
        options={[]}
        value="contains"
        onChange={onChange}
      />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    expect(view.queryByRole("listbox")).toBeNull();
    view.rerender(
      <PretableSelect
        aria-label="Operator"
        options={OPTIONS}
        value="contains"
        onChange={onChange}
      />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(view.queryByRole("listbox")).toBeNull();
  });

  test("an all-disabled open roster clears the active descendant and cannot commit", () => {
    const { view, trigger, onChange } = renderSelect();
    fireEvent.click(trigger);
    view.rerender(
      <PretableSelect
        aria-label="Operator"
        options={OPTIONS.map((o) => ({ ...o, disabled: true }))}
        value="contains"
        onChange={onChange}
      />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(
      <PretableSelect
        aria-label="Operator"
        options={OPTIONS}
        value="contains"
        onChange={onChange}
      />,
    );
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!),
    ).toHaveAttribute("data-pretable-option-value", "contains");
  });

  test("a disabled selected value seeds the first enabled option", () => {
    const { trigger } = renderSelect({ value: "custom" });
    fireEvent.click(trigger);
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!),
    ).toHaveAttribute("data-pretable-option-value", "contains");
  });

  test("a selected value in an initially all-disabled roster has no active descendant", () => {
    const { trigger, onChange } = renderSelect({
      options: OPTIONS.map((o) => ({ ...o, disabled: true })),
    });
    fireEvent.click(trigger);
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("typeahead uses explicit text for rich labels and primitive overrides", () => {
    const { trigger } = renderSelect({
      options: [
        { value: "contains", label: "contains" },
        { value: "rich", label: <span>Visual label</span>, textValue: "Beta" },
        { value: "plain", label: "Unrelated", textValue: "Gamma" },
        { value: "number", label: 42 },
      ],
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "b" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!),
    ).toHaveAttribute("data-pretable-option-value", "rich");
    fireEvent.keyDown(trigger, { key: "Escape" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "g" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!),
    ).toHaveAttribute("data-pretable-option-value", "plain");
    fireEvent.keyDown(trigger, { key: "Escape" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "4" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!),
    ).toHaveAttribute("data-pretable-option-value", "number");
  });

  test("reopening within 500ms starts a fresh typeahead query", () => {
    const { trigger } = renderSelect({
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
        { value: "c", label: "Charlie" },
      ],
      value: "c",
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "b" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "a" });
    expect(
      document.getElementById(trigger.getAttribute("aria-activedescendant")!),
    ).toHaveAttribute("data-pretable-option-value", "a");
  });
});
