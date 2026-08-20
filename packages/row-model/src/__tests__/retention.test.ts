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
  test("releases scheduler ownership when schedule delegation throws", async () => {
    const schedulingFailure = new Error("scheduler delegation exploded");
    const instrumented = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        team: `team-${id % 2}`,
        score: id,
        label: `row-${id}`,
      })),
      columns,
      transitionScheduler: {
        schedule(): () => void {
          throw schedulingFailure;
        },
      },
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });

    const transition = instrumented.model.setQuery({
      // Filter change keeps the query off the #457 sort-only fast path;
      // these tests exercise cooperative scheduler ownership.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    await expect(transition.finished).rejects.toMatchObject({
      code: "derivation-failed",
      operation: "set-query",
      cause: schedulingFailure,
    });
    expect(instrumented.model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "error" },
    });
    expect(instrumented.diagnostics.read().retention).toMatchObject({
      transitionCandidateRootCount: 0,
      transitionDeltaRootCount: 0,
      scheduledCallbackCount: 0,
    });
    instrumented.model.dispose();
  });

  test("completes explicit cancellation when its queued hook throws", async () => {
    const cancellationFailure = new Error("scheduler cancellation exploded");
    let staleTask: (() => void) | undefined;
    const instrumented = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        team: `team-${id % 2}`,
        score: id,
        label: `row-${id}`,
      })),
      columns,
      transitionScheduler: {
        schedule(task): () => void {
          staleTask = task;
          return () => {
            throw cancellationFailure;
          };
        },
      },
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    let notifications = 0;
    instrumented.model.subscribe(() => {
      notifications += 1;
    });
    const transition = instrumented.model.setQuery({
      // Filter change keeps the query off the #457 sort-only fast path;
      // these tests exercise cooperative scheduler ownership.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    expect(
      instrumented.diagnostics.read().retention.scheduledCallbackCount,
    ).toBe(1);
    expect(() => transition.cancel()).not.toThrow();
    await expect(transition.finished).rejects.toMatchObject({
      reason: "cancelled",
    });
    expect(instrumented.model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "ready" },
    });
    expect(notifications).toBe(2);
    expect(
      instrumented.diagnostics.read().retention.scheduledCallbackCount,
    ).toBe(0);
    expect(instrumented.diagnostics.read().retention).toMatchObject({
      transitionCandidateRootCount: 0,
      transitionDeltaRootCount: 0,
    });
    const cancelledState = instrumented.model.getState();
    staleTask?.();
    expect(instrumented.model.getState()).toBe(cancelledState);
    expect(notifications).toBe(2);
    instrumented.model.dispose();
  });

  test("handles synchronous scheduling without crossing model ownership", async () => {
    const synchronous = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        team: `team-${id % 2}`,
        score: id,
        label: `row-${id}`,
      })),
      columns,
      transitionScheduler: {
        schedule(task): () => void {
          task();
          return () => undefined;
        },
      },
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    const synchronousTransition = synchronous.model.setQuery({
      // Filter change keeps the query off the #457 sort-only fast path;
      // these tests exercise cooperative scheduler ownership.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    await expect(synchronousTransition.finished).rejects.toMatchObject({
      code: "reentrant-mutation",
      operation: "set-query",
    });
    expect(synchronous.diagnostics.read().retention).toMatchObject({
      transitionCandidateRootCount: 0,
      scheduledCallbackCount: 0,
    });
    expect(synchronous.model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "error" },
    });

    const firstScheduler = new ManualScheduler();
    const secondScheduler = new ManualScheduler();
    const first = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        team: "first",
        score: id,
        label: `row-${id}`,
      })),
      columns,
      transitionScheduler: firstScheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    const second = createInstrumentedLocalRowModel({
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        team: "second",
        score: id,
        label: `row-${id}`,
      })),
      columns,
      transitionScheduler: secondScheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    const firstTransition = first.model.setQuery({
      // Filter change keeps the query off the #457 sort-only fast path;
      // these tests exercise cooperative scheduler ownership.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    const secondTransition = second.model.setQuery({
      // Filter change keeps the query off the #457 sort-only fast path;
      // these tests exercise cooperative scheduler ownership.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    expect(first.diagnostics.read().retention.scheduledCallbackCount).toBe(1);
    expect(second.diagnostics.read().retention.scheduledCallbackCount).toBe(1);
    firstTransition.cancel();
    await expect(firstTransition.finished).rejects.toMatchObject({
      reason: "cancelled",
    });
    expect(first.diagnostics.read().retention.scheduledCallbackCount).toBe(0);
    expect(second.diagnostics.read().retention.scheduledCallbackCount).toBe(1);
    secondTransition.cancel();
    await expect(secondTransition.finished).rejects.toMatchObject({
      reason: "cancelled",
    });
    expect(second.diagnostics.read().retention.scheduledCallbackCount).toBe(0);
    synchronous.model.dispose();
    first.model.dispose();
    second.model.dispose();
  });

  test("tracks only validated model snapshots and their exact revision roots", () => {
    const first = createInstrumentedLocalRowModel({
      rows: [{ id: 0, team: "red", score: 0, label: "initial" }],
      columns,
    });
    const foreign = createInstrumentedLocalRowModel({
      rows: [{ id: 0, team: "blue", score: 0, label: "foreign" }],
      columns,
    });

    expect(() =>
      first.diagnostics.retainSnapshot(
        {} as ReturnType<typeof first.model.getState>["snapshot"],
      ),
    ).toThrow(TypeError);
    expect(() =>
      first.diagnostics.retainSnapshot(foreign.model.getState().snapshot),
    ).toThrow(TypeError);

    const snapshots = [first.model.getState().snapshot];
    for (let revision = 1; revision < 6; revision += 1) {
      first.model.applyTransaction({
        update: [{ id: 0, changes: { label: `revision-${revision}` } }],
      });
      snapshots.push(first.model.getState().snapshot);
    }
    const releases = snapshots.map((snapshot) =>
      first.diagnostics.retainSnapshot(snapshot),
    );
    const duplicateRelease = first.diagnostics.retainSnapshot(snapshots[0]!);
    first.model.applyTransaction({
      update: [{ id: 0, changes: { label: "unretained-current" } }],
    });

    expect(first.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 7,
      explicitlyRetainedSnapshotCount: 6,
    });
    releases[0]!();
    releases[0]!();
    expect(first.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 7,
      explicitlyRetainedSnapshotCount: 6,
    });
    duplicateRelease();
    duplicateRelease();
    expect(first.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 6,
      explicitlyRetainedSnapshotCount: 5,
    });
    releases.slice(1).forEach((release) => release());
    expect(first.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 1,
      explicitlyRetainedSnapshotCount: 0,
    });

    const disposedRelease = first.diagnostics.retainSnapshot(
      first.model.getState().snapshot,
    );
    first.model.dispose();
    expect(first.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 1,
      explicitlyRetainedSnapshotCount: 1,
    });
    disposedRelease();
    expect(first.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 1,
      explicitlyRetainedSnapshotCount: 0,
    });
    foreign.model.dispose();
  });

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
      liveRevisionRootCount: 3,
      explicitlyRetainedSnapshotCount: 2,
      consumerJournalEntryCount: 8,
      transitionCandidateRootCount: 0,
      transitionDeltaRootCount: 0,
    });
    releases.forEach((release) => release());
    expect(instrumented.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 1,
      explicitlyRetainedSnapshotCount: 0,
    });
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
    expect(instrumented.diagnostics.read().retention).toMatchObject({
      liveRevisionRootCount: 1,
      distinctProjectionRootCount: 1,
      transitionCandidateRootCount: 0,
    });
    cancelledProjection.cancel();
    await expect(cancelledProjection.finished).rejects.toBeDefined();
    scheduler.flushAll();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const superseded = instrumented.model.setQuery({
        // Filter AND sort change: either alone commits synchronously (#457
        // fast paths) and there would be nothing pending to supersede.
        filters: [{ columnId: "score", operator: "gte", value: attempt + 1 }],
        sort: [{ columnId: "score", direction: "asc" }],
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
      if (attempt === 0) {
        expect(instrumented.diagnostics.read().retention).toMatchObject({
          liveRevisionRootCount: 1,
          transitionCandidateRootCount: 1,
          transitionDeltaRootCount: 1,
          distinctProjectionRootCount: 0,
        });
      }
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
