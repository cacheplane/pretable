/**
 * Columnar filter-value store (Amendment J §§2–4, §3 revised): the mutable
 * chunked cell store, the plan seams (`columnarCellFor` / `fillColumnarCell`
 * / `clearColumnarSlots` / `resetColumnarStore`), shared-state adoption, and
 * the FRESHNESS ORACLE — after every committed step, for every filter column
 * and live slot, a cell is EITHER a hole OR equal to the SCAN-NORMALIZED
 * fresh accessor read (cells hold the scan representation, not raw values).
 * The oracle drives the sweep's write-through by hand via `fillColumnarCell`
 * and re-checks, independent of `bulkFilterVerdictSweep`.
 */

import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import {
  columnarCellFor,
  fillColumnarCell,
  type CompiledQuery,
} from "../compiled-query";
import {
  COLUMNAR_HOLE,
  columnarClearCell,
  columnarGetCell,
  columnarSetCell,
  createColumnarVector,
} from "../mutable-columnar";
import type { PretableRowId } from "../column-types";
import type { RevisionRoot } from "../internal-types";

describe("mutable columnar vector", () => {
  test("set/get/clear round trip; a hole is not a cached undefined", () => {
    const vector = createColumnarVector();
    expect(columnarGetCell(vector, 0)).toBe(COLUMNAR_HOLE);
    columnarSetCell(vector, 0, "x");
    expect(columnarGetCell(vector, 0)).toBe("x");
    // `undefined` is a legitimate cached VALUE, distinct from a hole — the
    // presence bitset, not the value array, is what answers "present".
    columnarSetCell(vector, 1, undefined);
    expect(columnarGetCell(vector, 1)).toBeUndefined();
    expect(columnarGetCell(vector, 1)).not.toBe(COLUMNAR_HOLE);
    columnarClearCell(vector, 0);
    expect(columnarGetCell(vector, 0)).toBe(COLUMNAR_HOLE);
    // Clearing a slot in an absent chunk is a no-op, not an error.
    columnarClearCell(vector, 999_999);
  });

  test("chunk table grows on demand, like the allocator", () => {
    const vector = createColumnarVector();
    columnarSetCell(vector, 5000, 42);
    expect(columnarGetCell(vector, 5000)).toBe(42);
    expect(columnarGetCell(vector, 5001)).toBe(COLUMNAR_HOLE);
    expect(columnarGetCell(vector, 0)).toBe(COLUMNAR_HOLE);
  });

  test("the -1 placeholder slot can never reach the store", () => {
    const vector = createColumnarVector();
    expect(() => columnarSetCell(vector, -1, "x")).toThrow(RangeError);
    expect(() => columnarGetCell(vector, -1)).toThrow(RangeError);
    expect(() => columnarClearCell(vector, -1)).toThrow(RangeError);
  });
});

interface Row {
  id: string;
  value: number;
  label: string;
}

const helper = createColumnHelper<Row>();

/** Filter columns under test: both referenced by the model's filters. */
const FILTER_COLUMN_IDS = ["value", "label"] as const;

function createModel(rows: readonly Row[]) {
  const columns = [
    helper.accessor(
      "value",
      (row: Row) => {
        if (row.value === -1) throw new Error("poisoned accessor");
        return row.value;
      },
      { type: "number" },
    ),
    helper.accessor("label", { type: "text" }),
  ] as const;
  return createLocalRowModel({
    rows,
    columns,
    getRowId: (row: Row) => row.id,
    // Both columns are FILTER columns (pass-everything operands, so
    // membership never interferes with the script).
    query: {
      filters: [
        { columnId: "value", operator: "gte", value: -1000 },
        { columnId: "label", operator: "contains", value: "" },
      ],
      sort: [],
      rowGroups: [],
    },
  });
}

type Root = RevisionRoot<object, PretableRowId, unknown>;

function rootOf(model: object): Root {
  return getLocalRowModelSlotInternalsForTesting(model).root;
}

function planOf(root: Root): CompiledQuery<unknown> {
  return root.queryPlan;
}

/**
 * What a fresh accessor read of this row, SCAN-NORMALIZED, would answer:
 * cells hold the column type's scan representation, not the raw value —
 * numbers as-is, text lowercased. The lowercase here is a hand-written pin
 * (not the production normalizer), so a normalization regression in the
 * fill path cannot rewrite the expectation it is checked against.
 */
