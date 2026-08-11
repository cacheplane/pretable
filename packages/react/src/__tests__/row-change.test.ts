import { describe, expect, test } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { deriveRowChange } from "../row-change";

interface Row {
  id: number;
  quantity: number;
  price: number;
  total: number;
}

const column = createColumnHelper<Row>();

describe("deriveRowChange", () => {
  test("direct property accessors produce a minimal patch", () => {
    const quantity = column.accessor("quantity", { type: "number" });
    const row = { id: 1, quantity: 2, price: 5, total: 10 };

    expect(
      deriveRowChange({ rowId: 1, row, column: quantity, value: 3 }),
    ).toEqual({
      rowId: 1,
      columnId: "quantity",
      previousRow: row,
      row: { id: 1, quantity: 3, price: 5, total: 10 },
      changes: { quantity: 3 },
      value: 3,
    });
  });

  test("computed editable accessors can produce a typed multi-field patch", () => {
    const total = column.accessor("total", (row) => row.total, {
      type: "number",
    });
    const row = { id: 1, quantity: 2, price: 5, total: 10 };

    expect(
      deriveRowChange({
        rowId: 1,
        row,
        column: {
          ...total,
          setValue: ({ row: current, value }: { row: Row; value: number }) => ({
            quantity: value / current.price,
            total: value,
          }),
        },
        value: 20,
      }),
    ).toEqual({
      rowId: 1,
      columnId: "total",
      previousRow: row,
      row: { id: 1, quantity: 4, price: 5, total: 20 },
      changes: { quantity: 4, total: 20 },
      value: 20,
    });
  });

  test("computed accessors without setValue are not writable", () => {
    const total = column.accessor("total", (row) => row.total, {
      type: "number",
    });
    expect(() =>
      deriveRowChange({
        rowId: 1,
        row: { id: 1, quantity: 2, price: 5, total: 10 },
        column: total,
        value: 20,
      }),
    ).toThrow(/setValue/);
  });
});
