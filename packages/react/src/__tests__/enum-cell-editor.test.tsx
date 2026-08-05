import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);

const OPTIONS = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
];

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "status",
    row: { id: "r1", status: "queued" },
    column: {
      id: "status",
      header: "Status",
      type: "enum",
      options: OPTIONS,
    },
    value: "queued",
    status: "editing",
    draft: "Queued",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

describe("EnumCellEditor (via dispatcher)", () => {
  it("renders a combobox with every option listed", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("typing filters the option list", () => {
    const setDraft = vi.fn();
    const { rerender } = render(<CellEditor input={makeInput({ setDraft })} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "run" },
    });
    expect(setDraft).toHaveBeenCalledWith("run");
    rerender(<CellEditor input={makeInput({ setDraft, draft: "run" })} />);
    const shown = screen.getAllByRole("option").map((o) => o.textContent);
    expect(shown).toEqual(["Running"]);
  });

  it("ArrowDown moves the highlight and Enter commits that option's label", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(setDraft).toHaveBeenCalledWith("Running");
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("clicking an option commits it in place", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(setDraft).toHaveBeenCalledWith("Done");
    expect(commit).toHaveBeenCalledWith();
  });

  it("mousedown on the listbox is default-prevented so the input never blurs", () => {
    render(<CellEditor input={makeInput()} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(notPrevented).toBe(false);
  });

  it("blur cancels when the text matches no option", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ draft: "zzz", commit, cancel })} />);
    fireEvent.blur(screen.getByRole("combobox"));
    expect(cancel).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("blur commits when the text matches an option", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ draft: "Done", commit, cancel })} />);
    fireEvent.blur(screen.getByRole("combobox"));
    expect(commit).toHaveBeenCalledWith();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape cancels; Tab commits right", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("re-seeds the field with the option's label when the draft holds the raw value", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ draft: "queued", setDraft })} />);
    expect(setDraft).toHaveBeenCalledWith("Queued");
  });

  it("a type-to-replace seed filters the list immediately", () => {
    // "do" matches no option exactly, so the editor starts filtered. (A seed
    // of "d" would also match "queued" — filterOptions is a substring match
    // over label *and* value.)
    render(<CellEditor input={makeInput({ draft: "do" })} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Done",
    ]);
  });

  it("falls back to the text editor when the column declares no options", () => {
    render(
      <CellEditor
        input={makeInput({
          column: { id: "status", type: "enum" },
        })}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
