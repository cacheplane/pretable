import { describe, expect, test } from "vitest";

import { createInstrumentedLocalRowModel } from "../diagnostics";
import { createColumnHelper } from "../index";

interface WorkRow {
  id: number;
  team: string;
  score: number;
  filterValue: number;
  amount: number;
  label: string;
}

const helper = createColumnHelper<WorkRow>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number" }),
  helper.accessor("filterValue", { type: "number" }),
  helper.accessor("amount", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text" }),
] as const;

function rows(size: number): readonly WorkRow[] {
  const groupCount = Math.floor(Math.sqrt(size));
  return Array.from({ length: size }, (_, id) => ({
    id,
    team: id < 50 ? `solo-${id}` : `team-${id % groupCount}`,
    score: id * 10,
    filterValue: id >= 900 && id < 950 ? 900 : 2_000,
    amount: id,
    label: `row-${id}`,
  }));
}

const workCases = [
  "displayOnly",
  "aggregateOnly",
  "stableOrder",
  "movedOrder",
  "filterRemain",
  "filterEntry",
  "filterExit",
  "groupKeyChange",
  "groupPruneCreate",
] as const;

type WorkCase = (typeof workCases)[number];
type WorkCounters = ReturnType<
  ReturnType<typeof createInstrumentedLocalRowModel>["diagnostics"]["read"]
>["work"];

function ids(start: number): readonly number[] {
  return Array.from({ length: 50 }, (_, offset) => start + offset);
}

function updatesFor(
  workCase: WorkCase,
  size: 10_000 | 100_000,
): readonly { readonly id: number; readonly changes: Partial<WorkRow> }[] {
  const groupCount = Math.floor(Math.sqrt(size));
  const selected =
    workCase === "displayOnly" || workCase === "groupPruneCreate"
      ? ids(0)
      : workCase === "aggregateOnly"
        ? ids(100)
        : workCase === "stableOrder"
          ? ids(200)
          : workCase === "movedOrder"
            ? ids(300)
            : workCase === "filterEntry"
              ? ids(900)
              : workCase === "filterRemain"
                ? ids(1_100)
                : workCase === "filterExit"
                  ? ids(1_200)
                  : ids(1_400);
  return selected.map((id, offset) => ({
    id,
    changes:
      workCase === "displayOnly"
        ? { label: `display-${offset}` }
        : workCase === "aggregateOnly"
          ? { amount: 2_000_000 + offset }
          : workCase === "stableOrder"
            ? { score: id * 10 + 1 }
            : workCase === "movedOrder"
              ? { score: 2_000_000 + offset }
              : workCase === "filterRemain"
                ? { filterValue: 2_001 }
                : workCase === "filterEntry"
                  ? { filterValue: 2_000 }
                  : workCase === "filterExit"
                    ? { filterValue: 900 }
                    : workCase === "groupKeyChange"
                      ? {
                          team: `team-${((id % groupCount) + 1) % groupCount}`,
                        }
                      : { team: `created-${id}` },
  }));
}

function runCases(size: 10_000 | 100_000, grouped: boolean) {
  const instrumented = createInstrumentedLocalRowModel({
    rows: rows(size),
    columns,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: [{ columnId: "filterValue", operator: "gte", value: 1_000 }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: grouped ? [{ columnId: "team", direction: "asc" }] : [],
    },
  });
  const cases = {} as Record<WorkCase, WorkCounters>;
  for (const workCase of workCases) {
    if (!grouped && workCase.startsWith("group")) continue;
    instrumented.diagnostics.resetWork();
    instrumented.model.applyTransaction({
      update: updatesFor(workCase, size),
    });
    cases[workCase] = instrumented.diagnostics.read().work;
  }
  instrumented.diagnostics.resetWork();
  expect(instrumented.model.getState().snapshot.range(10, 110)).toHaveLength(
    100,
  );
  const range = instrumented.diagnostics.read().work;
  instrumented.model.dispose();
  return { cases, range };
}

