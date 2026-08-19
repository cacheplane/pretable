import { describe, expect, it, vi } from "vitest";

import type { PretableColumn } from "@pretable/core";

import { createCellEditController } from "../use-cell-edit-controller";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}
const ROWS: Row[] = [{ id: "r1", name: "Ada" }];

function setup(
  columnOverrides: Partial<PretableColumn<Row>> = {},
  onCommit = vi.fn(),
  rows = ROWS,
) {
  const columns: PretableColumn<Row>[] = [
    { id: "name", editable: true, ...columnOverrides },
  ];
  let editing: {
    rowId: string;
    columnId: string;
    draft: unknown;
    status: string;
    error?: string;
  } | null = null;
  const grid = {
    beginEdit(
      addr: { readonly rowId: string; readonly columnId: string },
      edit?: {
        readonly draft?: unknown;
        readonly status?: "checking" | "editing";
        readonly seededFromTyping?: boolean;
      },
    ) {
      editing = {
        ...addr,
        draft: edit?.draft,
        status: edit?.status ?? "editing",
      };
    },
    getSnapshot: () => ({ editing }),
    setEditDraft(draft: unknown) {
      if (editing !== null) editing = { ...editing, draft };
    },
    markEditing() {
      if (editing !== null) editing = { ...editing, status: "editing" };
    },
    markEditValidating() {
      if (editing !== null) editing = { ...editing, status: "validating" };
    },
    markEditSaving() {
      if (editing !== null) editing = { ...editing, status: "saving" };
    },
    markEditInvalid(error: string) {
      if (editing !== null) editing = { ...editing, status: "editing", error };
    },
    markEditError(error: string) {
      if (editing !== null) editing = { ...editing, status: "error", error };
    },
    commitEditSucceeded() {
      editing = null;
    },
    cancelEdit() {
      editing = null;
    },
    moveFocus: vi.fn(),
  };
  const controller = createCellEditController({
    grid,
    getColumns: () => columns,
    getRowById: (id) => rows.find((r) => r.id === id) ?? null,
    onCommit,
  });
  return { grid, controller, onCommit };
}

describe("cell edit controller", () => {
  it("begins an edit immediately when editable === true", async () => {
    const { grid, controller } = setup();
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toMatchObject({
      rowId: "r1",
      status: "editing",
    });
  });

  it("forwards explicit typing provenance and defaults other begins to false", async () => {
    const { grid, controller } = setup();
    const beginEdit = vi.spyOn(grid, "beginEdit");

    await controller.begin({ rowId: "r1", columnId: "name" }, "x", {
      seededFromTyping: true,
    });
    expect(beginEdit).toHaveBeenLastCalledWith(
      { rowId: "r1", columnId: "name" },
      { draft: "x", status: "editing", seededFromTyping: true },
    );

    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(beginEdit).toHaveBeenLastCalledWith(
      { rowId: "r1", columnId: "name" },
      { draft: "Ada", status: "editing", seededFromTyping: false },
    );
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

  it("successful async commit calls onCommit then clears the edit", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({}, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("Ada L.");
    await controller.commit("down");
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "Ada L.",
      }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("commit rejection enters 'error'", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("boom"));
    const { grid, controller } = setup({}, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("rejects a non-numeric draft for a number column via built-in parsing", async () => {
    const onCommit = vi.fn();
    const { grid, controller } = setup({ type: "number" }, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("abc");
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "Not a number",
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits a parsed number (and null for empty) for number columns", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({ type: "number" }, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("42.5");
    await controller.commit("down");
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: 42.5 }),
    );
  });

  it("retains an untouched canonical null date without marking it invalid", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const nullRows = [{ id: "r1", name: null as unknown as string }];
    const { grid, controller } = setup({ type: "date" }, onCommit, nullRows);
    await controller.begin({ rowId: "r1", columnId: "name" });
    await controller.commit();

    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: null }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
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
