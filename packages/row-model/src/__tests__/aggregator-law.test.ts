import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createAggregateTree,
  createAggregatorLawValidator,
  defaultAggregatorOutputEquality,
  type AggregatorLawDiagnostic,
  type PretableAggregator,
} from "..";

interface Row {
  readonly id: number;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("aggregator law validation", () => {
  test("compares common keyed and set-like structured outputs by value", () => {
    expect(
      defaultAggregatorOutputEquality(
        new Map([["total", { value: 3 }]]),
        new Map([["total", { value: 3 }]]),
      ),
    ).toBe(true);
    expect(
      defaultAggregatorOutputEquality(
        new Map([["total", 3]]),
        new Map([["total", 4]]),
      ),
    ).toBe(false);
    expect(
      defaultAggregatorOutputEquality(new Set([1, 2]), new Set([1, 2])),
    ).toBe(true);
    expect(
      defaultAggregatorOutputEquality(new Set([1, 2]), new Set([1, 3])),
    ).toBe(false);
  });

  test("reports a sequential/partition mismatch once per aggregator and column", () => {
    const diagnostics: AggregatorLawDiagnostic[] = [];
    const invalid: PretableAggregator<
      Row,
      number,
      number[],
      readonly number[]
    > = {
      init: () => [],
      accumulate: (accumulator, value) => [...accumulator, value],
      merge: (left) => left,
      finalize: (accumulator) => [...accumulator],
    };
    const validator = createAggregatorLawValidator({
      sink: (diagnostic) => diagnostics.push(diagnostic),
    });
    let tree = createAggregateTree<
      number,
      Row,
      number,
      number,
      number[],
      readonly number[]
    >({
      columnId: "quantity",
      aggregator: invalid,
      lawValidator: validator,
      compare: (left, right) => left.dependency - right.dependency,
    });

    for (let id = 0; id < 12; id += 1) {
      tree = tree.insertOrReplace({
        id,
        row: { id },
        value: id + 1,
        dependency: id,
      });
    }

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "aggregator-law-violation",
      columnId: "quantity",
      law: "sequential-vs-merged-one-row-partitions",
      sampleSize: 2,
    });
  });

  test("does not flag fresh but structurally equal object outputs", () => {
    const diagnostics: AggregatorLawDiagnostic[] = [];
    const valid: PretableAggregator<
      Row,
      number,
      number,
      { readonly total: number; readonly nested: readonly number[] }
    > = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => left + right,
      finalize: (total) => ({ total, nested: [total] }),
    };
    const validator = createAggregatorLawValidator({
      sink: (diagnostic) => diagnostics.push(diagnostic),
    });
    let tree = createAggregateTree<
      number,
      Row,
      number,
      number,
      number,
      { readonly total: number; readonly nested: readonly number[] }
    >({
      columnId: "quantity",
      aggregator: valid,
      lawValidator: validator,
      compare: (left, right) => left.dependency - right.dependency,
    });

    for (let id = 0; id < 8; id += 1) {
      tree = tree.insertOrReplace({
        id,
        row: { id },
        value: id,
        dependency: id,
      });
    }

    expect(diagnostics).toEqual([]);
  });

  test("allows an output equality hook", () => {
    const diagnostics: AggregatorLawDiagnostic[] = [];
    const valid: PretableAggregator<Row, number, number, { total: number }> = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => left + right,
      finalize: (total) => ({ total }),
    };
    const validator = createAggregatorLawValidator({
      equals: (left, right) =>
        (left as { total: number }).total ===
        (right as { total: number }).total,
      sink: (diagnostic) => diagnostics.push(diagnostic),
    });
    let tree = createAggregateTree({
      columnId: "quantity",
      aggregator: valid,
      lawValidator: validator,
    });
    tree = tree
      .insertOrReplace({ id: 1, row: { id: 1 }, value: 2, dependency: 1 })
      .insertOrReplace({ id: 2, row: { id: 2 }, value: 3, dependency: 2 });

    expect(tree.finalize()).toEqual({ total: 5 });
    expect(diagnostics).toEqual([]);
  });

  test("retains at most eight representative leaves", () => {
    let accumulateCalls = 0;
    const valid: PretableAggregator<Row, number, number, number> = {
      init: () => 0,
      accumulate(accumulator, value) {
        accumulateCalls += 1;
        return accumulator + value;
      },
      merge: (left, right) => left + right,
      finalize: (total) => total,
    };
    const validator = createAggregatorLawValidator({ sink: () => undefined });
    let tree = createAggregateTree({
      columnId: "quantity",
      aggregator: valid,
      lawValidator: validator,
    });
    for (let id = 0; id < 8; id += 1) {
      tree = tree.insertOrReplace({
        id,
        row: { id },
        value: id,
        dependency: id,
      });
    }
    const callsAfterEight = accumulateCalls;
    tree = tree.insertOrReplace({
      id: 8,
      row: { id: 8 },
      value: 8,
      dependency: 8,
    });

    expect(accumulateCalls - callsAfterEight).toBe(1);
  });

  test("has no active sampling path in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { createAggregatorLawValidator: createProductionValidator } =
      await import("../aggregator-law");
    const { createAggregateTree: createProductionTree } =
      await import("../persistent/aggregate-tree");
    let sinkCalls = 0;
    let observeCalls = 0;
    let accumulateCalls = 0;
    const validator = createProductionValidator({
      sink: () => {
        sinkCalls += 1;
      },
    });
    const invalid: PretableAggregator<Row, number, number, number> = {
      init: () => 0,
      accumulate(accumulator, value) {
        accumulateCalls += 1;
        return accumulator + value;
      },
      merge: (left) => left,
      finalize: (total) => total,
    };

    validator.observe({
      aggregator: invalid,
      columnId: "quantity",
      row: { id: 1 },
      value: 1,
    });
    createProductionTree<number, Row, number, number, number, number>({
      columnId: "quantity",
      aggregator: invalid,
      lawValidator: {
        observe: () => {
          observeCalls += 1;
        },
      },
    }).insertOrReplace({
      id: 1,
      row: { id: 1 },
      value: 1,
      dependency: 1,
    });

    expect(accumulateCalls).toBe(1);
    expect(sinkCalls).toBe(0);
    expect(observeCalls).toBe(0);
  });
});