function assertFiftyEvaluations(work: WorkCounters): void {
  if (work.rowsEvaluated !== 50)
    throw new Error(
      `Expected 50 evaluated rows, received ${work.rowsEvaluated}.`,
    );
}

describe("instrumented local row-model work", () => {
  test.each([false, true])(
    "keeps isolated 50-row %s work classes bounded from 10k to 100k",
    (grouped) => {
      const small = runCases(10_000, grouped);
      const large = runCases(100_000, grouped);

      for (const workCase of workCases) {
        if (!grouped && workCase.startsWith("group")) continue;
        const smallWork = small.cases[workCase];
        const largeWork = large.cases[workCase];
        assertFiftyEvaluations(smallWork);
        expect(largeWork.rowsEvaluated).toBe(smallWork.rowsEvaluated);
        expect(largeWork.hamtNodesCopied).toBeGreaterThan(0);
        expect(
          largeWork.hamtNodesCopied,
          `${workCase} HAMT small=${smallWork.hamtNodesCopied} large=${largeWork.hamtNodesCopied}`,
        ).toBeLessThanOrEqual(
          // A 10x population adds fewer than two 5-bit HAMT levels across the
          // canonical row map and four grouped membership maps touched by an
          // update. Ten extra copied nodes per ID is the resulting path bound.
          smallWork.hamtNodesCopied + 50 * 10,
        );
        expect(
          largeWork.orderNodesCopied,
          `${workCase} order small=${smallWork.orderNodesCopied} large=${largeWork.orderNodesCopied}`,
        ).toBeLessThanOrEqual(
          // Persistent order/aggregate paths grow logarithmically; this bound
          // covers remove+insert across the independently measured trees.
          smallWork.orderNodesCopied + 50 * 24,
        );
        if (grouped) {
          expect(
            largeWork.groupNodesCopied,
            `${workCase} must account for grouped persistent work`,
          ).toBeGreaterThan(0);
          expect(
            largeWork.groupNodesCopied,
            `${workCase} group small=${smallWork.groupNodesCopied} large=${largeWork.groupNodesCopied}`,
          ).toBeLessThanOrEqual(
            // The logical group path and measured group-order AVL are both
            // persistent. A 10x population adds under twenty copied/allocated
            // group nodes per touched ID across remove+insert.
            smallWork.groupNodesCopied + 50 * 20,
          );
          expect(
            largeWork.aggregateMerges,
            `${workCase} aggregate small=${smallWork.aggregateMerges} large=${largeWork.aggregateMerges}`,
          ).toBeLessThanOrEqual(
            // Aggregate work is cached on AVL paths. A 10x population adds
            // under sixteen merge calls per touched ID across both populations.
            smallWork.aggregateMerges + 50 * 16,
          );
        }
      }
      if (grouped) {
        expect(
          small.cases.aggregateOnly.groupNodesCopied,
          "measured group AVL allocations must be counted in addition to the 100 logical remove/insert nodes",
        ).toBeGreaterThan(100);
      }
      expect(small.range.snapshotOutputRowsRead).toBe(100);
      expect(large.range.snapshotOutputRowsRead).toBe(100);
    },
    60_000,
  );

  test("negative controls detect a full rebuild and full snapshot flatten", () => {
    const source = rows(10_000);
    const instrumented = createInstrumentedLocalRowModel({
      rows: source,
      columns,
    });
    instrumented.diagnostics.resetWork();
    instrumented.model.setRows(source.map((row) => ({ ...row })));
    const rebuilt = instrumented.diagnostics.read().work;
    expect(rebuilt.rowsEvaluated).toBe(10_000);
    expect(() => assertFiftyEvaluations(rebuilt)).toThrow(
      "Expected 50 evaluated rows, received 10000.",
    );

    instrumented.diagnostics.resetWork();
    const snapshot = instrumented.model.getState().snapshot;
    snapshot.range(0, snapshot.visibleRowCount);
    expect(instrumented.diagnostics.read().work.snapshotOutputRowsRead).toBe(
      10_000,
    );
    instrumented.model.dispose();
  });

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
