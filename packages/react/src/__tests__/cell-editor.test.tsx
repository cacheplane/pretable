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
    status: "editing",
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

  it("commits in place (no direction) on blur while editing", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ status: "editing", commit })} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(); // no direction → no focus move
  });

  it("does NOT commit on blur while saving (no double-submit)", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ status: "saving", commit })} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).not.toHaveBeenCalled();
  });

  it("renders the error message with role=alert and marks the input invalid", () => {
    render(
      <CellEditor input={makeInput({ status: "editing", error: "too short" })} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("too short");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("is readOnly and aria-busy while saving", () => {
    render(<CellEditor input={makeInput({ status: "saving" })} />);
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("readonly");
    expect(box).toHaveAttribute("aria-busy", "true");
  });

  it("labels the input from column.header", () => {
    render(
      <CellEditor
        input={makeInput({ column: { id: "name", header: "Full name" } })}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-label",
      "Full name",
    );
  });
});
