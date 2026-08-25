import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableQueryFor,
} from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import { createInstrumentedLocalRowModel } from "../diagnostics";

interface Row {
  id: string;
  value: number;
}

const helper = createColumnHelper<Row>();

function createColumns() {
  return [helper.accessor("value", { type: "number" })] as const;
}

type Columns = ReturnType<typeof createColumns>;

function createModel(
  rows: readonly Row[],
  options?: { readonly grouped?: boolean },
) {
  const model = createLocalRowModel({
    rows,
    columns: createColumns(),
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
  return model;
}

function valueAtLeast(value: number): PretableQueryFor<Columns> {
  return {
    filters: [{ columnId: "value", operator: "gte", value }],
    sort: [],
    rowGroups: [],
  };
}

const ROWS: readonly Row[] = Object.freeze([
  { id: "a", value: 1 },
  { id: "b", value: 2 },
  { id: "c", value: 3 },
  { id: "d", value: 4 },
  { id: "e", value: 5 },
]);

/**
 * Asserts index-for-index alignment between `ɵvisibleSlotRange` and the
 * slots of the records `rowAt` resolves, via the committed-root seam. This
 * is what makes the range read non-vacuous: the expected slot comes from the
 * root's row store, not from the read under test.
 */
function expectSlotAlignment(model: ReturnType<typeof createModel>): void {
  const snapshot = model.getState().snapshot;
  const { root } = getLocalRowModelSlotInternalsForTesting(model);
  const slots = snapshot.ɵvisibleSlotRange?.(0, snapshot.visibleRowCount);
  expect(slots).toBeDefined();
  expect(slots).toHaveLength(snapshot.visibleRowCount);
  for (let index = 0; index < snapshot.visibleRowCount; index += 1) {
    const row = snapshot.rowAt(index);
    if (row?.kind !== "data") throw new Error(`Expected data row at ${index}`);
    const record = root.rows.get(row.rowId);
    if (record === undefined) throw new Error(`Missing record ${row.rowId}`);
    expect(slots?.[index]).toBe(record.slot);
  }
}

describe("snapshot dense reads", () => {
  test("flat: ɵvisibleSlotRange aligns with rowAt-resolved records across a filter change", async () => {
    const model = createModel(ROWS);
    expectSlotAlignment(model);

    const transition = model.setQuery(valueAtLeast(3));
    await transition.finished;
    const narrowed = model.getState().snapshot;
    expect(narrowed.visibleRowCount).toBe(3);
    expectSlotAlignment(model);
    model.dispose();
  });

  test("flat: ɵslotCapacity reports the root's slot capacity", () => {
    const model = createModel(ROWS);
    const snapshot = model.getState().snapshot;
    const { root } = getLocalRowModelSlotInternalsForTesting(model);
    expect(typeof snapshot.ɵslotCapacity).toBe("function");
    expect(snapshot.ɵslotCapacity?.()).toBe(root.slotCapacity);
    expect(snapshot.ɵslotCapacity?.()).toBe(ROWS.length);
    model.dispose();
  });

  test("flat: ɵslotOfRowId resolves the current binding; a missing id is undefined", () => {
    const model = createModel(ROWS);
    const snapshot = model.getState().snapshot;
    const { root } = getLocalRowModelSlotInternalsForTesting(model);
    expect(snapshot.ɵslotOfRowId?.("b")).toBe(root.rows.get("b")?.slot);
    expect(snapshot.ɵslotOfRowId?.("missing")).toBeUndefined();
    model.dispose();
  });

  test("grouped: all three reads are implemented and return undefined", () => {
    const model = createModel(ROWS, { grouped: true });
    const snapshot = model.getState().snapshot;
    expect(typeof snapshot.ɵvisibleSlotRange).toBe("function");
    expect(typeof snapshot.ɵslotOfRowId).toBe("function");
    expect(typeof snapshot.ɵslotCapacity).toBe("function");
    expect(
      snapshot.ɵvisibleSlotRange?.(0, snapshot.visibleRowCount),
    ).toBeUndefined();
    expect(snapshot.ɵslotOfRowId?.("a")).toBeUndefined();
    expect(snapshot.ɵslotCapacity?.()).toBeUndefined();
    model.dispose();
  });

  test("slot reuse: a remove+add transaction rebinds the slot and the range reflects it", () => {
    const model = createModel(ROWS);
    expect(model.applyTransaction({ remove: ["b"] })).toMatchObject({
      removed: 1,
    });
    expect(
      model.applyTransaction({ add: [{ id: "f", value: 6 }] }),
    ).toMatchObject({ added: 1 });

    // Non-vacuous via the committed-root seam: prove the allocator actually
    // reused b's slot for f before asserting the snapshot reads agree.
    const { root } = getLocalRowModelSlotInternalsForTesting(model);
    const reusedSlot = root.rows.get("f")?.slot;
    expect(reusedSlot).toBe(1);

    const snapshot = model.getState().snapshot;
    expect(snapshot.ɵslotOfRowId?.("f")).toBe(reusedSlot);
    expect(snapshot.ɵslotOfRowId?.("b")).toBeUndefined();
    expectSlotAlignment(model);
    const slots = snapshot.ɵvisibleSlotRange?.(0, snapshot.visibleRowCount);
    const fIndex = [...Array(snapshot.visibleRowCount).keys()].find((index) => {
      const row = snapshot.rowAt(index);
      return row?.kind === "data" && row.rowId === "f";
    });
    expect(fIndex).toBeDefined();
    expect(slots?.[fIndex ?? -1]).toBe(reusedSlot);
    model.dispose();
  });

  test("instrumented wrapper passes the reads through and counts the range read", () => {
    const instrumented = createInstrumentedLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row: Row) => row.id,
    });
    instrumented.diagnostics.resetWork();
    const snapshot = instrumented.model.getState().snapshot;
    const slots = snapshot.ɵvisibleSlotRange?.(0, snapshot.visibleRowCount);
    expect(slots).toHaveLength(ROWS.length);
    expect(instrumented.diagnostics.read().work.snapshotOutputRowsRead).toBe(
      ROWS.length,
    );
    // The k-sized reads pass through without counting output rows.
    expect(snapshot.ɵslotOfRowId?.("a")).toBe(0);
    expect(snapshot.ɵslotCapacity?.()).toBe(ROWS.length);
    expect(instrumented.diagnostics.read().work.snapshotOutputRowsRead).toBe(
      ROWS.length,
    );
    instrumented.model.dispose();
  });
});
