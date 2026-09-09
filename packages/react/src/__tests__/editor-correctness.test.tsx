import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { CellEditor } from "../cell-editor";
import { parseDraftForType } from "../editors/type-parsing";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);
const duplicateOptions = [
  { value: "one", label: "Shared" },
  { value: "two", label: "Shared" },
  { value: "Shared", label: "Other" },
];
function editor(over: Partial<PretableEditorInput> = {}): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "value",
    row: { id: "r1" },
    column: { id: "value", header: "Value" },
    value: "",
    draft: "",
    status: "editing",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  };
}
function EnumHarness({
  value = "two",
  typed = false,
  onResult,
  options = duplicateOptions,
  formatted,
}: {
  formatted?: string;
  options?: typeof duplicateOptions;
  value?: string | null;
  typed?: boolean;
  onResult: (result: unknown) => void;
}) {
  const [draft, setDraft] = useState<unknown>(
    typed ? "S" : (formatted ?? value),
  );
  const latest = useRef(draft);
  const column = {
    id: "value",
    type: "enum" as const,
    options,
  };
  return (
    <CellEditor
      input={{
        ...editor({ column, value, draft, seededFromTyping: typed }),
        setDraft: (next) => {
          latest.current = next;
          setDraft(next);
        },
        commit: () => onResult(parseDraftForType(column, latest.current)),
      }}
    />
  );
}

