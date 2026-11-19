import { expect, it } from "vitest";
import * as layout from "../index";
import { createRowHeightIndex } from "../row-height-index";

it("reads one aligned materialized range in published global coordinates", () => {
  const metrics = createRowHeightIndex({
    defaultHeight: 20,
    getKey: (n: number) => n,
    rows: [0, 1, 2].map((key) => ({ key })),
  });
  const calls: number[][] = [];
  const read = layout.readLayout;
  expect(read).toBeTypeOf("function");
  const result = read({
    rowMetrics: metrics,
    leadingHeight: 1000,
    trailingHeight: 1000,
    scrollTop: 1025,
    viewportHeight: 20,
    overscan: 0,
    readRange(start: number, end: number) {
      calls.push([start, end]);
      return ["a", "b", "c"].slice(start, end);
    },
  });
  expect(calls).toEqual([[1, 3]]);
  expect(result.scrollTop).toBe(1025);
  expect(result.rows.map((row) => [row.value, row.top, row.height])).toEqual([
    ["b", 1020, 20],
    ["c", 1040, 20],
  ]);
  expect(result.totalHeight).toBe(2060);
});

it("clamps scroll publication and refuses misaligned range reads", () => {
  const read = layout.readLayout;
  expect(read).toBeTypeOf("function");
  const metrics = createRowHeightIndex({
    defaultHeight: 20,
    getKey: (n: number) => n,
    rows: [0, 1, 2].map((key) => ({ key })),
  });
  const input = {
    rowMetrics: metrics,
    scrollTop: 10000,
    viewportHeight: 40,
    overscan: 0,
    readRange: (start: number, end: number) => [0, 1, 2].slice(start, end),
  };
  const result = read(input);
  expect(result.scrollTop).toBe(20);
  expect(result.rows[0]!.top).toBe(20);
  expect(() => read({ ...input, readRange: () => [] })).toThrow(/range/i);
});
