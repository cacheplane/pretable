import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";

interface Row {
  id: string;
  value: number;
}
const helper = createColumnHelper<Row>();

function createModel(
  rows: readonly Row[],
  options?: { readonly grouped?: boolean },
) {
  const columns = [helper.accessor("value", { type: "number" })] as const;
  const model = createLocalRowModel({
    rows,
    columns,
    getRowId: (row: Row) => row.id,
    ...(options?.grouped === true
      ? {
          query: {
            filters: [],
            sort: [],
            rowGroups: [{ columnId: "value", direction: "asc" as const }],
          },
        }
      : {}),
  });
  return { model, ...getLocalRowModelSlotInternalsForTesting(model) };
}

function slotOf(
  internals: ReturnType<typeof getLocalRowModelSlotInternalsForTesting>,
  rowId: string,
): number {
  const record = internals.root.rows.get(rowId);
  if (record === undefined) throw new Error(`Missing row ${rowId}.`);
  return record.slot;
}

const ROWS: readonly Row[] = Object.freeze([
  { id: "a", value: 1 },
  { id: "b", value: 2 },
  { id: "c", value: 3 },
]);

describe("slot lifecycle", () => {
  test("slots are dense from zero at initial build", () => {
    const { model, root, slots } = createModel(ROWS);
    expect(slotOf({ root, slots }, "a")).toBe(0);
    expect(slotOf({ root, slots }, "b")).toBe(1);
    expect(slotOf({ root, slots }, "c")).toBe(2);
    expect(slots.capacity).toBe(3);
    model.dispose();
  });

  test("update carries the slot", () => {
    const { model, slots } = createModel(ROWS);
    const before = getLocalRowModelSlotInternalsForTesting(model).root;
    const previousA = before.rows.get("a");
    const previousB = before.rows.get("b");
    const previousC = before.rows.get("c");

    expect(
      model.applyTransaction({ update: [{ id: "b", changes: { value: 99 } }] }),
    ).toMatchObject({ updated: 1 });

    const after = getLocalRowModelSlotInternalsForTesting(model).root;
    const nextB = after.rows.get("b");
    expect(nextB).not.toBe(previousB);
    expect(nextB?.slot).toBe(previousB?.slot);
    expect(nextB?.slot).toBe(1);
    // Untouched rows keep record identity (and therefore their slots).
    expect(after.rows.get("a")).toBe(previousA);
    expect(after.rows.get("c")).toBe(previousC);
    expect(slots.capacity).toBe(3);
    model.dispose();
  });

  test("remove releases; a later add reuses", () => {
    const { model, slots } = createModel(ROWS);
    expect(model.applyTransaction({ remove: ["b"] })).toMatchObject({
      removed: 1,
    });
    expect(
      model.applyTransaction({ add: [{ id: "d", value: 4 }] }),
    ).toMatchObject({ added: 1 });

    const after = getLocalRowModelSlotInternalsForTesting(model).root;
    expect(after.rows.get("d")?.slot).toBe(1);
    expect(slots.capacity).toBe(3);
    model.dispose();
  });

  test("remove releases; a later add reuses (grouped root)", () => {
    const { model, slots } = createModel(ROWS, { grouped: true });
    expect(model.applyTransaction({ remove: ["b"] })).toMatchObject({
      removed: 1,
    });
    expect(
      model.applyTransaction({ add: [{ id: "d", value: 4 }] }),
    ).toMatchObject({ added: 1 });

    const after = getLocalRowModelSlotInternalsForTesting(model).root;
    expect(after.rows.get("d")?.slot).toBe(1);
    expect(slots.capacity).toBe(3);
    model.dispose();
  });

  test("set-rows replacement carries intersecting ids", () => {
    const { model, slots } = createModel(ROWS);
    expect(
      model.setRows([
        { id: "b", value: 20 },
        { id: "e", value: 5 },
      ]),
    ).toMatchObject({ updated: 1, added: 1, removed: 2 });

    const after = getLocalRowModelSlotInternalsForTesting(model).root;
    expect(after.rows.get("b")?.slot).toBe(1);
    // E takes one of the slots the dropped rows (a=0, c=2) gave back.
    expect([0, 2]).toContain(after.rows.get("e")?.slot);
    expect(slots.capacity).toBe(3);
    model.dispose();
  });

  test("abandoned draft leaks nothing", () => {
    const { model, slots } = createModel([{ id: "a", value: 1 }]);
    expect(slots.capacity).toBe(1);
    // Entirely ineffective: the only entry is an unknown remove id.
    expect(model.applyTransaction({ remove: ["missing"] })).toMatchObject({
      removed: 0,
      ignored: 1,
    });
    expect(
      model.applyTransaction({ add: [{ id: "b", value: 2 }] }),
    ).toMatchObject({ added: 1 });

    const after = getLocalRowModelSlotInternalsForTesting(model).root;
    // No gap: capacity grew by exactly the rows actually added since build.
    expect(after.rows.get("b")?.slot).toBe(1);
    expect(slots.capacity).toBe(2);
    model.dispose();
  });
});
