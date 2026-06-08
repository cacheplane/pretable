import { describe, expect, it } from "vitest";

import { createGridCore } from "../create-grid-core";

const COLUMNS = [{ id: "name" }, { id: "age" }];
const ROWS = [
  { id: "r1", name: "Ada", age: 36 },
  { id: "r2", name: "Linus", age: 54 },
];

function makeGrid() {
  return createGridCore({
    columns: COLUMNS,
    rows: ROWS,
    getRowId: (r) => r.id,
  });
}

describe("edit lifecycle", () => {
  it("starts with no edit", () => {
    expect(makeGrid().getSnapshot().editing).toBeNull();
  });

  it("beginEdit defaults to status 'editing' with the given draft", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "name" }, { draft: "Ad" });
    expect(g.getSnapshot().editing).toEqual({
      rowId: "r1",
      columnId: "name",
      draft: "Ad",
      status: "editing",
    });
  });

  it("supports the async-editable 'checking' → 'editing' path", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "name" }, { status: "checking" });
    expect(g.getSnapshot().editing?.status).toBe("checking");
    g.markEditing();
    expect(g.getSnapshot().editing?.status).toBe("editing");
  });

  it("runs validating → saving → success, clearing the edit", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "name" }, { draft: "Ada Lovelace" });
    g.setEditDraft("Ada L.");
    g.markEditValidating();
    expect(g.getSnapshot().editing?.status).toBe("validating");
    g.markEditSaving();
    expect(g.getSnapshot().editing?.status).toBe("saving");
    g.commitEditSucceeded();
    expect(g.getSnapshot().editing).toBeNull();
  });

  it("markEditInvalid returns to 'editing' with a message", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "age" });
    g.markEditValidating();
    g.markEditInvalid("must be a number");
    expect(g.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "must be a number",
    });
  });

  it("markEditError enters 'error' with a message; cancelEdit clears it", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "age" });
    g.markEditSaving();
    g.markEditError("network down");
    expect(g.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "network down",
    });
    g.cancelEdit();
    expect(g.getSnapshot().editing).toBeNull();
  });

  it("transition methods no-op when there is no active edit (stale-callback safety)", () => {
    const g = makeGrid();
    g.markEditSaving();
    g.commitEditSucceeded();
    expect(g.getSnapshot().editing).toBeNull();
  });

  it("notifies subscribers on edit transitions", () => {
    const g = makeGrid();
    let calls = 0;
    g.subscribe(() => {
      calls += 1;
    });
    g.beginEdit({ rowId: "r1", columnId: "name" });
    g.setEditDraft("x");
    g.commitEditSucceeded();
    expect(calls).toBe(3);
  });
});