test("explicit enum choice preserves the second duplicate label's canonical identity", () => {
  const result = vi.fn();
  const view = render(<EnumHarness onResult={result} />);
  fireEvent.click(view.getAllByRole("option", { name: "Shared" })[1]!);
  expect(result).toHaveBeenCalledWith({ ok: true, value: "two" });
});
test("a pristine enum keeps identity through a label/value collision", () => {
  const result = vi.fn();
  const view = render(<EnumHarness value="Shared" onResult={result} />);
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Tab" });
  expect(result).toHaveBeenCalledWith({ ok: true, value: "Shared" });
});
test.each(["Shared", "SHARED"])(
  "typed ambiguous enum text %s is rejected",
  (text) => {
    const result = vi.fn();
    const view = render(<EnumHarness onResult={result} />);
    fireEvent.change(view.getByRole("combobox"), { target: { value: "Sh" } });
    fireEvent.change(view.getByRole("combobox"), { target: { value: text } });
    fireEvent.keyDown(view.getByRole("combobox"), { key: "Enter" });
    expect(result).toHaveBeenCalledWith({
      ok: false,
      message: "Pick an option",
    });
  },
);
test.each(["Enter", "Tab", "blur"])(
  "blank enum clears via %s without implicitly choosing the first option",
  (action) => {
    const result = vi.fn();
    const view = render(<EnumHarness onResult={result} />);
    const field = view.getByRole("combobox");
    fireEvent.change(field, { target: { value: "" } });
    if (action === "blur") fireEvent.blur(field);
    else fireEvent.keyDown(field, { key: action });
    expect(result).toHaveBeenCalledWith({ ok: true, value: null });
  },
);
const cases = [
  { id: "value", type: "text" as const },
  { id: "value", type: "number" as const },
  { id: "value", type: "enum" as const, options: duplicateOptions },
  { id: "value", type: "date" as const },
  { id: "value", type: "text" as const, wrap: true },
];
test.each(cases)(
  "composition keys are untouched for $type wrap=$wrap",
  (column) => {
    const props = editor({
      column,
      draft: column.type === "date" ? "2026-08-06" : "two",
      value: "two",
    });
    const view = render(<CellEditor input={props} />);
    const field = view.container.querySelector("input,textarea")!;
    (props.setDraft as ReturnType<typeof vi.fn>).mockClear();
    for (const key of [
      "Enter",
      "Tab",
      "Escape",
      "ArrowDown",
      "ArrowRight",
      "PageDown",
    ])
      expect(
        fireEvent.keyDown(field, { key, isComposing: true, ctrlKey: true }),
      ).toBe(true);
    fireEvent.compositionStart(field);
    for (const key of ["Enter", "Escape", "ArrowDown"])
      expect(fireEvent.keyDown(field, { key, ctrlKey: true })).toBe(true);
    fireEvent.compositionEnd(field);
    expect(
      fireEvent.keyDown(field, { key: "Enter", keyCode: 229, ctrlKey: true }),
    ).toBe(true);
    expect(props.commit).not.toHaveBeenCalled();
    expect(props.cancel).not.toHaveBeenCalled();
    expect(props.setDraft).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Tab", shiftKey: true });
    expect(props.commit).toHaveBeenCalledWith("left");
  },
);
test.each(cases)("reverse commit direction for $type wrap=$wrap", (column) => {
  const props = editor({
    column,
    draft: column.type === "date" ? "2026-08-06" : "two",
    value: "two",
  });
  const view = render(<CellEditor input={props} />);
  const field = view.container.querySelector("input,textarea")!;
  fireEvent.keyDown(field, { key: "Enter", shiftKey: true, ctrlKey: true });
  expect(props.commit).toHaveBeenCalledWith("up");
});
test("date browsing does not write, caret arrows stay native until navigation, and Enter chooses the cursor", () => {
  const props = editor({
    column: { id: "value", type: "date" },
    value: "2026-08-06",
    draft: "2026-08-06",
  });
  const view = render(<CellEditor input={props} />);
  const field = view.container.querySelector("input")!;
  expect(field).toHaveAttribute("role", "combobox");
  expect(field).toHaveAttribute("aria-haspopup", "grid");
  expect(fireEvent.keyDown(field, { key: "ArrowRight" })).toBe(true);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.keyDown(field, { key: "ArrowRight" });
  expect(props.setDraft).not.toHaveBeenCalled();
  expect(view.getByRole("gridcell", { name: "2026-08-06" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(view.getByRole("gridcell", { name: "2026-08-14" })).toHaveAttribute(
    "data-pretable-date-active",
    "",
  );
  fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
  expect(props.setDraft).toHaveBeenCalledWith("2026-08-14");
  expect(props.commit).toHaveBeenCalledWith("up");
});
test("month browsing followed by Tab commits the current typed draft without writing the cursor", () => {
  const props = editor({
    column: { id: "value", type: "date" },
    value: "2026-08-06",
    draft: "2026-08-06",
  });
  const view = render(<CellEditor input={props} />);
  fireEvent.click(view.getByRole("button", { name: "Next month" }));
  fireEvent.keyDown(view.container.querySelector("input")!, { key: "Tab" });
  expect(props.setDraft).not.toHaveBeenCalled();
  expect(props.commit).toHaveBeenCalledWith("right");
});

test("removing a pristine choice cannot reinterpret its value as another label", () => {
  const result = vi.fn();
  const view = render(<EnumHarness value="Shared" onResult={result} />);
  view.rerender(
    <EnumHarness
      value="Shared"
      options={[{ value: "other", label: "Shared" }]}
      onResult={result}
    />,
  );
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Enter" });
  expect(result).toHaveBeenCalledWith({ ok: false, message: "Pick an option" });
});

test("a pristine formatted enum draft keeps its original canonical identity", () => {
  const result = vi.fn();
  const view = render(
    <EnumHarness value="two" formatted="Other" onResult={result} />,
  );
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Enter" });
  expect(result).toHaveBeenCalledWith({ ok: true, value: "two" });
});
test("explicit enum navigation after clearing chooses that option on blur", () => {
  const result = vi.fn();
  const view = render(<EnumHarness onResult={result} />);
  const field = view.getByRole("combobox");
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.keyDown(field, { key: "ArrowDown" });
  fireEvent.blur(field);
  expect(result).toHaveBeenCalledWith({ ok: true, value: "two" });
});
test("whitespace-only date typing clears on blur", () => {
  const props = editor({
    column: { id: "value", type: "date" },
    value: "2026-08-06",
    draft: "2026-08-06",
  });
  const view = render(<CellEditor input={props} />);
  const field = view.getByRole("combobox");
  fireEvent.change(field, { target: { value: "   " } });
  view.rerender(<CellEditor input={{ ...props, draft: "   " }} />);
  fireEvent.blur(field);
  expect(props.commit).toHaveBeenCalledOnce();
  expect(props.cancel).not.toHaveBeenCalled();
});

test.each([null, ""])("a pristine empty enum %s remains cleared", (value) => {
  const result = vi.fn();
  const view = render(<EnumHarness value={value} onResult={result} />);
  fireEvent.keyDown(view.getByRole("combobox"), { key: "Enter" });
  expect(result).toHaveBeenCalledWith({ ok: true, value: null });
});
test("a filtered explicit choice keeps its highlight when a failed commit leaves the editor open", () => {
  const result = vi.fn();
  const view = render(<EnumHarness onResult={result} />);
  const field = view.getByRole("combobox");
  fireEvent.change(field, { target: { value: "Ot" } });
  fireEvent.click(view.getByRole("option", { name: "Other" }));
  const selected = view.getByRole("option", { name: "Other" });
  expect(selected).toHaveAttribute("aria-selected", "true");
  expect(field).toHaveAttribute("aria-activedescendant", selected.id);
});
