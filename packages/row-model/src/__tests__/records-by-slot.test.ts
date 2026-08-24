import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import type { PretableRowId } from "../column-types";
import type { RevisionRoot } from "../internal-types";
import { forEachSlotEntry, slotVectorGet } from "../slot-vector";

interface Row {
  id: string;
  value: number;
}
const helper = createColumnHelper<Row>();

function createModel(rows: readonly Row[]) {
  const columns = [helper.accessor("value", { type: "number" })] as const;
  return createLocalRowModel({
    rows,
    columns,
    getRowId: (row: Row) => row.id,
  });
}

function rootOf(model: object): RevisionRoot<object, PretableRowId, unknown> {
  return getLocalRowModelSlotInternalsForTesting(model).root;
}

/**
 * The Task 5 invariant, verbatim from the `recordsBySlot` doc comment:
 * `slotVectorGet(recordsBySlot, record.slot) === record` (IDENTITY) for every
 * record in `rows`, at every committed root — plus live-entry count parity,
 * so the vector holds nothing beyond the root's own rows (no stale binding
 * survives a removal), and every slot stays inside the root's self-described
 * capacity.
 */
function expectSlotInvariant(
  root: RevisionRoot<object, PretableRowId, unknown>,
): void {
  let recordCount = 0;
  for (const [, record] of root.rows.entries()) {
    recordCount += 1;
    expect(slotVectorGet(root.recordsBySlot, record.slot)).toBe(record);
    expect(record.slot).toBeLessThan(root.slotCapacity);
  }
  let liveEntries = 0;
  forEachSlotEntry(root.recordsBySlot, (value, slot) => {
    liveEntries += 1;
    expect(value.slot).toBe(slot);
  });
  expect(liveEntries).toBe(recordCount);
}

const ROWS: readonly Row[] = Object.freeze([
  { id: "a", value: 1 },
  { id: "b", value: 2 },
  { id: "c", value: 3 },
]);

describe("recordsBySlot", () => {
  test("invariant holds across the committed-revision script", async () => {
    const model = createModel(ROWS);

    // 1. Initial build.
    const initial = rootOf(model);
    expect(initial.slotCapacity).toBe(3);
    expectSlotInvariant(initial);

    // 2. Update transaction: the fresh record replaces the old binding.
    expect(
      model.applyTransaction({ update: [{ id: "b", changes: { value: 20 } }] }),
    ).toMatchObject({ updated: 1 });
    expectSlotInvariant(rootOf(model));

    // 3. Remove + add across two commits, reusing the released slot — with
    //    the held-snapshot pin: the root captured BEFORE the removal must
    //    keep binding the reused slot to the OLD record afterwards.
    const held = rootOf(model);
    const oldB = held.rows.get("b")!;
    expect(model.applyTransaction({ remove: ["b"] })).toMatchObject({
      removed: 1,
    });
    expectSlotInvariant(rootOf(model));
    expect(
      model.applyTransaction({ add: [{ id: "d", value: 4 }] }),
    ).toMatchObject({ added: 1 });
    const afterAdd = rootOf(model);
    // Control: the add genuinely reused b's released slot — without this the
    // held-snapshot pin below could pass vacuously.
    expect(afterAdd.rows.get("d")!.slot).toBe(oldB.slot);
    expectSlotInvariant(afterAdd);
    expect(slotVectorGet(held.recordsBySlot, oldB.slot)).toBe(oldB);
    expectSlotInvariant(held);

    // 4. setRows replacement. Rows before: a, c, d. Two retire (a, d), two
    //    ingest (e, f) — the transfer pool hands the retiring slots straight
    //    to the new rows, so a clear and a write land on the SAME slot in
    //    one commit and capacity does not grow.
    expect(
      model.setRows([
        { id: "c", value: 30 },
        { id: "e", value: 5 },
        { id: "f", value: 6 },
      ]),
    ).toMatchObject({ updated: 1, added: 2, removed: 2 });
    const replaced = rootOf(model);
    expect(replaced.slotCapacity).toBe(3);
    expectSlotInvariant(replaced);

    // 5. Filter-only setQuery (synchronous fast path). `rows` is the FULL
    //    set — filtering must not disturb a single slot binding.
    const filterTransition = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 6 }],
      sort: [],
      rowGroups: [],
    });
    await filterTransition.finished;
    expectSlotInvariant(rootOf(model));

    // 6. Sort-only setQuery (synchronous fast path).
    const sortTransition = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 6 }],
      sort: [{ columnId: "value", direction: "desc" }],
      rowGroups: [],
    });
    await sortTransition.finished;
    expectSlotInvariant(rootOf(model));

    model.dispose();
  });

  test("cooperative transition: the finished root carries the vector, including a mid-transition delta that grew the slot space", async () => {
    const model = createModel(ROWS);
    // Filter AND sort change together: no synchronous fast path, so this is
    // the cooperative-transition `finish` construction site.
    const transition = model.setQuery({
      filters: [{ columnId: "value", operator: "gte", value: 2 }],
      sort: [{ columnId: "value", direction: "desc" }],
      rowGroups: [],
    });
    // A commit during the transition becomes a replayed delta whose target
    // root allocated a slot BEYOND the captured root's capacity.
    expect(
      model.applyTransaction({ add: [{ id: "d", value: 9 }] }),
    ).toMatchObject({ added: 1 });
    expectSlotInvariant(rootOf(model));
    await transition.finished;
    const finished = rootOf(model);
    expect(finished.rows.get("d")).toBeDefined();
    // The finished root's domain must come from the delta TARGET's
    // self-described capacity, never the captured root's smaller one.
    expect(finished.slotCapacity).toBe(4);
    expectSlotInvariant(finished);
    model.dispose();
  });
});
