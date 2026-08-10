import { describe, expect, test, vi } from "vitest";

import {
  PretableDisposedModelError,
  createColumnHelper,
  createLocalRowModel,
} from "../index";

interface Row {
  id: number;
  value: number;
  label: string;
}
const helper = createColumnHelper<Row>();

describe("setRows incremental replacement", () => {
  test("scans IDs once, reuses unchanged references, and reevaluates changed references", () => {
    const value = vi.fn((row: Row) => row.value);
    const getRowId = vi.fn((row: Row) => row.id);
    const columns = [
      helper.accessor("value", value, { type: "number" }),
    ] as const;
    const first = { id: 1, value: 1, label: "one" };
    const second = { id: 2, value: 2, label: "two" };
    const model = createLocalRowModel({
      rows: [first, second],
      columns,
      getRowId,
      query: {
        filters: [],
        sort: [{ columnId: "value", direction: "asc" }],
        rowGroups: [],
      },
    });
    const firstPublic = model.getState().snapshot.rowAt(0);
    getRowId.mockClear();
    value.mockClear();

    expect(model.setRows([first, { ...second, label: "TWO" }])).toMatchObject({
      updated: 1,
      unchanged: 1,
      revision: 1,
    });
    expect(getRowId).toHaveBeenCalledTimes(2);
    expect(value).toHaveBeenCalledTimes(1);
    expect(model.getState().snapshot.rowAt(0)).toBe(firstPublic);
  });

  test("treats incoming order as authoritative for stable ties", () => {
    const columns = [helper.accessor("value", { type: "number" })] as const;
    const one = { id: 1, value: 0, label: "one" };
    const two = { id: 2, value: 0, label: "two" };
    const model = createLocalRowModel({ rows: [one, two], columns });

    model.setRows([two, one]);

    expect(model.getState().snapshot.range(0, 2)).toMatchObject([
      { rowId: 2, sourceIndex: 0 },
      { rowId: 1, sourceIndex: 1 },
    ]);
  });

  test("reevaluates each row once when same-reference mutation invalidates the plan cache", () => {
    const value = vi.fn((row: Row) => row.value);
    const columns = [
      helper.accessor("value", value, { type: "number" }),
    ] as const;
    const mutable = Object.preventExtensions({
      id: 1,
      value: 1,
      label: "one",
    });
    const other = { id: 2, value: 2, label: "two" };
    const model = createLocalRowModel({
      rows: [mutable, other],
      columns,
      query: {
        filters: [],
        sort: [{ columnId: "value", direction: "asc" }],
        rowGroups: [],
      },
    });
    mutable.value = 3;
    value.mockClear();

    expect(model.setRows([mutable, { ...other, label: "TWO" }])).toMatchObject({
      revision: 1,
      updated: 2,
    });
    expect(value).toHaveBeenCalledTimes(2);
  });

  test("rejects duplicates before freezing or publishing and guards disposal", () => {
    const columns = [helper.accessor("value", { type: "number" })] as const;
    const model = createLocalRowModel({ rows: [], columns });
    const duplicate = [
      { id: 1, value: 1, label: "one" },
      { id: 1, value: 2, label: "duplicate" },
    ];
    const before = model.getState();
    expect(() => model.setRows(duplicate)).toThrowError(
      expect.objectContaining({ code: "duplicate-row-id" }),
    );
    expect(duplicate.every(Object.isExtensible)).toBe(true);
    expect(model.getState()).toBe(before);
    model.dispose();
    expect(() => model.setRows([])).toThrowError(PretableDisposedModelError);
  });
});
