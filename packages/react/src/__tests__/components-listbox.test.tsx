import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  Listbox,
  useListboxKeys,
  type ListboxOption,
} from "../components/listbox";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const OPTIONS: readonly ListboxOption[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "custom", label: "Custom", disabled: true },
  { value: "endsWith", label: "ends with" },
];
const RECT = {
  top: 10,
  left: 20,
  bottom: 30,
  right: 120,
  width: 100,
  height: 20,
  x: 20,
  y: 10,
  toJSON: () => ({}),
} as DOMRect;

describe("Listbox", () => {
  test("renders the ARIA list from data, portalled to body, placed at the anchor", () => {
    const onSelect = vi.fn();
    render(
      <Listbox
        id="lb"
        options={OPTIONS}
        value="equals"
        activeIndex={0}
        anchor={RECT}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    const list = document.querySelector("[data-pretable-listbox]")!;
    expect(list.parentElement).toBe(document.body);
    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("id", "lb");
    expect((list as HTMLElement).style.position).toBe("fixed");
    const options = list.querySelectorAll("[data-pretable-option]");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAttribute("id", "lb-0");
    expect(options[0]).toHaveAttribute("role", "option");
    expect(options[0]).toHaveAttribute("data-value", "contains");
    // aria-selected is the COMMITTED value, not the highlight.
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
  });

  test("clicking an option selects it; a disabled option is inert", () => {
    const onSelect = vi.fn();
    render(
      <Listbox
        id="lb"
        options={OPTIONS}
        value={null}
        activeIndex={-1}
        anchor={RECT}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    fireEvent.click(
      document.querySelector('[data-pretable-option][data-value="endsWith"]')!,
    );
    expect(onSelect).toHaveBeenCalledWith("endsWith");
    fireEvent.click(
      document.querySelector('[data-pretable-option][data-value="custom"]')!,
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("renders nothing for an empty list, not a bare box", () => {
    render(
      <Listbox
        id="lb"
        options={[]}
        value={null}
        activeIndex={-1}
        anchor={RECT}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
  });

  test("an outside pointerdown closes; one inside does not", () => {
    const onClose = vi.fn();
    render(
      <Listbox
        id="lb"
        options={OPTIONS}
        value={null}
        activeIndex={0}
        anchor={RECT}
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.pointerDown(document.querySelector("[data-pretable-option]")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the active option is scrolled into view when the index changes", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function () {
      scrolled.push((this as HTMLElement).id);
    };
    function Host() {
      const [i, setI] = useState(0);
      return (
        <>
          <button onClick={() => setI(3)}>go</button>
          <Listbox
            id="lb"
            options={OPTIONS}
            value={null}
            activeIndex={i}
            anchor={RECT}
            onSelect={() => {}}
            onClose={() => {}}
          />
        </>
      );
    }
    const view = render(<Host />);
    fireEvent.click(view.getByText("go"));
    expect(scrolled.at(-1)).toBe("lb-3");
  });
});

describe("useListboxKeys", () => {
  const key = (k: string) =>
    ({
      key: k,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as React.KeyboardEvent;

  function setup(open = true) {
    const onOpen = vi.fn();
    const onCommit = vi.fn();
    const onClose = vi.fn();
    const hook = renderHook(() =>
      useListboxKeys({
        options: OPTIONS,
        open,
        initialIndex: 0,
        onOpen,
        onCommit,
        onClose,
      }),
    );
    return { hook, onOpen, onCommit, onClose };
  }

  test("ArrowDown/ArrowUp move with wrap and skip a disabled option", () => {
    const { hook } = setup();
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(1);
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(3); // skipped "custom"
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(0); // wrapped
    act(() => hook.result.current.onKeyDown(key("ArrowUp")));
    expect(hook.result.current.activeIndex).toBe(3);
  });

  test("Home and End jump to the first and last enabled option", () => {
    const { hook } = setup();
    act(() => hook.result.current.onKeyDown(key("End")));
    expect(hook.result.current.activeIndex).toBe(3);
    act(() => hook.result.current.onKeyDown(key("Home")));
    expect(hook.result.current.activeIndex).toBe(0);
  });

  test("typeahead matches a label prefix and resets after 500ms", () => {
    vi.useFakeTimers();
    const { hook } = setup();
    act(() => hook.result.current.onKeyDown(key("e")));
    expect(hook.result.current.activeIndex).toBe(1); // "equals"
    act(() => hook.result.current.onKeyDown(key("n")));
    expect(hook.result.current.activeIndex).toBe(3); // "en…" → "ends with"
    act(() => vi.advanceTimersByTime(600));
    act(() => hook.result.current.onKeyDown(key("c")));
    expect(hook.result.current.activeIndex).toBe(0); // buffer reset: "c" → "contains" (Custom is disabled)
  });

  test("Enter and Space commit the active option; Escape and Tab close", () => {
    const { hook, onCommit, onClose } = setup();
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    const enter = key("Enter");
    act(() => hook.result.current.onKeyDown(enter));
    expect(onCommit).toHaveBeenCalledWith("equals");
    expect(enter.preventDefault).toHaveBeenCalled();
    act(() => hook.result.current.onKeyDown(key(" ")));
    expect(onCommit).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.onKeyDown(key("Escape")));
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: true });
    const tab = key("Tab");
    act(() => hook.result.current.onKeyDown(tab));
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: false });
    expect(tab.preventDefault).not.toHaveBeenCalled(); // Tab still moves
  });

  test("on a closed trigger, the navigation keys open rather than move", () => {
    const { hook, onOpen } = setup(false);
    for (const k of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      act(() => hook.result.current.onKeyDown(key(k)));
    }
    expect(onOpen).toHaveBeenCalledTimes(4);
    expect(hook.result.current.activeIndex).toBe(0);
  });
});
