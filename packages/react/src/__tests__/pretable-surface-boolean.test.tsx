import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceProps } from "../pretable-surface";
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
    onCellEdit?: PretableSurfaceProps<Row>["onCellEdit"];
    onSelectedRowIdChange?: PretableSurfaceProps<Row>["onSelectedRowIdChange"];
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
    const validate = vi.fn().mockReturnValueOnce("nope").mockReturnValue(true);
    const { onCellEdit } = renderGrid({ validate });
    const box = screen.getAllByRole("checkbox")[0];

    // Failed validate: error is visible, checkbox flagged invalid.
    fireEvent.click(box);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute(
      "aria-errormessage",
      screen.getByRole("alert").id,
    );
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

/**
 * Shared boolean-coercion case table. The twin lives in
 * `packages/grid-core/src/__tests__/evaluate-filter-boolean.test.ts`, where
 * the same values are asserted against the filter engine. Display and
 * filtering coerce cells the same way — a cell holding `1` must both render
 * checked and match the "True" option — and the rule is deliberately
 * duplicated in both packages (grid-core must not depend on @pretable/react),
 * so these two tables must stay identical.
 */
const BOOL_CASES: { label: string; cell: unknown; bool: boolean }[] = [
  { label: "true", cell: true, bool: true },
  { label: '"true"', cell: "true", bool: true },
  { label: "1", cell: 1, bool: true },
  { label: '"1"', cell: "1", bool: true },
  { label: "false", cell: false, bool: false },
  { label: '"false"', cell: "false", bool: false },
  { label: "0", cell: 0, bool: false },
  { label: '"0"', cell: "0", bool: false },
  { label: "empty string", cell: "", bool: false },
  { label: "null", cell: null, bool: false },
  { label: "undefined", cell: undefined, bool: false },
  { label: "arbitrary truthy string", cell: "yes", bool: true },
  { label: "arbitrary object", cell: {}, bool: true },
];

interface LooseRow extends Record<string, unknown> {
  id: string;
  active: unknown;
}

describe("boolean cells — value coercion (shared case table)", () => {
  const rows: LooseRow[] = BOOL_CASES.map(({ cell }, i) => ({
    id: `r${i}`,
    active: cell,
  }));

  it("renders aria-checked from the coerced value, not raw truthiness", () => {
    render(
      <PretableSurface<LooseRow>
        ariaLabel="bools"
        columns={[
          { id: "active", header: "Active", type: "boolean", editable: true },
        ]}
        rows={rows}
        getRowId={(r) => r.id}
        viewportHeight={900}
      />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(BOOL_CASES.length);
    BOOL_CASES.forEach(({ label, bool }, i) => {
      expect(boxes[i], label).toHaveAttribute("aria-checked", String(bool));
    });
  });

  it("toggles from the coerced value, so a string cell flips visibly", async () => {
    const onCellEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <PretableSurface<LooseRow>
        ariaLabel="bools"
        columns={[
          { id: "active", header: "Active", type: "boolean", editable: true },
        ]}
        rows={[
          { id: "r1", active: "false" },
          { id: "r2", active: 1 },
        ]}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onCellEdit={onCellEdit}
      />,
    );
    const boxes = screen.getAllByRole("checkbox");
    // `Boolean("false")` is true, so an uncoerced toggle would commit `false`
    // on an already-unchecked cell — a click with no visible effect.
    fireEvent.click(boxes[0]);
    await flush();
    expect(onCellEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ rowId: "r1", value: true }),
    );
    fireEvent.click(boxes[1]);
    await flush();
    expect(onCellEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ rowId: "r2", value: false }),
    );
  });
});