function freshRead(row: Row, columnId: string): unknown {
  return columnId === "value" ? row.value : row.label.toLocaleLowerCase();
}

/**
 * THE FRESHNESS ORACLE: for every filter column and every live slot, the
 * columnar cell is EITHER a hole OR equal to the scan-normalized fresh
 * accessor read of the row the current committed revision binds to that
 * slot.
 */
function expectFreshness(root: Root): void {
  const plan = planOf(root);
  for (const columnId of FILTER_COLUMN_IDS) {
    for (const [, record] of root.rows.entries()) {
      const cell = columnarCellFor(plan, columnId, record.slot);
      if (cell !== COLUMNAR_HOLE) {
        expect(cell, `stale cell for ${columnId} at slot ${record.slot}`).toBe(
          freshRead(record.row as Row, columnId),
        );
      }
    }
  }
}

/** Simulates the bulk sweep's write-through: fill every live cell with its
 * scan-normalized value (the store's contract — never the raw value). */
function fillAll(root: Root): void {
  const plan = planOf(root);
  for (const [, record] of root.rows.entries()) {
    for (const columnId of FILTER_COLUMN_IDS) {
      fillColumnarCell(
        plan,
        columnId,
        record.slot,
        freshRead(record.row as Row, columnId),
      );
    }
  }
}

function expectAllFilled(root: Root): void {
  const plan = planOf(root);
  for (const columnId of FILTER_COLUMN_IDS) {
    for (const [, record] of root.rows.entries()) {
      expect(columnarCellFor(plan, columnId, record.slot)).toBe(
        freshRead(record.row as Row, columnId),
      );
    }
  }
}

function expectAllHoles(root: Root): void {
  const plan = planOf(root);
  for (const columnId of FILTER_COLUMN_IDS) {
    for (const [, record] of root.rows.entries()) {
      expect(
        columnarCellFor(plan, columnId, record.slot),
        `expected hole for ${columnId} at slot ${record.slot}`,
      ).toBe(COLUMNAR_HOLE);
    }
  }
}

const ROWS: readonly Row[] = Object.freeze([
  { id: "a", value: 1, label: "alpha" },
  { id: "b", value: 2, label: "beta" },
  { id: "c", value: 3, label: "gamma" },
]);

