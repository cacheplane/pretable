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

function renderGrid(colOver: Partial<PretableColumn<Row>> = {}) {
  const onCellEdit = vi.fn().mockResolvedValue(undefined);
  render(
    <PretableSurface<Row>
      ariaLabel="bools"
      columns={[COLUMNS[0], { ...COLUMNS[1], ...colOver }]}
      rows={ROWS}
      getRowId={(r) => r.id}
      viewportHeight={300}
      onCellEdit={onCellEdit}
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
