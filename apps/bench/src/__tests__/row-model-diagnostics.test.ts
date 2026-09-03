import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  createBenchModelColumns,
  createBenchRowModelOwner,
  createRowModelDiagnosticsController,
  type RowModelDiagnosticsController,
} from "../row-model-diagnostics";
import { createDeterministicUpdatePlan } from "../update-plan";

function flushScheduled(scheduled: (() => void)[]): void {
  for (;;) {
    const task = scheduled.shift();
    if (task === undefined) return;
    task();
  }
}

/**
 * The live leaf count the controller tracks. `startQueryCandidate()` stamps
 * `groupCounts.size` into `rebuild.groupCountBefore` at rebuild start, which
 * is the only read of that map that does not need a rebuild to finish.
 */
async function readGroupCount(
  controller: RowModelDiagnosticsController,
): Promise<number> {
  const transition = controller.startQueryCandidate();
  expect(transition).not.toBeNull();
  const count = controller.read().rebuild?.groupCountBefore;
  transition!.cancel();
  await transition!.finished.catch(() => undefined);
  return count ?? -1;
}

describe("bench-only row-model diagnostics", () => {
  test("forwards a cooperative budget only to the instrumented model", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 505,
      roles: dataset.roles,
    });
    const scheduled: (() => void)[] = [];
    let clock = 0;
    const diagnostics = createRowModelDiagnosticsController({
      dataset,
      plan,
      transitionBudgetMs: 1,
      transitionClock: () => {
        clock += 0.6;
        return clock;
      },
      scheduler: {
        schedule(task) {
          scheduled.push(task);
          return () => undefined;
        },
      },
    });

    diagnostics.model.setQuery({
      ...diagnostics.model.getState().snapshot.query,
      sort: [{ columnId: "col_3", direction: "desc" }],
    } as never);
    expect(diagnostics.transitionBudgetMs).toBe(1);
    expect(diagnostics.read().work.rowsEvaluated).toBeGreaterThan(1);
    expect(scheduled).toHaveLength(1);
    diagnostics.dispose();

    expect(() =>
      createBenchRowModelOwner({
        dataset,
        diagnostics: false,
        plan,
        transitionBudgetMs: -1,
      }).dispose(),
    ).not.toThrow();
  });

  test("uses an ordinary model without constructing diagnostics unless opted in", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const owner = createBenchRowModelOwner({
      dataset,
      diagnostics: false,
      plan: createDeterministicUpdatePlan({
        dataset,
        grouped: false,
        seed: 505,
        roles: dataset.roles,
      }),
    });

    expect(owner.diagnostics).toBeNull();
    expect(owner.model.getState().snapshot.sourceRowCount).toBe(
      dataset.rowCount,
    );
    owner.dispose();
  });

  test("wraps one explicit instrumented model and records timed seeded commits", () => {
    const dataset = createScenarioDataset("S5", { scale: "dev" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: false,
      seed: 505,
      roles: dataset.roles,
    });
    const controller = createRowModelDiagnosticsController({ dataset, plan });

    const before = controller.read();
    const result = controller.applyNextSeededTransaction();
    const after = controller.read();

    expect(controller.model.getState().snapshot.sourceRowCount).toBe(
      dataset.rowCount,
    );
    expect(result.updated).toBeGreaterThan(0);
    expect(after.acceptedPatchCount - before.acceptedPatchCount).toBe(50);
    expect(after.commitDurationsMs).toHaveLength(1);
    expect(after.work.rowsEvaluated).toBeGreaterThan(0);
    controller.dispose();
  });

  test("starts and cancels query candidates and distinct dictionaries", async () => {
    const dataset = createScenarioDataset("S5", { scale: "dev" });
    const scheduled: (() => void)[] = [];
    const controller = createRowModelDiagnosticsController({
      dataset,
      plan: createDeterministicUpdatePlan({
        dataset,
        grouped: true,
        seed: 505,
        roles: dataset.roles,
      }),
      scheduler: {
        schedule(task) {
          scheduled.push(task);
          return () => undefined;
        },
      },
    });

    const transition = controller.startQueryCandidate();
    expect(transition).not.toBeNull();
    controller.recordInteractionSample({ scrollTop: 0, activeElement: null });
    controller.recordInteractionSample({ scrollTop: 0, activeElement: null });
    controller.recordInteractionSample({ scrollTop: 1, activeElement: null });
    expect(controller.read().rebuild?.interactionSamplesObserved).toBe(1);
    controller.cancelQueryCandidate();
    await expect(transition!.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
    });

    const distinct = controller.startDistinctDictionary("col_1");
    expect(scheduled.length).toBeGreaterThan(0);
    controller.cancelDistinctDictionary();
    await expect(distinct.finished).rejects.toMatchObject({
      name: "PretableDistinctValueCancelledError",
    });
    controller.dispose();
  });

  test("churns bounded journal and cache retention without retaining revisions", async () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const controller = createRowModelDiagnosticsController({
      dataset,
      plan: createDeterministicUpdatePlan({
        dataset,
        grouped: false,
        seed: 505,
        roles: dataset.roles,
      }),
      changeJournalCapacity: 2,
      distinctValueCacheCapacity: 1,
    });

    controller.churnRevisions(2_000);
    await controller.churnRetentionLimits();
    const snapshot = controller.read();

    expect(snapshot.retention.consumerJournalEntryCount).toBeLessThanOrEqual(2);
    expect(snapshot.retention.distinctCacheEntryCount).toBeLessThanOrEqual(1);
    expect(snapshot.retention.liveRevisionRootCount).toBe(1);
    expect(
      controller.model.getState().snapshot.revision,
    ).toBeGreaterThanOrEqual(2_004);
    controller.dispose();
  });

  test("applies the controller's default retention capacities", async () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const controller = createRowModelDiagnosticsController({
      dataset,
      plan: createDeterministicUpdatePlan({
        dataset,
        grouped: false,
        seed: 505,
        roles: dataset.roles,
      }),
    });

    controller.churnRevisions(200);
    await controller.churnRetentionLimits();
    const retention = controller.read().retention;
    expect(retention.consumerJournalEntryCount).toBeLessThanOrEqual(32);
    expect(retention.distinctCacheEntryCount).toBeLessThanOrEqual(4);
    controller.dispose();
  });

  test("proves the final checksum contains every seeded patch", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: false,
      seed: 91_337,
      roles: dataset.roles,
    });
    const controller = createRowModelDiagnosticsController({ dataset, plan });

    for (let index = 0; index < plan.ticks.length; index += 1) {
      controller.applyNextSeededTransaction();
    }
    const summary = controller.createRunSummary();

    expect(summary.acceptedPatchCount).toBe(3_000);
    expect(summary.checksumAcceptedPatchCount).toBe(3_000);
    expect(summary.finalChecksum).toBe(summary.expectedFinalChecksum);
    controller.dispose();
  });

  test("canonicalizes grouped visible order after rebuild and catch-up", async () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 91_337,
      roles: dataset.roles,
    });
    const controller = createRowModelDiagnosticsController({ dataset, plan });
    let transition: ReturnType<typeof controller.startQueryCandidate> = null;

    for (let index = 0; index < plan.ticks.length; index += 1) {
      controller.applyNextSeededTransaction();
      if (index === plan.rebuild!.startAfterTick) {
        transition = controller.startQueryCandidate();
      }
    }
    await transition!.finished;
    const summary = controller.createRunSummary();

    expect(summary.acceptedPatchCount).toBe(3_000);
    expect(summary.rebuild?.streamCommitsObserved).toBeGreaterThan(0);
    expect(summary.finalChecksum).toBe(summary.expectedFinalChecksum);
    controller.dispose();
  });

  test("types columns from roles: legacy datasets keep col_3 as the only number", () => {
    const s5 = createScenarioDataset("S5", { scale: "smoke" });
    const columns = createBenchModelColumns(s5, false);
    expect(columns.filter((c) => c.type === "number").map((c) => c.id)).toEqual(
      ["col_3"],
    );
    // The positive twin: a numeric-VALUED legacy column that is not the sort
    // role stays text, exactly as before roles existed.
    expect(columns.find((c) => c.id === "col_7")?.type).toBe("text");
    const s8 = createScenarioDataset("S8", { scale: "smoke" });
    const s8Columns = createBenchModelColumns(s8, true);
    expect(s8Columns.filter((c) => c.type === "number")).toHaveLength(30);
    expect(s8Columns.find((c) => c.id === "marketValue")).toMatchObject({
      aggregate: "sum",
    });
    expect(s8Columns.find((c) => c.id === "dayPnl")?.aggregate).toBeUndefined();
    expect(
      createBenchModelColumns(s5, true).find((c) => c.id === "col_3"),
    ).toMatchObject({ aggregate: "sum" });
  });

  test("tracks group counts under a two-level tuple key", async () => {
    const dataset = createScenarioDataset("S8", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 808,
      roles: dataset.roles,
    });
    const controller = createRowModelDiagnosticsController({ dataset, plan });
    const first = dataset.rows[0]!;
    const oldLeafSize = dataset.rows.filter(
      (r) => r.strategy === first.strategy && r.sector === first.sector,
    ).length;
    // Move one row to a brand-new (strategy, sector) leaf.
    controller.model.applyTransaction({
      update: [{ id: String(first.id), changes: { sector: "Nowhere" } }],
    });
    // 88 leaves before; +1 new leaf, −1 if the old leaf is now empty.
    const expectedLeaves = 88 + 1 - (oldLeafSize === 1 ? 1 : 0);
    expect(await readGroupCount(controller)).toBe(expectedLeaves);
    // A change to a NON-group column must not move the row.
    controller.model.applyTransaction({
      update: [{ id: String(dataset.rows[1]!.id), changes: { lastPrice: 1 } }],
    });
    expect(await readGroupCount(controller)).toBe(expectedLeaves);
    controller.dispose();
  });

  test("captures exactly the next armed query transition", async () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 505,
      roles: dataset.roles,
    });
    const scheduled: (() => void)[] = [];
    let now = 0;
    const controller = createRowModelDiagnosticsController({
      dataset,
      plan,
      now: () => now,
      scheduler: {
        schedule(task) {
          scheduled.push(task);
          return () => undefined;
        },
      },
    });
    const groupedQuery = {
      ...controller.model.getState().snapshot.query,
      rowGroups: [{ columnId: "col_1" as const }],
      sort: [{ columnId: "col_3" as const, direction: "desc" as const }],
    };

    expect(controller.readQueryTransition()).toBeNull();
    controller.model.setQuery(controller.model.getState().snapshot.query);
    expect(controller.readQueryTransition()).toBeNull();

    controller.armNextQueryTransition();
    now = 3;
    const transition = controller.model.setQuery(groupedQuery);
    expect(controller.readQueryTransition()).toMatchObject({
      status: "running",
      startedAt: 3,
      completedAt: null,
    });

    now = 8;
    flushScheduled(scheduled);
    await transition.finished;
    await Promise.resolve();

    const completed = controller.readQueryTransition();
    expect(completed).toMatchObject({
      status: "completed",
      startedAt: 3,
      completedAt: 8,
      durationMs: 5,
      rowsEvaluated: expect.any(Number),
      transitionRows: expect.any(Number),
      sliceCount: expect.any(Number),
      sliceTotalMs: expect.any(Number),
      sliceP95Ms: expect.any(Number),
      sliceMaxMs: expect.any(Number),
      schedulerWaitCount: expect.any(Number),
      schedulerWaitTotalMs: expect.any(Number),
      schedulerWaitP95Ms: expect.any(Number),
      schedulerWaitMaxMs: expect.any(Number),
      residualMs: expect.any(Number),
    });
    expect(Object.isFrozen(completed)).toBe(true);
    expect(completed?.residualMs).toBeGreaterThanOrEqual(0);
    const runSummary = controller.createRunSummary();
    expect(runSummary.queryTransition).not.toHaveProperty("startedAt");
    expect(runSummary.queryTransition).not.toHaveProperty("completedAt");

    controller.disarmQueryTransition();
    controller.model.setQuery(controller.model.getState().snapshot.query);
    expect(controller.readQueryTransition()).toBeNull();
    controller.dispose();
  });

  test("classifies cancelled and rejected armed query transitions", async () => {
    const dataset = createScenarioDataset("S5", { scale: "dev" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 505,
      roles: dataset.roles,
    });
    const scheduled: (() => void)[] = [];
    const controller = createRowModelDiagnosticsController({
      dataset,
      plan,
      scheduler: {
        schedule(task) {
          scheduled.push(task);
          return () => undefined;
        },
      },
    });
    const groupedQuery = {
      ...controller.model.getState().snapshot.query,
      rowGroups: [{ columnId: "col_1" as const }],
      sort: [{ columnId: "col_3" as const, direction: "desc" as const }],
    };

    controller.armNextQueryTransition();
    const cancelled = controller.model.setQuery(groupedQuery);
    cancelled.cancel();
    await expect(cancelled.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
    });
    await Promise.resolve();
    expect(controller.readQueryTransition()?.status).toBe("cancelled");

    controller.armNextQueryTransition();
    expect(() =>
      controller.model.setQuery({
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "missing" }],
      } as never),
    ).toThrow();
    await Promise.resolve();
    expect(controller.readQueryTransition()?.status).toBe("error");
    controller.dispose();
  });

  test("arming again clears the previous capture and resets its work", async () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 505,
      roles: dataset.roles,
    });
    const scheduled: (() => void)[] = [];
    const controller = createRowModelDiagnosticsController({
      dataset,
      plan,
      scheduler: {
        schedule(task) {
          scheduled.push(task);
          return () => undefined;
        },
      },
    });

    controller.armNextQueryTransition();
    const transition = controller.model.setQuery({
      ...controller.model.getState().snapshot.query,
      rowGroups: [{ columnId: "col_1" }],
      sort: [{ columnId: "col_3", direction: "desc" }],
    } as never);
    flushScheduled(scheduled);
    await transition.finished;
    await Promise.resolve();
    expect(controller.readQueryTransition()?.status).toBe("completed");

    controller.armNextQueryTransition();
    expect(controller.readQueryTransition()).toBeNull();
    expect(controller.read().work.rowsEvaluated).toBe(0);
    expect(controller.read().work.schedulerSliceDurations).toEqual([]);
    expect(controller.read().work.schedulerWaitDurations).toEqual([]);
    controller.dispose();
  });
});
