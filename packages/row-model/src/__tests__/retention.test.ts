import { describe, expect, test } from "vitest";

import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import { createColumnHelper } from "../index";

interface RetentionRow {
  id: number;
  team: string;
  score: number;
  label: string;
}

const helper = createColumnHelper<RetentionRow>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text" }),
] as const;

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly pending: { task: () => void; cancelled: boolean }[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushAll(): void {
    for (;;) {
      const entry = this.pending.shift();
      if (entry === undefined) return;
      if (!entry.cancelled) entry.task();
    }
  }
}

function tickingClock() {
  let value = 0;
  return () => value++;
}

describe("instrumented local row-model retention", () => {
  test("retains only the current root, explicit snapshots, and bounded journal", () => {
    const instrumented = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 100 }, (_, id) => ({
        id,
        team: `team-${id % 5}`,
        score: id,
        label: `row-${id}`,
      })),
      columns,
      changeJournalCapacity: 8,
    });
    const releases = [
      instrumented.diagnostics.retainSnapshot(
        instrumented.model.getState().snapshot,
      ),
    ];
    for (let revision = 0; revision < 10_000; revision += 1) {
      instrumented.model.applyTransaction({
        update: [
          {
            id: revision % 100,
            changes: { label: `revision-${revision}` },
          },
        ],
      });
      if (revision === 4_999) {
        releases.push(
          instrumented.diagnostics.retainSnapshot(
            instrumented.model.getState().snapshot,
          ),
        );
      }
    }

    expect(instrumented.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 1,
      explicitlyRetainedSnapshotCount: 2,
      consumerJournalEntryCount: 8,
      transitionCandidateRootCount: 0,
      transitionDeltaRootCount: 0,
    });
    releases.forEach((release) => release());
    expect(
      instrumented.diagnostics.read().retention.explicitlyRetainedSnapshotCount,
    ).toBe(0);
  });

  test("releases cancelled transitions, distinct work, and scheduled callbacks", async () => {
    const scheduler = new ManualScheduler();
    const instrumented = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 500 }, (_, id) => ({
        id,
        team: `team-${id % 20}`,
        score: id,
        label: `row-${id}`,
      })),
      columns,
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      distinctValueCacheCapacity: 2,
    });

    for (const [columnId, population] of [
      ["team", "all"],
      ["team", "filtered"],
      ["label", "all"],
      ["label", "filtered"],
    ] as const) {
      const query = instrumented.model.distinctValues(columnId, {
        population,
        limit: 10,
      });
      scheduler.flushAll();
      await query.finished;
    }
    expect(instrumented.diagnostics.read().retention).toMatchObject({
      distinctCacheEntryCount: 2,
      distinctDictionaryRootCount: 2,
      distinctProjectionRootCount: 0,
    });
    const cancelledProjection = instrumented.model.distinctValues("label", {
      population: "filtered",
      search: "row-1",
      limit: 1,
    });
    cancelledProjection.cancel();
    await expect(cancelledProjection.finished).rejects.toBeDefined();
    scheduler.flushAll();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const superseded = instrumented.model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: attempt + 1 }],
        sort: [],
        rowGroups: [],
      });
      const replacement = instrumented.model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: attempt + 101 }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      });
      await expect(superseded.finished).rejects.toMatchObject({
        reason: "superseded",
      });
      replacement.cancel();
      await expect(replacement.finished).rejects.toMatchObject({
        reason: "cancelled",
      });
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const transition = instrumented.model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: attempt % 10 }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      });
      instrumented.model.applyTransaction({
        update: [{ id: attempt, changes: { score: 1_000 + attempt } }],
      });
      transition.cancel();
      await expect(transition.finished).rejects.toMatchObject({
        reason: "cancelled",
      });

      const distinct = instrumented.model.distinctValues("team", {
        search: String(attempt),
        limit: 10,
      });
      distinct.cancel();
      await expect(distinct.finished).rejects.toBeDefined();
    }
    scheduler.flushAll();

    const retained = instrumented.diagnostics.read().retention;
    expect(retained).toMatchObject({
      transitionCandidateRootCount: 0,
      transitionDeltaRootCount: 0,
      distinctProjectionRootCount: 0,
      scheduledCallbackCount: 0,
    });
    expect(retained.distinctCacheEntryCount).toBeLessThanOrEqual(2);
    expect(retained.distinctDictionaryRootCount).toBeLessThanOrEqual(2);
    const work = instrumented.diagnostics.read().work;
    expect(work.transitionRows).toBeGreaterThan(0);
    expect(work.schedulerSliceDurations.length).toBeGreaterThan(0);
    expect(
      work.schedulerSliceDurations.every(
        (duration) => Number.isFinite(duration) && duration >= 0,
      ),
    ).toBe(true);
    instrumented.model.dispose();
    expect(instrumented.diagnostics.read().retention).toMatchObject({
      // The disposed model deliberately retains its readable final snapshot.
      liveRevisionRootCount: 1,
      consumerJournalEntryCount: 0,
      transitionCandidateRootCount: 0,
      transitionDeltaRootCount: 0,
      distinctCacheEntryCount: 0,
      distinctDictionaryRootCount: 0,
      distinctProjectionRootCount: 0,
      scheduledCallbackCount: 0,
    });
  });
});
