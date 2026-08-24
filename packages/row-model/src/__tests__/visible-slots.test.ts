import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import type { PretableRowId } from "../column-types";
import type { RevisionRoot } from "../internal-types";
import { EMPTY_MEMBERSHIP, testMembershipBit } from "../membership-bitset";

interface Row {
  id: string;
  value: number;
}
const helper = createColumnHelper<Row>();

function createModel(
  rows: readonly Row[],
  options?: {
    readonly grouped?: boolean;
    readonly filterGte?: number;
  },
) {
  const columns = [helper.accessor("value", { type: "number" })] as const;
  return createLocalRowModel({
    rows,
    columns,
    getRowId: (row: Row) => row.id,
    query: {
      filters:
        options?.filterGte === undefined
          ? []
          : [
              {
                columnId: "value",
                operator: "gte" as const,
                value: options.filterGte,
              },
            ],
      sort: [],
      rowGroups:
        options?.grouped === true
          ? [{ columnId: "value", direction: "asc" as const }]
          : [],
    },
  });
}

function rootOf(model: object): RevisionRoot<object, PretableRowId, unknown> {
  return getLocalRowModelSlotInternalsForTesting(model).root;
}

/**
 * The Task 6 equivalence oracle, verbatim from the `visibleSlots` doc
 * comment: for a FLAT root, a record's bit is set iff the record is a member
 * of `visible.rows` — the bitset is an index of the same structural verdict,
 * never a divergent copy. The set-bit count over the root's self-described
 * capacity must equal the visible tree's size, so a stale set bit on a
 * record-less (released) slot fails too, not just a wrong bit under a live
 * record.
 */
function expectMembershipOracle(
  root: RevisionRoot<object, PretableRowId, unknown>,
): void {
  for (const [, record] of root.rows.entries()) {
    expect(testMembershipBit(root.visibleSlots, record.slot)).toBe(
      root.visible.rows.get(record.rowId) !== undefined,
    );
  }
  let setBits = 0;
  for (let slot = 0; slot < root.slotCapacity; slot += 1) {
    if (testMembershipBit(root.visibleSlots, slot)) setBits += 1;
  }
  expect(setBits).toBe(root.visible.rows.size);
}

const ROWS: readonly Row[] = Object.freeze([
  { id: "a", value: 1 },
  { id: "b", value: 2 },
  { id: "c", value: 3 },
  { id: "d", value: 4 },
  { id: "e", value: 5 },
  { id: "f", value: 6 },
]);

