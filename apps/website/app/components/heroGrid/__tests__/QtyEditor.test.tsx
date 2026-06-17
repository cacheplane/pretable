// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QtyEditor } from "../QtyEditor";

function makeInput(over: Record<string, unknown> = {}) {
  return {
    draft: "12500",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    status: "editing",
    error: undefined,
    row: {},
    column: {},
    value: 12500,
    ...over,
  } as never;
}

describe("QtyEditor", () => {
  it("renders the draft in an input and pushes edits via setDraft", () => {
    const input = makeInput();
    render(<QtyEditor input={input} />);
    const el = screen.getByRole("textbox");
    fireEvent.change(el, { target: { value: "14000" } });
    expect(
      (input as { setDraft: ReturnType<typeof vi.fn> }).setDraft,
    ).toHaveBeenCalledWith("14000");
  });
  it("shows the compliance popover while validating", () => {
    render(<QtyEditor input={makeInput({ status: "validating" })} />);
    expect(screen.getByText(/compliance check/i)).toBeInTheDocument();
  });
  it("shows the submitting popover while saving", () => {
    render(<QtyEditor input={makeInput({ status: "saving" })} />);
    expect(screen.getByText(/submitting order/i)).toBeInTheDocument();
  });
  it("shows the error message popover on rejection", () => {
    render(
      <QtyEditor
        input={makeInput({
          status: "error",
          error: "Rejected by trading desk",
        })}
      />,
    );
    expect(screen.getByText(/trading desk/i)).toBeInTheDocument();
  });
  it("commits on Enter and cancels on Escape", () => {
    const input = makeInput();
    render(<QtyEditor input={input} />);
    const el = screen.getByRole("textbox");
    fireEvent.keyDown(el, { key: "Enter" });
    expect(
      (input as { commit: ReturnType<typeof vi.fn> }).commit,
    ).toHaveBeenCalledWith("down");
    fireEvent.keyDown(el, { key: "Escape" });
    expect(
      (input as { cancel: ReturnType<typeof vi.fn> }).cancel,
    ).toHaveBeenCalled();
  });
});
