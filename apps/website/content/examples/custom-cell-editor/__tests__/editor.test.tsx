import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PretableEditorInput } from "@pretable/react";

import { columns } from "../columns";
import { tasks, type Task } from "../data";

function setup(overrides: Partial<PretableEditorInput<Task>> = {}) {
  const input = {
    row: tasks[0],
    rowId: "t1",
    columnId: "priority",
    column: columns[1],
    value: 2,
    draft: "2",
    status: "editing",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  } as PretableEditorInput<Task>;
  render(columns[1]!.renderEditor!(input));
  return { input, field: screen.getByRole("combobox", { name: "Priority" }) };
}

describe("custom priority editor", () => {
  it("labels the field, associates rendered errors, and keeps drafts as strings", () => {
    const { input, field } = setup({ error: "Choose Medium or Low." });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById(field.getAttribute("aria-errormessage")!),
    ).toHaveTextContent("Choose Medium or Low.");
    fireEvent.change(field, { target: { value: "1" } });
    expect(input.setDraft).toHaveBeenCalledWith("1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose Medium or Low.",
    );
  });

  it.each(["checking", "validating", "saving"] as const)(
    "guards edits and commits while %s",
    (status) => {
      const { input, field } = setup({ status });
      expect(field).toHaveAttribute("aria-busy", "true");
      expect(field).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("status")).toHaveTextContent(
        new RegExp(status, "i"),
      );
      fireEvent.change(field, { target: { value: "1" } });
      expect(field).toHaveValue("2");
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.keyDown(field, { key: "Escape" });
      fireEvent.blur(field);
      expect(input.setDraft).not.toHaveBeenCalled();
      expect(input.commit).not.toHaveBeenCalled();
      expect(input.cancel).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Enter", false, "down"],
    ["Enter", true, "up"],
    ["Tab", false, "right"],
    ["Tab", true, "left"],
  ])("commits %s with shift=%s toward %s", (key, shiftKey, direction) => {
    const { input, field } = setup();
    fireEvent.keyDown(field, { key, shiftKey });
    fireEvent.blur(field);
    expect(input.commit).toHaveBeenCalledExactlyOnceWith(direction);
  });

  it("cancels without a blur save and leaves arrow keys native", () => {
    const { input, field } = setup();
    expect(fireEvent.keyDown(field, { key: "ArrowDown" })).toBe(true);
    expect(input.commit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(input.cancel).toHaveBeenCalledOnce();
    expect(input.commit).not.toHaveBeenCalled();
  });

  it("ignores composition commands and commits ordinary blur in place", () => {
    const { input, field } = setup();
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(input.commit).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(input.commit).toHaveBeenCalledExactlyOnceWith();
  });
});
