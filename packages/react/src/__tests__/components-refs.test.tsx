import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { PretableCheckbox } from "../components/checkbox";
import { PretableSelect } from "../components/select";
import { PretableTextInput } from "../components/text-input";

afterEach(cleanup);

type ConsumerRef = (node: HTMLElement | null) => void | (() => void);
const controls = [
  {
    name: "Checkbox",
    render: (ref: ConsumerRef) => (
      <PretableCheckbox
        aria-label="Check"
        checked={false}
        onCheckedChange={() => {}}
        ref={ref}
      />
    ),
  },
  {
    name: "TextInput",
    render: (ref: ConsumerRef) => (
      <PretableTextInput aria-label="Text" ref={ref} />
    ),
  },
  {
    name: "Select",
    render: (ref: ConsumerRef) => (
      <PretableSelect
        aria-label="Select"
        options={[{ value: "a", label: "A" }]}
        value="a"
        onChange={() => {}}
        ref={ref}
      />
    ),
  },
];

it.each(controls)(
  "$name invokes callback cleanup once on replacement and unmount",
  ({ render: control }) => {
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const first = vi.fn<ConsumerRef>(() => disposeFirst);
    const second = vi.fn<ConsumerRef>(() => disposeSecond);
    const { rerender, unmount } = render(control(first));
    const node = first.mock.calls[0];
    expect(first).toHaveBeenCalledOnce();
    rerender(control(first));
    expect(first).toHaveBeenCalledOnce();
    expect(disposeFirst).not.toHaveBeenCalled();
    rerender(control(second));
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second.mock.calls[0]).toEqual(node);
    unmount();
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  },
);
it.each(controls)(
  "$name cleans every StrictMode attachment exactly once",
  ({ render: control }) => {
    const cleanups: ReturnType<typeof vi.fn>[] = [];
    const ref = vi.fn((node: HTMLElement | null) => {
      expect(node).not.toBeNull();
      const dispose = vi.fn();
      cleanups.push(dispose);
      return dispose;
    });
    const { unmount } = render(<StrictMode>{control(ref)}</StrictMode>);
    expect(cleanups.length).toBeGreaterThanOrEqual(2);
    expect(
      cleanups.slice(0, -1).every((dispose) => dispose.mock.calls.length === 1),
    ).toBe(true);
    expect(cleanups.at(-1)).not.toHaveBeenCalled();
    unmount();
    expect(cleanups.every((dispose) => dispose.mock.calls.length === 1)).toBe(
      true,
    );
  },
);
it.each(controls)(
  "$name delivers null to callback refs without cleanup",
  ({ render: control }) => {
    const ref = vi.fn<ConsumerRef>(() => {});
    const { unmount } = render(control(ref));
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLElement));
    unmount();
    expect(ref).toHaveBeenLastCalledWith(null);
    expect(ref).toHaveBeenCalledTimes(2);
  },
);
it("clears all control object refs on unmount", () => {
  const checkbox = createRef<HTMLButtonElement>();
  const input = createRef<HTMLInputElement>();
  const select = createRef<HTMLButtonElement>();
  const { unmount } = render(
    <>
      <PretableCheckbox
        aria-label="Check"
        checked={false}
        onCheckedChange={() => {}}
        ref={checkbox}
      />
      <PretableTextInput aria-label="Text" ref={input} />
      <PretableSelect
        aria-label="Select"
        options={[]}
        value=""
        onChange={() => {}}
        ref={select}
      />
    </>,
  );
  expect(checkbox.current).toBeInstanceOf(HTMLButtonElement);
  expect(input.current).toBeInstanceOf(HTMLInputElement);
  expect(select.current).toBeInstanceOf(HTMLButtonElement);
  unmount();
  expect(checkbox.current).toBeNull();
  expect(input.current).toBeNull();
  expect(select.current).toBeNull();
});
