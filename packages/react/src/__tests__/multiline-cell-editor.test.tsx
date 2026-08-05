import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "msg",
    row: { id: "r1", msg: "line one" },
    column: { id: "msg", wrap: true, header: "Message" },
    value: "line one",
    status: "editing",
    draft: "line one",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

describe("MultilineCellEditor (via dispatcher)", () => {
  it("dispatches wrapped text columns to a textarea", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("Enter does NOT commit (newline stays in the field)", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl+Enter commits down", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      metaKey: true,
    });
    expect(commit).toHaveBeenCalledWith("down");
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("Tab commits right; Escape cancels", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });
});
