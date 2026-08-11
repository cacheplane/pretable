import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  createBenchRowModelOwner,
  createRowModelDiagnosticsController,
} from "../row-model-diagnostics";
import { createDeterministicUpdatePlan } from "../update-plan";

describe("bench-only row-model diagnostics", () => {
  test("uses an ordinary model without constructing diagnostics unless opted in", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const owner = createBenchRowModelOwner({
      dataset,
      diagnostics: false,
      plan: createDeterministicUpdatePlan({
        dataset,
        grouped: false,
        seed: 505,
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
      }),
      changeJournalCapacity: 2,
      distinctValueCacheCapacity: 1,
    });

    await controller.churnRetentionLimits();
    const snapshot = controller.read();

    expect(snapshot.retention.consumerJournalEntryCount).toBeLessThanOrEqual(2);
    expect(snapshot.retention.distinctCacheEntryCount).toBeLessThanOrEqual(1);
    expect(snapshot.retention.liveRevisionRootCount).toBe(1);
    controller.dispose();
  });

  test("proves the final checksum contains every seeded patch", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: false,
      seed: 91_337,
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
});
