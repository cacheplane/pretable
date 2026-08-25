import { describe, expect, test } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  createLocalRowModel,
} from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import { buildRowStore } from "../row-store";
import { createSlotAllocator } from "../slot-allocator";

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

  test("buildRowStore direct: a rebuild carries surviving slots and releases dropped ones", () => {
    // The only production call site (create-local-row-model.ts) never passes
    // `previous`; this pins the carry/release branch directly so it isn't
    // dead-but-untested.
    const columns = [helper.accessor("value", { type: "number" })] as const;
    type Columns = typeof columns;
    const queryPlan = compileQuery<Columns>({
      derivations: columns,
      query: { filters: [], sort: [], rowGroups: [] },
    });
    const slots = createSlotAllocator();
    const getRowId = (row: Row) => row.id;

    const first = buildRowStore<Row, string, Columns>({
      rows: ROWS, // a, b, c
      getRowId,
      queryPlan,
      slots,
    });
    expect(slots.capacity).toBe(3);
    const aSlot = first.rows.get("a")!.slot;
    const bSlot = first.rows.get("b")!.slot;
    const cSlot = first.rows.get("c")!.slot;

    const second = buildRowStore<Row, string, Columns>({
      rows: [
        { id: "b", value: 20 },
        { id: "d", value: 4 },
      ],
      getRowId,
      queryPlan,
      previous: first.rows,
      slots,
    });

    // B carried its original slot (carry branch).
    expect(second.rows.get("b")!.slot).toBe(bSlot);
    // D draws its slot from the allocator BEFORE this build releases the
    // dropped rows' slots (the build loop allocates for new rows, then only
    // afterward releases the previous rows that didn't survive) — so D gets
    // a brand-new slot, not a reused one, and capacity grows by one.
    expect([aSlot, bSlot, cSlot]).not.toContain(second.rows.get("d")!.slot);
    expect(slots.capacity).toBe(4);

    // A and C's slots are nonetheless genuinely released (the release
    // branch ran): the next allocation reuses one of them instead of
    // drawing a fifth slot.
    const reused = slots.allocate();
    expect([aSlot, cSlot]).toContain(reused);
    expect(slots.capacity).toBe(4);
  });

  test("a throwing accessor mid-setRows releases its provisional slot; nothing leaks", () => {
    // A second candidate row's metadata evaluation throws after an earlier
    // candidate in the same draft has already drawn a fresh slot. The draft
    // must release that fresh slot on the way out, or it is stranded forever
    // (still marked live, never reachable again) even though the setRows
    // call it belonged to never committed.
    const columns = [
      helper.accessor(
        "value",
        (row: Row) => {
          if (row.value === -1) throw new Error("poisoned accessor");
          return row.value;
        },
        { type: "number" },
      ),
    ] as const;
    const model = createLocalRowModel({
      rows: ROWS,
      columns,
      getRowId: (row: Row) => row.id,
      // Sorting by "value" makes the column active, so `evaluate` actually
      // calls the accessor. An inactive column (referenced by no filter,
      // sort, group, or aggregate) is never read, and the accessor would
      // never run at all.
      query: {
        filters: [],
        sort: [{ columnId: "value", direction: "asc" as const }],
        rowGroups: [],
      },
    });
    const { slots } = getLocalRowModelSlotInternalsForTesting(model);
    expect(slots.capacity).toBe(3);

    // "ok" draws a fresh slot (3) before "poison" throws during evaluation.
    // A throwing accessor surfaces by propagating out of the mutation call
    // (setRows rethrows; it does not downgrade the failure into an issue).
    expect(() =>
      model.setRows([
        ...ROWS,
        { id: "ok", value: 4 },
        { id: "poison", value: -1 },
      ]),
    ).toThrow();
    // The high-water mark reflects the provisional allocation; it never
    // shrinks. What matters is whether that slot made it back onto the free
    // list, which the next assertion checks indirectly.
    expect(slots.capacity).toBe(4);

    // A genuinely new, successful add should reuse the released slot rather
    // than drawing a fifth one. Net growth across the whole sequence is
    // exactly one (3 -> 4), proving the poisoned draft leaked nothing.
    expect(
      model.applyTransaction({ add: [{ id: "e", value: 5 }] }),
    ).toMatchObject({ added: 1 });
    const after = getLocalRowModelSlotInternalsForTesting(model).root;
    expect(after.rows.get("e")?.slot).toBe(3);
    expect(slots.capacity).toBe(4);
    model.dispose();
  });
});
