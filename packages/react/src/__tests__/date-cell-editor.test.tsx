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

  it("Enter on an empty field commits null instead of the calendar's day", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ draft: "", setDraft, commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // No substitution: the empty draft reaches parseDraftForType, which maps
    // it to null.
    expect(setDraft).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("leaves a type-to-replace seed alone instead of rewriting it to a date", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ draft: "2", setDraft })} />);
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("2");
  });

  it("keeps aria-activedescendant resolvable when PageDown clamps the day", () => {
    render(
      <CellEditor
        input={makeInput({ draft: "2026-08-31", value: "2026-08-31" })}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "PageDown" });
    // September has 30 days, so the cursor clamps — and the clamped day is
    // still a rendered cell, so the id always resolves.
    expect(activeDay()).toBe(dayCell("2026-09-30").id);
    expect(document.getElementById(activeDay() as string)).not.toBeNull();
  });

  it("ignores calendar navigation while an edit is in flight", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ status: "saving", setDraft })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
  });

  it("mousedown on the popover is default-prevented so the input never blurs", () => {
    render(<CellEditor input={makeInput()} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("grid"));
    expect(notPrevented).toBe(false);
  });

  it("blur commits an untouched canonical date and cancels an invalid seed", () => {
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

  it("commits an untouched canonical null but cancels an untouched empty string", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(
      <CellEditor
        input={makeInput({ draft: null, value: null, commit, cancel })}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).toHaveBeenCalledWith();
    expect(cancel).not.toHaveBeenCalled();
    cleanup();

    const emptyCommit = vi.fn();
    const emptyCancel = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: "",
          value: "",
          commit: emptyCommit,
          cancel: emptyCancel,
        })}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(emptyCancel).toHaveBeenCalledWith();
    expect(emptyCommit).not.toHaveBeenCalled();
  });

  it.each([
    ["Date", new Date("2026-08-06T00:00:00Z")],
    ["epoch", Date.UTC(2026, 7, 6)],
    ["datetime", "2026-08-06T00:00:00Z"],
    ["padded", " 2026-08-06 "],
    ["empty", ""],
    ["whitespace", "   "],
    ["undefined", undefined],
  ])(
    "keeps an untouched raw %s seed visible and cancels without mutation",
    (_label, draft) => {
      const setDraft = vi.fn();
      const commit = vi.fn();
      const cancel = vi.fn();
      render(
        <CellEditor
          input={makeInput({ draft, value: draft, setDraft, commit, cancel })}
        />,
      );
      expect(screen.getByRole("textbox")).toHaveValue(String(draft ?? ""));
      expect(setDraft).not.toHaveBeenCalled();
      fireEvent.blur(screen.getByRole("textbox"));
      expect(cancel).toHaveBeenCalledWith();
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it("runs a custom parser path on blur only after a real user change", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const parseEditValue = vi.fn((draft: string) => draft);
    const input = makeInput({
      draft: "legacy",
      value: "legacy",
      column: {
        id: "due",
        type: "date",
        editable: true,
        parseEditValue,
      },
      commit,
      cancel,
    });
    const view = render(<CellEditor input={input} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();

    view.rerender(<CellEditor input={input} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "legacy changed" },
    });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).toHaveBeenCalledWith();
  });

  it("treats a type-to-replace seed as a user change for custom parser blur", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: "x",
          seededFromTyping: true,
          column: {
            id: "due",
            type: "date",
            editable: true,
            parseEditValue: (draft) => `parsed:${draft}`,
          },
          commit,
          cancel,
        })}
      />,
    );

    fireEvent.blur(screen.getByRole("textbox"));

    expect(commit).toHaveBeenCalledWith();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("still cancels an incomplete built-in type-to-replace seed on blur", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: "2",
          seededFromTyping: true,
          commit,
          cancel,
        })}
      />,
    );

    fireEvent.blur(screen.getByRole("textbox"));

    expect(cancel).toHaveBeenCalledWith();
    expect(commit).not.toHaveBeenCalled();
  });

  it("synchronizes the calendar and selection to a controlled canonical rerender", () => {
    const input = makeInput();
    const view = render(<CellEditor input={input} />);
    view.rerender(
      <CellEditor
        input={{ ...input, draft: "9999-12-31", value: "9999-12-31" }}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("9999-12-31");
    expect(screen.getByText("December 9999")).toBeInTheDocument();
    expect(dayCell("9999-12-31")).toHaveAttribute("aria-selected", "true");
    expect(activeDay()).toBe(dayCell("9999-12-31").id);
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });

  it("clears selection for a controlled invalid rerender without replacing its useful cursor", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    const input = makeInput({ setDraft, commit });
    const view = render(<CellEditor input={input} />);
    view.rerender(<CellEditor input={{ ...input, draft: "not-a-date" }} />);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(dayCell("2026-08-06")).not.toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(setDraft).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("marks arrow and page navigation as modified so blur commits it", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.blur(box);
    expect(setDraft).toHaveBeenLastCalledWith("2026-08-07");
    expect(commit).toHaveBeenCalledWith();
  });

  it("clamps navigation and buttons at the supported boundaries", () => {
    const minSetDraft = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: "0000-01-01",
          value: "0000-01-01",
          setDraft: minSetDraft,
        })}
      />,
    );
    const minBox = screen.getByRole("textbox");
    expect(
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    fireEvent.keyDown(minBox, { key: "ArrowLeft" });
    fireEvent.keyDown(minBox, { key: "PageUp" });
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(minSetDraft).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("gridcell")
        .filter((cell) => cell.hasAttribute("aria-disabled")),
    ).not.toHaveLength(0);
    cleanup();

    const maxSetDraft = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          draft: "9999-12-31",
          value: "9999-12-31",
          setDraft: maxSetDraft,
        })}
      />,
    );
    const maxBox = screen.getByRole("textbox");
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    fireEvent.keyDown(maxBox, { key: "ArrowRight" });
    fireEvent.keyDown(maxBox, { key: "PageDown" });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(maxSetDraft).not.toHaveBeenCalled();
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

  it("does not re-seed the field when the cell holds a Date instance", () => {
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
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue(
      String(new Date(Date.UTC(2026, 7, 6))),
    );
  });
});
