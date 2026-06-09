import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(() => {
  cleanup();
});

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "name",
    row: { id: "r1", name: "Ada" },
    column: { id: "name" },
    value: "Ada",
    draft: "Ada",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  };
}

describe("CellEditor (default)", () => {
  it("renders a text input seeded with the draft", () => {
    render(<CellEditor input={makeInput({ draft: "Ada" })} />);
    expect(screen.getByRole("textbox")).toHaveValue("Ada");
  });

  it("pushes keystrokes to setDraft", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ setDraft })} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ada L." },
    });
    expect(setDraft).toHaveBeenCalledWith("Ada L.");
  });

  it("commits down on Enter, right on Tab, and cancels on Escape", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("down");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("delegates to column.renderEditor when provided", () => {
    const input = makeInput({
      column: { id: "name", renderEditor: () => <span>custom</span> },
    });
    render(<CellEditor input={input} />);
    expect(screen.getByText("custom")).toBeInTheDocument();
  });
});
