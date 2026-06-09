import { describe, expect, it, vi } from "vitest";

import { createGrid, type PretableColumn } from "@pretable/core";

import { createCellEditController } from "../use-cell-edit-controller";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}
const ROWS: Row[] = [{ id: "r1", name: "Ada" }];

function setup(
  columnOverrides: Partial<PretableColumn<Row>> = {},
  onCellEdit = vi.fn(),
) {
  const columns: PretableColumn<Row>[] = [
    { id: "name", editable: true, ...columnOverrides },
  ];
  const grid = createGrid<Row>({ columns, rows: ROWS, getRowId: (r) => r.id });
  const controller = createCellEditController({
    grid,
    getColumns: () => columns,
    getRowById: (id) => ROWS.find((r) => r.id === id) ?? null,
    onCellEdit,
  });
  return { grid, controller, onCellEdit };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("cell edit controller", () => {
  it("begins an edit immediately when editable === true", async () => {
    const { grid, controller } = setup();
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toMatchObject({
      rowId: "r1",
      status: "editing",
    });
  });

  it("gates begin through 'checking' for async editable", async () => {
    let resolve!: (v: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((r) => (resolve = r)),
    });
    const p = controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing?.status).toBe("checking");
    resolve(true);
    await p;
    expect(grid.getSnapshot().editing?.status).toBe("editing");
  });

  it("does not begin when async editable resolves false", async () => {
    const { grid, controller } = setup({
      editable: () => Promise.resolve(false),
    });
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("validate failure returns to editing with the message", async () => {
    const { grid, controller } = setup({ validate: () => "too short" });
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("x");
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "too short",
    });
  });

  it("successful async commit calls onCellEdit then clears the edit", async () => {
    const onCellEdit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({}, onCellEdit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("Ada L.");
    await controller.commit("down");
    expect(onCellEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "Ada L.",
      }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("commit rejection enters 'error'", async () => {
    const onCellEdit = vi.fn().mockRejectedValue(new Error("boom"));
    const { grid, controller } = setup({}, onCellEdit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("drops a stale async-editable resolution after cancel (staleness guard)", async () => {
    let resolve!: (v: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((r) => (resolve = r)),
    });
    const p = controller.begin({ rowId: "r1", columnId: "name" });
    controller.cancel();
    expect(grid.getSnapshot().editing).toBeNull();
    resolve(true);
    await p;
    expect(grid.getSnapshot().editing).toBeNull(); // stale true did not re-open
  });
});
