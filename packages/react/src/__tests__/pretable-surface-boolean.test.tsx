import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  active: boolean;
}
const ROWS: Row[] = [
  { id: "r1", name: "Ada", active: true },
  { id: "r2", name: "Linus", active: false },
];
const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "active", header: "Active", type: "boolean", editable: true },
];

function renderGrid(
  colOver: Partial<PretableColumn<Row>> = {},
  opts: {
    onCellEdit?: ReturnType<typeof vi.fn>;
    onSelectedRowIdChange?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onCellEdit = opts.onCellEdit ?? vi.fn().mockResolvedValue(undefined);
  render(
    <PretableSurface<Row>
      ariaLabel="bools"
      columns={[COLUMNS[0], { ...COLUMNS[1], ...colOver }]}
      rows={ROWS}
      getRowId={(r) => r.id}
      viewportHeight={300}
      onCellEdit={onCellEdit}
      onSelectedRowIdChange={opts.onSelectedRowIdChange}
    />,
  );
  return { onCellEdit };
}

describe("PretableSurface boolean columns", () => {
  it("renders boolean cells as checkboxes reflecting the value", () => {
    renderGrid();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toHaveAttribute("aria-checked", "true");
    expect(boxes[1]).toHaveAttribute("aria-checked", "false");
  });

  it("click toggles and commits the negated value through onCellEdit", async () => {
    const { onCellEdit } = renderGrid();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await flush();
    expect(onCellEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "active",
        value: false,
      }),
    );
  });

  it("does not toggle when the column is not editable", async () => {
    const { onCellEdit } = renderGrid({ editable: false });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await flush();
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("shows the validate error, cancels on Escape, and recovers", async () => {
    const validate = vi
      .fn()
      .mockReturnValueOnce("nope")
      .mockReturnValue(true);
    const { onCellEdit } = renderGrid({ validate });
    const box = screen.getAllByRole("checkbox")[0];

    // Failed validate: error is visible, checkbox flagged invalid.
    fireEvent.click(box);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(onCellEdit).not.toHaveBeenCalled();

    // Escape cancels the failed edit — alert gone.
    const cell = box.closest('[role="gridcell"]')!;
    fireEvent.keyDown(cell, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // A fresh toggle goes through (validate passes now).
    fireEvent.click(box);
    await flush();
    expect(onCellEdit).toHaveBeenCalledTimes(1);
  });

  it("shows the onCellEdit error and click retries (cancel-and-retry)", async () => {
    const onCellEdit = vi
      .fn()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValue(undefined);
    renderGrid({}, { onCellEdit });
    const box = screen.getAllByRole("checkbox")[0];

    fireEvent.click(box);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    expect(onCellEdit).toHaveBeenCalledTimes(1);

    // Second click cancels the failed edit and retries the toggle.
    fireEvent.click(box);
    await flush();
    expect(onCellEdit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ArrowRight on a focused editable boolean cell does not begin an edit", async () => {
    const { onCellEdit } = renderGrid();
    const cell = screen
      .getAllByRole("checkbox")[0]
      .closest('[role="gridcell"]')!;
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "ArrowRight" });
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("typing a printable character does not begin an edit", async () => {
    const { onCellEdit } = renderGrid();
    const cell = screen
      .getAllByRole("checkbox")[0]
      .closest('[role="gridcell"]')!;
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "x" });
    await flush();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("double-click causes at most one commit", async () => {
    const { onCellEdit } = renderGrid();
    const box = screen.getAllByRole("checkbox")[0];
    fireEvent.click(box);
    fireEvent.click(box);
    await flush();
    expect(onCellEdit).toHaveBeenCalledTimes(1);
  });

  it("non-editable boolean column: Enter still drives row-selection", async () => {
    const onSelectedRowIdChange = vi.fn();
    renderGrid({ editable: false }, { onSelectedRowIdChange });
    const cell = screen
      .getAllByRole("checkbox")[0]
      .closest('[role="gridcell"]')!;
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    await flush();
    expect(onSelectedRowIdChange).toHaveBeenCalledWith("r1");
  });

  it("never opens a text editor popover for boolean columns", () => {
    renderGrid();
    const cell = screen
      .getAllByRole("checkbox")[0]
      .closest('[role="gridcell"]')!;
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
