import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);
const options = [
  { value: "queued", label: "Queued" },
  { value: "done", label: "Done" },
];
function input(over: Partial<PretableEditorInput> = {}): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "value",
    row: { id: "r1" },
    column: { id: "value" },
    value: "queued",
    draft: "queued",
    status: "editing",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  };
}
const columns: PretableEditorInput["column"][] = [
  { id: "value" },
  { id: "value", type: "number" },
  { id: "value", type: "date" },
  { id: "value", wrap: true },
  { id: "value", type: "enum", options },
];
it.each(["checking", "validating", "saving"] as const)(
  "consumes pending commands and freezes fields while %s",
  (status) => {
    for (const column of columns) {
      const props = input({
        status,
        column,
        draft: column.type === "enum" ? "Queued" : "7",
      });
      const parent = vi.fn();
      const { unmount } = render(
        <form onKeyDown={parent}>
          <CellEditor input={props} />
        </form>,
      );
      const box = screen.getByRole(
        column.type === "enum" ? "combobox" : "textbox",
      );
      expect(box).toHaveAttribute("readonly");
      expect(box).toHaveAttribute("aria-busy", "true");
      for (const command of [
        { key: "Enter", ctrlKey: true },
        { key: "Enter", metaKey: true },
        { key: "Tab" },
      ]) {
        expect(fireEvent.keyDown(box, command)).toBe(false);
      }
      fireEvent.blur(box);
      expect(props.commit).not.toHaveBeenCalled();
      fireEvent.change(box, { target: { value: "changed" } });
      expect(props.setDraft).not.toHaveBeenCalled();
      expect(parent).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(box, { key: "Escape" })).toBe(false);
      expect(props.cancel).toHaveBeenCalledOnce();
      unmount();
    }
  },
);
it.each(["checking", "validating", "saving"] as const)(
  "freezes enum selection while %s",
  (status) => {
    const props = input({
      status,
      draft: "Queued",
      column: { id: "value", type: "enum", options },
    });
    const parent = vi.fn();
    render(
      <div onKeyDown={parent}>
        <CellEditor input={props} />
      </div>,
    );
    const box = screen.getByRole("combobox");
    const active = box.getAttribute("aria-activedescendant");
    expect(fireEvent.keyDown(box, { key: "ArrowDown" })).toBe(false);
    expect(box).toHaveAttribute("aria-activedescendant", active);
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(props.setDraft).not.toHaveBeenCalled();
    expect(props.commit).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
  },
);
it("normalizes enum only after permission, once across subsequent error resets", () => {
  const props = input({
    status: "checking",
    column: { id: "value", type: "enum", options },
  });
  const { rerender } = render(<CellEditor input={props} />);
  expect(props.setDraft).not.toHaveBeenCalled();
  rerender(
    <CellEditor
      input={{ ...props, status: "error", error: "permission unavailable" }}
    />,
  );
  expect(props.setDraft).not.toHaveBeenCalled();
  rerender(<CellEditor input={{ ...props, status: "editing" }} />);
  expect(props.setDraft).toHaveBeenCalledExactlyOnceWith("Queued");
  for (const status of [
    "validating",
    "editing",
    "saving",
    "error",
    "editing",
  ] as const) {
    rerender(<CellEditor input={{ ...props, status, draft: "done" }} />);
  }
  expect(props.setDraft).toHaveBeenCalledTimes(1);
});
it("does not normalize a user correction after a permission error", () => {
  const props = input({
    status: "checking",
    column: { id: "value", type: "enum", options },
  });
  const { rerender } = render(<CellEditor input={props} />);
  rerender(
    <CellEditor
      input={{ ...props, status: "error", error: "permission failed" }}
    />,
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "done" } });
  expect(props.setDraft).toHaveBeenCalledExactlyOnceWith("done");
  rerender(
    <CellEditor input={{ ...props, status: "editing", draft: "done" }} />,
  );
  expect(props.setDraft).toHaveBeenCalledTimes(1);
});