describe("visibleSlots membership bitset", () => {
  test("flat roots satisfy the equivalence oracle across the scripted sequence", async () => {
    const model = createModel(ROWS, { filterGte: 3 });

    // 1. Initial build with an active filter. The fixture must be able to
    //    disprove: some rows pass (c..f), some do not (a, b).
    const initial = rootOf(model);
    expect(initial.visible.rows.size).toBe(4);
    expect(
      testMembershipBit(initial.visibleSlots, initial.rows.get("d")!.slot),
    ).toBe(true);
    expect(
      testMembershipBit(initial.visibleSlots, initial.rows.get("a")!.slot),
    ).toBe(false);
    expectMembershipOracle(initial);

    // 2. Transaction flipping rows across the filter boundary: `a` enters
    //    (1 -> 10), `d` leaves (4 -> 0).
    expect(
      model.applyTransaction({
        update: [
          { id: "a", changes: { value: 10 } },
          { id: "d", changes: { value: 0 } },
        ],
      }),
    ).toMatchObject({ updated: 2 });
    const flipped = rootOf(model);
    expect(
      testMembershipBit(flipped.visibleSlots, flipped.rows.get("a")!.slot),
    ).toBe(true);
    expect(
      testMembershipBit(flipped.visibleSlots, flipped.rows.get("d")!.slot),
    ).toBe(false);
    expectMembershipOracle(flipped);

    // 3. Remove a VISIBLE row: its bit must clear with the removal, not
    //    linger on the released slot.
    const removedSlot = flipped.rows.get("c")!.slot;
    expect(model.applyTransaction({ remove: ["c"] })).toMatchObject({
      removed: 1,
    });
    const afterRemove = rootOf(model);
    expect(testMembershipBit(afterRemove.visibleSlots, removedSlot)).toBe(
      false,
    );
    expectMembershipOracle(afterRemove);

    // 4. Filter-only setQuery (synchronous rebuild): rows b (2) and e (5)
    //    flip in opposite directions under gte 6.
    const filterTransition = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 6 }],
      sort: [],
      rowGroups: [],
    });
    await filterTransition.finished;
    const refiltered = rootOf(model);
    expect(refiltered.visible.rows.size).toBe(2);
    expectMembershipOracle(refiltered);

    // 5. Sort-only setQuery: the member SET is identical, so the committed
    //    root must CARRY the previous bitset by identity.
    const sortTransition = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 6 }],
      sort: [{ columnId: "value", direction: "desc" }],
      rowGroups: [],
    });
    await sortTransition.finished;
    const resorted = rootOf(model);
    expect(resorted.visibleSlots).toBe(refiltered.visibleSlots);
    expectMembershipOracle(resorted);

    // 6. setRows replacement: retiring rows hand slots to new rows in the
    //    same commit, and the rebuilt bitset must match the rebuilt tree.
    expect(
      model.setRows([
        { id: "a", value: 1 },
        { id: "g", value: 9 },
        { id: "h", value: 2 },
      ]),
    ).toMatchObject({ added: 2 });
    const replaced = rootOf(model);
    expect(replaced.visible.rows.size).toBe(1);
    expectMembershipOracle(replaced);

    // 7. Add transaction (fresh or reused slot) on both sides of the filter.
    expect(
      model.applyTransaction({
        add: [
          { id: "i", value: 100 },
          { id: "j", value: 0 },
        ],
      }),
    ).toMatchObject({ added: 2 });
    expectMembershipOracle(rootOf(model));

    // 8. Filter AND sort change together: the cooperative transition's flat
    //    `finish` construction site.
    const cooperative = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 2 }],
      sort: [{ columnId: "value", direction: "asc" }],
      rowGroups: [],
    });
    await cooperative.finished;
    expectMembershipOracle(rootOf(model));

    model.dispose();
  });

  test("grouped roots carry the EMPTY_MEMBERSHIP sentinel by identity", async () => {
    const model = createModel(ROWS, { grouped: true, filterGte: 3 });
    expect(rootOf(model).visibleSlots).toBe(EMPTY_MEMBERSHIP);

    expect(
      model.applyTransaction({
        update: [{ id: "a", changes: { value: 10 } }],
        remove: ["c"],
        add: [{ id: "g", value: 7 }],
      }),
    ).toMatchObject({ updated: 1, removed: 1, added: 1 });
    expect(rootOf(model).visibleSlots).toBe(EMPTY_MEMBERSHIP);

    expect(
      model.setRows([
        { id: "a", value: 1 },
        { id: "b", value: 2 },
      ]),
    ).toMatchObject({ removed: 4 });
    expect(rootOf(model).visibleSlots).toBe(EMPTY_MEMBERSHIP);
    model.dispose();
  });

  test("a flat model that regroups via setQuery lands on the sentinel, and back", async () => {
    const model = createModel(ROWS, { filterGte: 3 });
    const toGrouped = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 3 }],
      sort: [],
      rowGroups: [{ columnId: "value", direction: "asc" }],
    });
    await toGrouped.finished;
    expect(rootOf(model).visibleSlots).toBe(EMPTY_MEMBERSHIP);

    const toFlat = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 3 }],
      sort: [],
      rowGroups: [],
    });
    await toFlat.finished;
    const flat = rootOf(model);
    expect(flat.visibleSlots).not.toBe(EMPTY_MEMBERSHIP);
    expectMembershipOracle(flat);
    model.dispose();
  });
});
