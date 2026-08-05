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
    columnId: "qty",
    row: { id: "r1", qty: 5 },
    column: { id: "qty", type: "number", header: "Qty" },
    value: 5,
    status: "editing",
    draft: "5",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

describe("NumberCellEditor (via dispatcher)", () => {
  it("dispatches number columns to a decimal input", () => {
    render(<CellEditor input={makeInput()} />);
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("inputmode", "decimal");
  });

  it("ArrowUp/Down step the draft by column.step ?? 1", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ setDraft })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    expect(setDraft).toHaveBeenCalledWith("6");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    expect(setDraft).toHaveBeenCalledWith("4");
  });

  it("honors a custom step", () => {
    const setDraft = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          setDraft,
          column: { id: "qty", type: "number", step: 0.5 },
        })}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    expect(setDraft).toHaveBeenCalledWith("5.5");
  });

  it("stepper buttons step without committing", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(setDraft).toHaveBeenCalledWith("6");
    expect(commit).not.toHaveBeenCalled();
  });

  it("still commits on Enter (shared chrome intact)", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("down");
  });
});
