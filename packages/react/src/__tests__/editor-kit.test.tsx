import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ButtonHTMLAttributes,
} from "react";
import { afterEach, expect, test, vi } from "vitest";
import { CellEditor } from "../cell-editor";
import {
  DEFAULT_COMPONENTS,
  PretableComponentsProvider,
  useResolvedComponents,
} from "../components/context";
import type { PretableEditorInput } from "../types";

const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>((props, ref) => <input {...props} ref={ref} data-replacement="input" />);
const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>((props, ref) => (
  <textarea {...props} ref={ref} data-replacement="textarea" />
));
const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button {...props} ref={ref} data-replacement="button" />);
afterEach(cleanup);
const columns = [
  { id: "value", type: "text" as const },
  { id: "value", type: "text" as const, wrap: true },
  { id: "value", type: "number" as const },
  {
    id: "value",
    type: "enum" as const,
    options: [{ value: "a", label: "Alpha" }],
  },
  { id: "value", type: "date" as const },
];
test.each(columns)(
  "$type wrap=$wrap uses the replacement field with a working ref and pending/error props",
  (column) => {
    const input: PretableEditorInput = {
      rowId: "r1",
      columnId: "value",
      row: { id: "r1" },
      column: { ...column, header: "Value" },
      value: column.type === "date" ? "2026-08-06" : "a",
      draft: column.type === "date" ? "2026-08-06" : "a",
      status: "saving",
      error: "Try again",
      setDraft: vi.fn(),
      commit: vi.fn(),
      cancel: vi.fn(),
    };
    const view = render(
      <PretableComponentsProvider
        value={{ ...DEFAULT_COMPONENTS, TextInput, Textarea, IconButton }}
      >
        <CellEditor input={input} />
      </PretableComponentsProvider>,
    );
    const field = view.container.querySelector("input,textarea")!;
    expect(field).toHaveAttribute(
      "data-replacement",
      column.wrap ? "textarea" : "input",
    );
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleName("Value");
    expect(field).toHaveAttribute("site", "cell-editor");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAttribute("aria-invalid", "true");
    for (const button of view.queryAllByRole("button")) {
      expect(button).toHaveAttribute("data-replacement", "button");
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    fireEvent.change(field, { target: { value: "changed" } });
    expect(input.setDraft).not.toHaveBeenCalled();
  },
);
test("Textarea participates in stable slot resolution", () => {
  const hook = renderHook(
    ({ area }) => useResolvedComponents({ Textarea: area }),
    { initialProps: { area: Textarea } },
  );
  expect(hook.result.current.Textarea).toBe(Textarea);
  const first = hook.result.current;
  hook.rerender({ area: Textarea });
  expect(hook.result.current).toBe(first);
});
test("a replacement field attached during the edit receives focus and subsequent commands", () => {
  const input: PretableEditorInput = {
    rowId: "r1",
    columnId: "value",
    row: { id: "r1" },
    column: { id: "value", type: "text" },
    value: "a",
    draft: "a",
    status: "editing",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
  };
  const tree = (custom: boolean) => (
    <PretableComponentsProvider
      value={{ ...DEFAULT_COMPONENTS, ...(custom ? { TextInput } : {}) }}
    >
      <CellEditor input={input} />
    </PretableComponentsProvider>
  );
  const view = render(tree(false));
  view.rerender(tree(true));
  const field = view.getByRole("textbox");
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: "next" } });
  expect(input.setDraft).toHaveBeenCalledWith("next");
  fireEvent.keyDown(field, { key: "Tab", shiftKey: true });
  expect(input.commit).toHaveBeenCalledWith("left");
});
