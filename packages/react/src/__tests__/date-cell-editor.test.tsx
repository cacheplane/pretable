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
    columnId: "due",
    row: { id: "r1", due: "2026-08-06" },
    column: { id: "due", header: "Due", type: "date" },
    value: "2026-08-06",
    status: "editing",
    draft: "2026-08-06",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

const activeDay = () =>
  screen.getByRole("textbox").getAttribute("aria-activedescendant");
const dayCell = (iso: string) =>
  screen.getByRole("gridcell", { name: new RegExp(`^${iso}$`) });

describe("DateCellEditor (via dispatcher)", () => {
  it("renders a month grid for the drafted date, marking the selection", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(dayCell("2026-08-06")).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowRight moves the active day by one, ArrowDown by a week", () => {
    render(<CellEditor input={makeInput()} />);
    const box = screen.getByRole("textbox");
    const start = activeDay();
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(activeDay()).not.toBe(start);
    expect(activeDay()).toBe(dayCell("2026-08-07").id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(activeDay()).toBe(dayCell("2026-08-14").id);
  });

  it("PageDown moves to the next month", () => {
    render(<CellEditor input={makeInput()} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "PageDown" });
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("Enter commits the active day and moves down", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(setDraft).toHaveBeenCalledWith("2026-08-07");
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("clicking a day commits it in place", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(dayCell("2026-08-20"));
    expect(setDraft).toHaveBeenCalledWith("2026-08-20");
    expect(commit).toHaveBeenCalledWith();
  });

  it("typing a valid ISO date retargets the calendar", () => {
    render(<CellEditor input={makeInput()} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "2026-12-25" },
    });
    expect(screen.getByText("December 2026")).toBeInTheDocument();
    expect(dayCell("2026-12-25")).toHaveAttribute("aria-selected", "true");
  });

  it("Enter falls through to the parser when the typed text is not a date", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(
      <CellEditor input={makeInput({ draft: "nope", setDraft, commit })} />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // The calendar's day is NOT substituted for what the user typed.
    expect(setDraft).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("mousedown on the popover is default-prevented so the input never blurs", () => {
    render(<CellEditor input={makeInput()} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("grid"));
    expect(notPrevented).toBe(false);
  });

  it("blur commits a valid date and reverts an invalid one", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).toHaveBeenCalledWith();
    cleanup();

    const commit2 = vi.fn();
    const cancel2 = vi.fn();
    render(
      <CellEditor
        input={makeInput({ draft: "nope", commit: commit2, cancel: cancel2 })}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(cancel2).toHaveBeenCalled();
    expect(commit2).not.toHaveBeenCalled();
  });

  it("Escape cancels; Tab commits right", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("re-seeds the field as ISO when the cell holds a Date instance", () => {
    const setDraft = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: new Date(Date.UTC(2026, 7, 6)),
          value: new Date(Date.UTC(2026, 7, 6)),
          setDraft,
        })}
      />,
    );
    expect(setDraft).toHaveBeenCalledWith("2026-08-06");
  });
});
