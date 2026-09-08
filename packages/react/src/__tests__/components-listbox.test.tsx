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
  listboxOptionId,
  useListboxKeys,
  type ListboxOption,
} from "../components/listbox";

/** Restored in `afterEach`: jsdom ships no scrollIntoView, tests patch one in. */
const REAL_SCROLL_INTO_VIEW = Element.prototype.scrollIntoView;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Element.prototype.scrollIntoView = REAL_SCROLL_INTO_VIEW;
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
    // The MENU placement, not the dialog's: `position: fixed` alone is true
    // of `popoverStyle` too, so pin what only `menuPopoverStyle` produces —
    // content width between a 160px floor and the 240px dialog cap — plus the
    // `top` derived from the anchor's bottom edge (30 + the 4px gap).
    const style = (list as HTMLElement).style;
    expect(style.position).toBe("fixed");
    expect(style.width).toBe("max-content");
    expect(style.minWidth).toBe("160px");
    expect(style.maxWidth).toBe("240px");
    expect(style.top).toBe("34px");
    expect(style.left).toBe("20px");
    const options = list.querySelectorAll("[data-pretable-option]");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAttribute("id", "lb-0"); // the format itself
    expect(options[3]).toHaveAttribute("id", listboxOptionId("lb", 3));
    expect(options[0]).toHaveAttribute("role", "option");
    expect(options[0]).toHaveAttribute(
      "data-pretable-option-value",
      "contains",
    );
    // aria-selected is the COMMITTED value, not the highlight.
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
  });

  test('width="dialog" draws the cell editors\' fixed column', () => {
    // The cell editors' list is the dialog width — the same 240px column
    // their panels use — so the extraction leaves the enum editor's look
    // unchanged. The default-placement test above is the positive twin.
    render(
      <Listbox
        id="lb"
        width="dialog"
        options={OPTIONS}
        value={null}
        activeIndex={0}
        anchor={RECT}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    const style = document.querySelector<HTMLElement>(
      "[data-pretable-listbox]",
    )!.style;
    expect(style.width).toBe("240px");
    expect(style.minWidth).toBe("");
    expect(style.maxWidth).toBe("");
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
      document.querySelector(
        '[data-pretable-option][data-pretable-option-value="endsWith"]',
      )!,
    );
    expect(onSelect).toHaveBeenCalledWith("endsWith");
    fireEvent.click(
      document.querySelector(
        '[data-pretable-option][data-pretable-option-value="custom"]',
      )!,
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("renders nothing for an empty list, and an outside press still closes it", () => {
    const onClose = vi.fn();
    render(
      <Listbox
        id="lb"
        options={[]}
        value={null}
        activeIndex={-1}
        anchor={RECT}
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
    // Nothing rendered means no root element; the press is still outside.
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
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

  test("a press inside the list does not reach a host popover's outside-press listener", () => {
    // The list is portalled to body: unstopped, a press on an option would
    // read as OUTSIDE to the dialog or menu the select sits in, dismissing
    // the host under the pointer.
    const hostListener = vi.fn();
    document.addEventListener("pointerdown", hostListener);
    try {
      render(
        <Listbox
          id="lb"
          options={OPTIONS}
          value={null}
          activeIndex={0}
          anchor={RECT}
          onSelect={() => {}}
          onClose={() => {}}
        />,
      );
      fireEvent.pointerDown(document.querySelector("[data-pretable-option]")!);
      expect(hostListener).not.toHaveBeenCalled();
      // The positive twin: a real outside press still reaches the host.
      fireEvent.pointerDown(document.body);
      expect(hostListener).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("pointerdown", hostListener);
    }
  });

  test("the active option is scrolled into view when the index changes", () => {
    const scrolled: string[] = [];
    // Restored by the suite-wide afterEach.
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

  function setup(
    open = true,
    initialIndex = 0,
    options: readonly ListboxOption[] = OPTIONS,
  ) {
    const onOpen = vi.fn();
    const onCommit = vi.fn();
    const onClose = vi.fn();
    const hook = renderHook(() =>
      useListboxKeys({
        options,
        open,
        initialIndex,
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

  test("from no highlight, ArrowUp lands on the last enabled option and ArrowDown on the first", () => {
    const up = setup(true, -1);
    act(() => up.hook.result.current.onKeyDown(key("ArrowUp")));
    expect(up.hook.result.current.activeIndex).toBe(3);
    const down = setup(true, -1);
    act(() => down.hook.result.current.onKeyDown(key("ArrowDown")));
    expect(down.hook.result.current.activeIndex).toBe(0);
  });

  test("with every option disabled there is no highlight and nothing commits", () => {
    const allDisabled: readonly ListboxOption[] = OPTIONS.map((o) => ({
      ...o,
      disabled: true,
    }));
    const { hook, onCommit } = setup(true, -1, allDisabled);
    act(() => hook.result.current.onKeyDown(key("Home")));
    expect(hook.result.current.activeIndex).toBe(-1);
    act(() => hook.result.current.onKeyDown(key("End")));
    expect(hook.result.current.activeIndex).toBe(-1);
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(-1);
    act(() => hook.result.current.onKeyDown(key("ArrowUp")));
    expect(hook.result.current.activeIndex).toBe(-1);
    act(() => hook.result.current.onKeyDown(key("e")));
    expect(hook.result.current.activeIndex).toBe(-1); // typeahead skips them too
    act(() => hook.result.current.onKeyDown(key("Enter")));
    expect(onCommit).not.toHaveBeenCalled();
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

  // The tests above hand the handler a hand-rolled event object. This one
  // drives it from a real DOM keydown, so the `key.length === 1` typeahead
  // test and the ctrl/meta/alt guards are exercised against a real event.
  test("wired to a real element, arrows commit and a printable key runs typeahead", () => {
    const onCommit = vi.fn();
    let index = -1;
    function Host() {
      const keys = useListboxKeys({
        options: OPTIONS,
        open: true,
        initialIndex: 0,
        onOpen: () => {},
        onCommit,
        onClose: () => {},
      });
      index = keys.activeIndex;
      return <button onKeyDown={keys.onKeyDown}>trigger</button>;
    }
    const view = render(<Host />);
    const trigger = view.getByText("trigger");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(index).toBe(1);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("equals");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(index).toBe(3);
    fireEvent.keyDown(trigger, { key: "e" });
    expect(index).toBe(1); // moved back to "equals": typeahead saw the key
  });

  test("re-opening re-seeds the highlight from the current value", () => {
    const hook = renderHook(
      ({ open }) =>
        useListboxKeys({
          options: OPTIONS,
          open,
          initialIndex: 1,
          onOpen: () => {},
          onCommit: () => {},
          onClose: () => {},
        }),
      { initialProps: { open: true } },
    );
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(3);
    hook.rerender({ open: false });
    hook.rerender({ open: true });
    expect(hook.result.current.activeIndex).toBe(1);
  });
});