describe("columnar store freshness", () => {
  test("the freshness oracle holds across the committed-revision script", () => {
    const model = createModel(ROWS);

    // 1. Initial build: a fresh plan starts with an EMPTY columnar map —
    //    nothing to clear, nothing filled.
    expectAllHoles(rootOf(model));
    expectFreshness(rootOf(model));

    // 2. Simulated scan: fill every cell, re-check.
    fillAll(rootOf(model));
    expectAllFilled(rootOf(model));
    expectFreshness(rootOf(model));

    // 3. Update transaction changing b's values: the commit-side clear must
    //    hole b's cells (both columns), and must NOT touch a's or c's.
    expect(
      model.applyTransaction({
        update: [{ id: "b", changes: { value: 20, label: "BETA" } }],
      }),
    ).toMatchObject({ updated: 1 });
    {
      const root = rootOf(model);
      const plan = planOf(root);
      const b = root.rows.get("b")!;
      for (const columnId of FILTER_COLUMN_IDS) {
        expect(columnarCellFor(plan, columnId, b.slot)).toBe(COLUMNAR_HOLE);
      }
      for (const id of ["a", "c"]) {
        const record = root.rows.get(id)!;
        for (const columnId of FILTER_COLUMN_IDS) {
          expect(columnarCellFor(plan, columnId, record.slot)).toBe(
            freshRead(record.row as Row, columnId),
          );
        }
      }
      expectFreshness(root);
    }

    // 4. Remove + add reusing the released slot. The removal clears c's
    //    cells immediately; the add's prepared-clear keeps the reused slot a
    //    hole for the NEW row.
    fillAll(rootOf(model));
    const cSlot = rootOf(model).rows.get("c")!.slot;
    expect(model.applyTransaction({ remove: ["c"] })).toMatchObject({
      removed: 1,
    });
    for (const columnId of FILTER_COLUMN_IDS) {
      // The removed row's cells are holes the moment the commit lands —
      // BEFORE any reuse — so a stale value can never wait on a free slot.
      expect(columnarCellFor(planOf(rootOf(model)), columnId, cSlot)).toBe(
        COLUMNAR_HOLE,
      );
    }
    expectFreshness(rootOf(model));
    expect(
      model.applyTransaction({ add: [{ id: "d", value: 4, label: "delta" }] }),
    ).toMatchObject({ added: 1 });
    {
      const root = rootOf(model);
      const d = root.rows.get("d")!;
      // Control: the add genuinely reused c's released slot — without this
      // the reused-slot pin below could pass vacuously.
      expect(d.slot).toBe(cSlot);
      for (const columnId of FILTER_COLUMN_IDS) {
        expect(columnarCellFor(planOf(root), columnId, d.slot)).toBe(
          COLUMNAR_HOLE,
        );
      }
      expectFreshness(root);
    }

    // 5. setRows: same plan, arbitrarily replaced rows — WHOLESALE reset.
    fillAll(rootOf(model));
    expectAllFilled(rootOf(model));
    expect(
      model.setRows([
        { id: "a", value: 100, label: "ALPHA" },
        { id: "e", value: 5, label: "epsilon" },
      ]),
    ).toMatchObject({ updated: 1, added: 1 });
    expectAllHoles(rootOf(model));
    expectFreshness(rootOf(model));

    // 6. Aborted draft: an update whose accessor throws mid-draft must not
    //    change a single cell — the clears live on the SUCCESS path only.
    fillAll(rootOf(model));
    {
      const root = rootOf(model);
      const plan = planOf(root);
      const before = new Map<string, unknown>();
      for (const columnId of FILTER_COLUMN_IDS) {
        for (const [, record] of root.rows.entries()) {
          before.set(
            `${columnId}:${record.slot}`,
            columnarCellFor(plan, columnId, record.slot),
          );
        }
      }
      expect(() =>
        model.applyTransaction({
          update: [{ id: "a", changes: { value: -1 } }],
        }),
      ).toThrowError(expect.objectContaining({ code: "accessor-failed" }));
      // Same root, same plan — the aborted draft committed nothing.
      const after = rootOf(model);
      expect(after).toBe(root);
      for (const [key, value] of before) {
        const [columnId, slot] = key.split(":");
        expect(
          columnarCellFor(plan, columnId!, Number(slot)),
          `aborted draft disturbed ${key}`,
        ).toBe(value);
      }
      expectFreshness(after);
    }

    model.dispose();
  });

  test("a filter-only change adopts the columnar store by reference; a non-filter-only change starts empty", async () => {
    const model = createModel(ROWS);
    fillAll(rootOf(model));
    const previousPlan = planOf(rootOf(model));

    // Filter-only: the fast path adopts the WHOLE shared state — the filled
    // cells survive onto the next plan (one-assignment adoption).
    const filterOnly = model.setQuery({
      filters: [
        { columnId: "value", operator: "gte", value: 2 },
        { columnId: "label", operator: "contains", value: "" },
      ],
      sort: [],
      rowGroups: [],
    });
    await filterOnly.finished;
    const adopted = rootOf(model);
    expect(planOf(adopted)).not.toBe(previousPlan);
    expectAllFilled(adopted);
    expectFreshness(adopted);

    // Non-filter-only (sort added): a fresh compile, fresh shared state —
    // every cell starts as a hole and refills on the next scan.
    const sorted = model.setQuery({
      filters: [
        { columnId: "value", operator: "gte", value: 2 },
        { columnId: "label", operator: "contains", value: "" },
      ],
      sort: [{ columnId: "value", direction: "desc" }],
      rowGroups: [],
    });
    await sorted.finished;
    expectAllHoles(rootOf(model));
    expectFreshness(rootOf(model));

    model.dispose();
  });

  test("clearing on a plan with an untouched store is a no-op commit-side (empty-map guard)", () => {
    // No fill ever happens: every transaction's clear call walks an EMPTY
    // columnar map. Nothing observable should change — this pins that the
    // clear seam is unconditionally safe to call.
    const model = createModel(ROWS);
    expect(
      model.applyTransaction({ update: [{ id: "a", changes: { value: 9 } }] }),
    ).toMatchObject({ updated: 1 });
    expectAllHoles(rootOf(model));
    model.dispose();
  });
});
