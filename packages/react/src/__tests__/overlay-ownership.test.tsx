import { useRef, useState } from "react";
import { OverlayPortal } from "../overlay/OverlayPortal";
import { useOutsidePointer } from "../overlay/outside-pointer";
import { logicallyContains } from "../overlay/logical-containment";
import { PretableOverlayProvider } from "../overlay/portal-context";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PretableSelect } from "../components/select";
import { FilterMenu } from "../filter-menu/FilterMenu";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];
afterEach(cleanup);

test("a sibling trigger dismisses the old list and its own trigger toggles closed", () => {
  const view = render(
    <>
      <PretableSelect
        aria-label="A"
        options={options}
        value="a"
        onChange={() => {}}
      />
      <PretableSelect
        aria-label="B"
        options={options}
        value="a"
        onChange={() => {}}
      />
    </>,
  );
  const a = view.getByRole("combobox", { name: "A" });
  const b = view.getByRole("combobox", { name: "B" });
  fireEvent.click(a);
  fireEvent.pointerDown(b);
  fireEvent.click(b);
  expect(a).toHaveAttribute("aria-expanded", "false");
  expect(view.getAllByRole("listbox")).toHaveLength(1);
  fireEvent.pointerDown(b);
  fireEvent.click(b);
  expect(view.queryByRole("listbox")).toBeNull();
});

test("outside presses close even when the target stops bubbling", () => {
  const view = render(
    <>
      <PretableSelect
        aria-label="A"
        options={options}
        value="a"
        onChange={() => {}}
      />
      <button onPointerDown={(e) => e.stopPropagation()}>Outside</button>
    </>,
  );
  fireEvent.click(view.getByRole("combobox"));
  fireEvent.pointerDown(view.getByText("Outside"));
  expect(view.queryByRole("listbox")).toBeNull();
});

test("a nested option press bubbles while keeping its filter parent open", () => {
  const close = vi.fn();
  const bubble = vi.fn();
  const view = render(
    <div onPointerDown={bubble}>
      <FilterMenu
        columnId="a"
        label="A"
        type="text"
        options={[]}
        initialFilter={null}
        onChange={() => {}}
        onClose={close}
      />
    </div>,
  );
  fireEvent.click(view.getByRole("combobox"));
  fireEvent.pointerDown(view.getAllByRole("option")[0]!);
  expect(bubble).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

function NestedSelects() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  useOutsidePointer(rootRef, () => setOpen(false));
  return open ? (
    <OverlayPortal>
      <div role="dialog" ref={rootRef}>
        <PretableSelect
          aria-label="A"
          options={options}
          value="a"
          onChange={() => {}}
        />
        <PretableSelect
          aria-label="B"
          options={options}
          value="a"
          onChange={() => {}}
        />
      </div>
    </OverlayPortal>
  ) : null;
}

test("nested sibling lists dismiss only their sibling, and Escape retains parent and trigger focus", () => {
  const view = render(<NestedSelects />);
  const a = view.getByRole("combobox", { name: "A" });
  const b = view.getByRole("combobox", { name: "B" });
  fireEvent.click(a);
  fireEvent.pointerDown(b);
  fireEvent.click(b);
  expect(view.getByRole("dialog")).toBeInTheDocument();
  expect(view.getAllByRole("listbox")).toHaveLength(1);
  expect(a).toHaveAttribute("aria-expanded", "false");
  fireEvent.pointerDown(view.getAllByRole("option")[1]!);
  expect(view.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(b, { key: "Escape" });
  expect(view.queryByRole("listbox")).toBeNull();
  expect(view.getByRole("dialog")).toBeInTheDocument();
  expect(b).toHaveFocus();
});

test("portal boundaries unregister on replacement and unmount", () => {
  const target = document.createElement("div");
  const replacement = document.createElement("div");
  document.body.append(target, replacement);
  const content = (
    <div data-testid="parent">
      <OverlayPortal>
        <span data-testid="child" />
      </OverlayPortal>
    </div>
  );
  const view = render(
    <PretableOverlayProvider container={target}>
      {content}
    </PretableOverlayProvider>,
  );
  const parent = view.getByTestId("parent");
  const oldChild = view.getByTestId("child");
  expect(parent.contains(oldChild)).toBe(false);
  expect(logicallyContains(parent, oldChild)).toBe(true);
  view.rerender(
    <PretableOverlayProvider container={replacement}>
      {content}
    </PretableOverlayProvider>,
  );
  expect(logicallyContains(parent, oldChild)).toBe(false);
  const newChild = view.getByTestId("child");
  expect(logicallyContains(parent, newChild)).toBe(true);
  view.unmount();
  expect(logicallyContains(parent, newChild)).toBe(false);
  target.remove();
  replacement.remove();
});
