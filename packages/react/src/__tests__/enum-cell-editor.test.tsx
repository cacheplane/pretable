import { enumChoice } from "../editors/enum-draft";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableOverlayProvider } from "../overlay/portal-context";
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
  it("renders a combobox with every option listed, in the dialog width", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    // The editor asks the kit list for `width="dialog"`: the cell editors'
    // fixed 240px column, so the list lines up with the field it drops from.
    expect(screen.getByRole("listbox").style.width).toBe("240px");
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

  it("ArrowDown moves the highlight and Enter commits that option's canonical identity", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(setDraft).toHaveBeenCalledWith(enumChoice("running"));
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("Home stays on the text caret rather than jumping the highlight", () => {
    // The APG editable-combobox pattern: this trigger is a text field, so
    // Home/End move the caret. Only the arrows reach the kit's keyboard.
    render(<CellEditor input={makeInput()} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const before = box.getAttribute("aria-activedescendant");
    const notPrevented = fireEvent.keyDown(box, { key: "Home" });
    expect(notPrevented).toBe(true);
    expect(box.getAttribute("aria-activedescendant")).toBe(before);
  });

  it("clicking an option commits it in place", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(setDraft).toHaveBeenCalledWith(enumChoice("done"));
    expect(commit).toHaveBeenCalledWith();
  });

  it("mousedown on the listbox is default-prevented so the input never blurs", () => {
    render(<CellEditor input={makeInput()} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(notPrevented).toBe(false);
  });

  it("blur submits unmatched text to the parser for a recoverable error", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ draft: "zzz", commit, cancel })} />);
    fireEvent.blur(screen.getByRole("combobox"));
    expect(cancel).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith();
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

  it("displays the option label without rewriting its canonical draft", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ draft: "queued", setDraft })} />);
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveValue("Queued");
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

  it("a type-to-replace seed remains raw until explicitly navigated", () => {
    // The seeded highlight is an index into the *full* option list (here
    // "done" = 2), but the list starts filtered — so it must clamp to the
    // filtered list or a bare Enter would commit the raw seed text.
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(
      <CellEditor
        input={makeInput({ draft: "r", value: "done", setDraft, commit })}
      />,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(setDraft).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("ArrowDown steps from the clamped highlight, not the raw seed", () => {
    // The seeded highlight is an index into the *full* list ("cancelled" = 4),
    // but the seed "n" renders the list already filtered to three — so the
    // render clamps to Running. The arrow arithmetic has to start from that
    // same clamped value, or the first press skips a row: (4 + 1) % 3 = 2
    // lands on Cancelled instead of Done.
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          column: {
            id: "status",
            header: "Status",
            type: "enum",
            options: [
              { value: "queued", label: "Queued" },
              { value: "running", label: "Running" },
              { value: "done", label: "Done" },
              { value: "blocked", label: "Blocked" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          value: "cancelled",
          draft: "n",
          setDraft,
          commit,
        })}
      />,
    );
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Running",
      "Done",
      "Cancelled",
    ]);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(setDraft).toHaveBeenCalledWith(enumChoice("done"));
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("Enter on text matching no option falls through to the shared chrome", () => {
    // Strict rejection is parseDraftForType's job; the editor just must not
    // swallow the key when there is nothing highlighted to choose.
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ draft: "zzz", commit })} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("down");
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

it("waits for its provider target before publishing popup ARIA references", () => {
  const input = makeInput();
  const target = document.createElement("div");
  document.body.append(target);
  const content = <CellEditor input={input} />;
  const view = render(
    <PretableOverlayProvider container={null}>
      {content}
    </PretableOverlayProvider>,
  );
  const field = view.getByRole("combobox");
  expect(field).not.toHaveAttribute("aria-controls");
  expect(field).not.toHaveAttribute("aria-activedescendant");
  view.rerender(
    <PretableOverlayProvider container={target}>
      {content}
    </PretableOverlayProvider>,
  );
  expect(
    document.getElementById(field.getAttribute("aria-controls")!),
  ).not.toBeNull();
  expect(
    document.getElementById(field.getAttribute("aria-activedescendant")!),
  ).not.toBeNull();
  view.rerender(
    <PretableOverlayProvider container={null}>
      {content}
    </PretableOverlayProvider>,
  );
  expect(field).not.toHaveAttribute("aria-controls");
  expect(field).not.toHaveAttribute("aria-activedescendant");
  view.unmount();
  target.remove();
});
