import { describe, expect, test } from "vitest";

import { createInstrumentedLocalRowModel } from "../diagnostics";
import { createColumnHelper } from "../index";

interface WorkRow {
  id: number;
  team: string;
  score: number;
  label: string;
}

const helper = createColumnHelper<WorkRow>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text" }),
] as const;

function rows(size: number): readonly WorkRow[] {
  return Array.from({ length: size }, (_, id) => ({
    id,
    team: `team-${id % 100}`,
    score: id,
    label: `row-${id}`,
  }));
}

function runTransaction(size: 10_000 | 100_000, grouped: boolean) {
  const instrumented = createInstrumentedLocalRowModel({
    rows: rows(size),
    columns,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: [{ columnId: "score", operator: "gte", value: 0 }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: grouped ? [{ columnId: "team", direction: "asc" }] : [],
    },
  });
  instrumented.diagnostics.resetWork();

  instrumented.model.applyTransaction({
    update: Array.from({ length: 50 }, (_, offset) => {
      const id = offset * 17;
      return {
        id,
        changes: {
          score: size + offset,
          label: `updated-${offset}`,
        },
      };
    }),
  });
  const transaction = instrumented.diagnostics.read().work;
  instrumented.diagnostics.resetWork();
  expect(instrumented.model.getState().snapshot.range(10, 110)).toHaveLength(
    100,
  );
  const range = instrumented.diagnostics.read().work;
  instrumented.model.dispose();
  return { transaction, range };
}

describe("instrumented local row-model work", () => {
  test.each([false, true])(
    "keeps the same 50-row %s transaction bounded from 10k to 100k",
    (grouped) => {
      const small = runTransaction(10_000, grouped);
      const large = runTransaction(100_000, grouped);

      expect(small.transaction.rowsEvaluated).toBe(50);
      expect(large.transaction.rowsEvaluated).toBe(
        small.transaction.rowsEvaluated,
      );
      expect(large.transaction.hamtNodesCopied).toBeGreaterThan(0);
      expect(large.transaction.orderNodesCopied).toBeGreaterThan(0);
      if (grouped) {
        expect(large.transaction.groupNodesCopied).toBeGreaterThan(0);
        expect(large.transaction.aggregateMerges).toBeGreaterThan(0);
      }
      expect(large.transaction.hamtNodesCopied).toBeLessThanOrEqual(
        // One extra HAMT level per 5 hash bits, across the canonical and
        // grouped membership maps touched by each changed ID.
        small.transaction.hamtNodesCopied + 50 * 8,
      );
      expect(large.transaction.orderNodesCopied).toBeLessThanOrEqual(
        // A changed grouped row touches leaf order plus both aggregate
        // populations; the 10x size increase adds under four AVL levels per
        // remove/insert path.
        small.transaction.orderNodesCopied + 50 * 24,
      );
      expect(large.transaction.groupNodesCopied).toBeLessThanOrEqual(
        small.transaction.groupNodesCopied + 50 * 4,
      );
      expect(large.transaction.aggregateMerges).toBeLessThanOrEqual(
        small.transaction.aggregateMerges + 50 * 32,
      );
      expect(small.range.snapshotOutputRowsRead).toBe(100);
      expect(large.range.snapshotOutputRowsRead).toBe(100);
    },
    60_000,
  );

  test("does not leak the instrumented factory through the package barrel", async () => {
    const publicApi = await import("../index");
    expect("createInstrumentedLocalRowModel" in publicApi).toBe(false);
  });

  test("keeps recorder state isolated between models", () => {
    const first = createInstrumentedLocalRowModel({
      rows: rows(4),
      columns,
    });
    const second = createInstrumentedLocalRowModel({
      rows: rows(4),
      columns,
    });
    first.diagnostics.resetWork();
    second.diagnostics.resetWork();
    first.model.applyTransaction({
      update: [{ id: 1, changes: { label: "first-only" } }],
    });

    expect(first.diagnostics.read().work.rowsEvaluated).toBe(1);
    expect(second.diagnostics.read().work).toMatchObject({
      rowsEvaluated: 0,
      hamtNodesCopied: 0,
      orderNodesCopied: 0,
      groupNodesCopied: 0,
      aggregateMerges: 0,
    });
  });
});
