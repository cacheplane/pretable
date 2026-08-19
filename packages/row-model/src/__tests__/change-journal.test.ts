import { describe, expect, test, vi } from "vitest";

import * as publicRowModelApi from "../index";
import {
  PretableDisposedModelError,
  createColumnHelper,
  createLocalRowModel,
  type CreateLocalRowModelOptions,
  type CreateLocalRowModelWithDefaultIdOptions,
  type PretableChangeOperation,
  type PretableGroupId,
  type PretableVisibleRowRef,
} from "../index";
import {
  createChangeJournal,
  getChangeJournalDiagnosticsForTesting,
} from "../change-journal";
import { getLocalRowModelChangeJournalDiagnosticsForTesting } from "../create-local-row-model";
import { getTransactionChangeDiagnosticsForTesting } from "../transaction-draft";

interface Row {
  id: number;
  team: string;
  score: number;
  label: string;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text" }),
] as const;

const data = (rowId: number): PretableVisibleRowRef<number> => ({
  kind: "data",
  rowId,
});

function refs(model: ReturnType<typeof flatModel>) {
  return model
    .getState()
    .snapshot.range(0, Number.POSITIVE_INFINITY)
    .map((row) =>
      row.kind === "data"
        ? ({ kind: "data", rowId: row.rowId } as const)
        : ({ kind: "group", groupId: row.groupId } as const),
    );
}

function applyOperations(
  previous: readonly PretableVisibleRowRef<number>[],
  operations: readonly PretableChangeOperation<number>[],
) {
  const next = [...previous];
  for (const operation of operations) {
    switch (operation.kind) {
      case "insert":
        next.splice(operation.index, 0, operation.ref);
        break;
      case "remove":
        expect(next[operation.previousIndex]).toEqual(operation.ref);
        next.splice(operation.previousIndex, 1);
        break;
      case "move": {
        expect(next[operation.previousIndex]).toEqual(operation.ref);
        const [ref] = next.splice(operation.previousIndex, 1);
        next.splice(operation.index, 0, ref!);
        break;
      }
      case "update":
        expect(
          next[operation.index],
          JSON.stringify({ operation, operations, current: next }),
        ).toEqual(operation.ref);
        break;
    }
  }
  return next;
}

function flatModel(changeJournalCapacity = 32) {
  return createLocalRowModel({
    rows: [
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "B", score: 3, label: "three" },
    ],
    columns,
    changeJournalCapacity,
    query: {
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    },
  });
}

function groupedModel(changeJournalCapacity = 32) {
  return createLocalRowModel({
    rows: [
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "B", score: 3, label: "three" },
    ],
    columns,
    changeJournalCapacity,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [{ columnId: "team" }],
    },
  });
}

describe("bounded revision change journal", () => {
  test("keeps local journal diagnostics out of the package public surface", () => {
    type ExplicitIdOptions = CreateLocalRowModelOptions<typeof columns, number>;
    type DefaultIdOptions = CreateLocalRowModelWithDefaultIdOptions<
      typeof columns
    >;

    expect(publicRowModelApi.createLocalRowModel).toBe(createLocalRowModel);
    expect(
      "getLocalRowModelChangeJournalDiagnosticsForTesting" in publicRowModelApi,
    ).toBe(false);
    expect(null as ExplicitIdOptions | DefaultIdOptions | null).toBeNull();
  });

  test("returns a frozen empty sequence at the current revision", () => {
    const model = flatModel();

    const sequence = model.changesSince(0);

    expect(sequence).toEqual({
      kind: "changes",
      fromRevision: 0,
      toRevision: 0,
      changes: [],
    });
    expect(Object.isFrozen(sequence)).toBe(true);
    expect(
      sequence.kind === "changes" && Object.isFrozen(sequence.changes),
    ).toBe(true);
  });

  test("publishes exact sequential flat remove, move, row update, and insert operations", () => {
    const model = flatModel();
    const before = refs(model);

    model.applyTransaction({
      remove: [2],
      update: [{ id: 1, changes: { score: 4, label: "ONE" } }],
      add: [{ id: 4, team: "C", score: 0, label: "four" }],
    });

    const sequence = model.changesSince(0);
    expect(sequence).toEqual({
      kind: "changes",
      fromRevision: 0,
      toRevision: 1,
      changes: [
        {
          previousRevision: 0,
          revision: 1,
          operations: [
            { kind: "remove", ref: data(2), previousIndex: 1 },
            {
              kind: "move",
              ref: data(1),
              previousIndex: 0,
              index: 1,
            },
            { kind: "update", ref: data(1), index: 1, fields: ["row"] },
            { kind: "insert", ref: data(4), index: 0 },
          ],
        },
      ],
    });
    if (sequence.kind !== "changes") throw new Error("expected changes");
    expect(applyOperations(before, sequence.changes[0]!.operations)).toEqual(
      refs(model),
    );
    expect(Object.isFrozen(sequence.changes[0]?.operations)).toBe(true);
    expect(
      sequence.changes[0]?.operations.every(
        (operation) =>
          Object.isFrozen(operation) && Object.isFrozen(operation.ref),
      ),
    ).toBe(true);
  });

  test("reports display-only flat updates without structural work", () => {
    const model = flatModel();

    model.applyTransaction({
      update: [{ id: 2, changes: { label: "TWO" } }],
    });

    expect(model.changesSince(0)).toMatchObject({
      kind: "changes",
      changes: [
        {
          previousRevision: 0,
          revision: 1,
          operations: [
            { kind: "update", ref: data(2), index: 1, fields: ["row"] },
          ],
        },
      ],
    });
  });

  test("publishes grouped structural operations and aggregate/count updates", () => {
    const model = groupedModel();
    const before = refs(model);

    model.applyTransaction({
      update: [{ id: 1, changes: { team: "B", score: 4 } }],
    });

    const sequence = model.changesSince(0);
    if (sequence.kind !== "changes") throw new Error("expected changes");
    const operations = sequence.changes[0]!.operations;
    expect(applyOperations(before, operations)).toEqual(refs(model));
    expect(operations).toContainEqual({
      kind: "update",
      ref: {
        kind: "group",
        groupId: "__group__:team=s:A" as PretableGroupId,
      },
      index: 0,
      fields: ["aggregates", "childCount"],
    });
    expect(operations).toContainEqual(
      expect.objectContaining({
        kind: "update",
        ref: {
          kind: "group",
          groupId: "__group__:team=s:B" as PretableGroupId,
        },
        fields: ["aggregates", "childCount"],
      }),
    );
  });

  test("uses current sequential ranks for a grouped remove followed by move and update", () => {
    const model = createLocalRowModel({
      rows: [
        { id: 58, team: "A", score: 0, label: "58" },
        { id: 35, team: "A", score: 1, label: "35" },
        { id: 54, team: "A", score: 2, label: "54" },
      ],
      columns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team" }],
      },
    });
    const before = refs(model);

    model.applyTransaction({
      remove: [58],
      update: [{ id: 35, changes: { score: 3, label: "THIRTY FIVE" } }],
    });

    const sequence = model.changesSince(0);
    if (sequence.kind !== "changes") throw new Error("expected changes");
    expect(sequence.changes[0]?.operations).toEqual([
      { kind: "remove", ref: data(58), previousIndex: 1 },
      { kind: "move", ref: data(35), previousIndex: 1, index: 2 },
      {
        kind: "update",
        ref: {
          kind: "group",
          groupId: "__group__:team=s:A" as PretableGroupId,
        },
        index: 0,
        fields: ["aggregates", "childCount"],
      },
      { kind: "update", ref: data(35), index: 2, fields: ["row"] },
    ]);
    expect(applyOperations(before, sequence.changes[0]!.operations)).toEqual(
      refs(model),
    );
  });

  test("uses a canonical move plus row update for a simple grouped reorder", () => {
    const model = groupedModel();
    const before = refs(model);

    model.applyTransaction({
      update: [{ id: 1, changes: { score: 4, label: "ONE" } }],
    });

    const sequence = model.changesSince(0);
    if (sequence.kind !== "changes") throw new Error("expected changes");
    expect(sequence.changes[0]?.operations).toContainEqual({
      kind: "move",
      ref: data(1),
      previousIndex: 1,
      index: 2,
    });
    expect(sequence.changes[0]?.operations).toContainEqual({
      kind: "update",
      ref: data(1),
      index: 2,
      fields: ["row"],
    });
    expect(applyOperations(before, sequence.changes[0]!.operations)).toEqual(
      refs(model),
    );
  });

  test("replays one nested batch with removal, move, update, filtering, prune, and creation", () => {
    const model = createLocalRowModel({
      rows: [
        { id: 58, team: "A", score: 0, label: "old" },
        { id: 35, team: "A", score: 1, label: "move" },
        { id: 54, team: "B", score: 2, label: "hide" },
      ],
      columns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team" }, { columnId: "label" }],
      },
    });
    const before = refs(model);

    model.applyTransaction({
      remove: [58],
      update: [
        { id: 35, changes: { team: "B", label: "moved", score: 3 } },
        { id: 54, changes: { score: -1 } },
      ],
      add: [{ id: 99, team: "C", score: 1, label: "new" }],
    });

    const sequence = model.changesSince(0);
    if (sequence.kind !== "changes") throw new Error("expected changes");
    const operations = sequence.changes[0]!.operations;
    expect(applyOperations(before, operations)).toEqual(refs(model));
    expect(operations).toContainEqual(
      expect.objectContaining({ kind: "move", ref: data(35) }),
    );
    expect(operations).toContainEqual({
      kind: "update",
      ref: data(35),
      index: model.getState().snapshot.indexOf(data(35)),
      fields: ["row"],
    });
    expect(operations).toContainEqual(
      expect.objectContaining({ kind: "remove", ref: data(58) }),
    );
    expect(operations).toContainEqual(
      expect.objectContaining({ kind: "remove", ref: data(54) }),
    );
    expect(operations).toContainEqual(
      expect.objectContaining({ kind: "insert", ref: data(99) }),
    );
  });

  test("publishes exact descendant removals/inserts and expanded field changes", () => {
    const model = groupedModel();
    const groupId = "__group__:team=s:A" as PretableGroupId;
    const before = refs(model);

    model.setGroupExpanded(groupId, false);

    const collapsed = model.changesSince(0);
    if (collapsed.kind !== "changes") throw new Error("expected changes");
    expect(applyOperations(before, collapsed.changes[0]!.operations)).toEqual(
      refs(model),
    );
    expect(collapsed.changes[0]?.operations).toContainEqual({
      kind: "update",
      ref: { kind: "group", groupId },
      index: 0,
      fields: ["expanded"],
    });
    expect(
      collapsed.changes[0]?.operations.filter(
        (operation) => operation.kind === "remove",
      ),
    ).toEqual([
      { kind: "remove", ref: data(2), previousIndex: 2 },
      { kind: "remove", ref: data(1), previousIndex: 1 },
    ]);

    const collapsedRefs = refs(model);
    model.setGroupExpanded(groupId, true);
    const expanded = model.changesSince(1);
    if (expanded.kind !== "changes") throw new Error("expected changes");
    expect(
      applyOperations(collapsedRefs, expanded.changes[0]!.operations),
    ).toEqual(refs(model));
    expect(
      expanded.changes[0]?.operations.filter(
        (operation) => operation.kind === "insert",
      ),
    ).toEqual([
      { kind: "insert", ref: data(1), index: 1 },
      { kind: "insert", ref: data(2), index: 2 },
    ]);
  });

  test("retains a bounded contiguous suffix and handles malformed, future, and evicted revisions", () => {
    const model = flatModel(2);
    model.applyTransaction({ update: [{ id: 1, changes: { label: "a" } }] });
    model.applyTransaction({ update: [{ id: 1, changes: { label: "b" } }] });
    model.applyTransaction({ update: [{ id: 1, changes: { label: "c" } }] });

    expect(model.changesSince(1)).toMatchObject({
      kind: "changes",
      fromRevision: 1,
      toRevision: 3,
      changes: [
        { previousRevision: 1, revision: 2 },
        { previousRevision: 2, revision: 3 },
      ],
    });
    expect(model.changesSince(0)).toEqual({
      kind: "reset",
      toRevision: 3,
      reason: "journal-evicted",
    });
    for (const revision of [-1, 1.5, Number.NaN, 4]) {
      expect(model.changesSince(revision)).toEqual({
        kind: "reset",
        toRevision: 3,
        reason: "unknown-revision",
      });
    }
  });

  test("capacity zero retains no entry while the current revision remains readable", () => {
    const model = flatModel(0);
    model.applyTransaction({ update: [{ id: 1, changes: { label: "a" } }] });

    expect(model.changesSince(0)).toEqual({
      kind: "reset",
      toRevision: 1,
      reason: "journal-evicted",
    });
    expect(model.changesSince(1)).toEqual({
      kind: "changes",
      fromRevision: 1,
      toRevision: 1,
      changes: [],
    });
  });

  test("lets callers resume after a retained barrier and degrades to eviction when that barrier expires", () => {
    const journal = createChangeJournal<number>(2);
    journal.appendBarrier(0, 1);
    journal.appendChanges(1, 2, [{ kind: "insert", ref: data(1), index: 0 }]);

    expect(journal.changesSince(0, 2)).toMatchObject({
      kind: "reset",
      reason: "bulk-replace",
    });
    expect(journal.changesSince(1, 2)).toMatchObject({
      kind: "changes",
      changes: [{ previousRevision: 1, revision: 2 }],
    });

    journal.appendChanges(2, 3, [{ kind: "insert", ref: data(2), index: 1 }]);
    expect(journal.changesSince(0, 3)).toMatchObject({
      kind: "reset",
      reason: "journal-evicted",
    });
  });

  test('a range of only "reorder" barriers resets with reason "reorder"', () => {
    const journal = createChangeJournal<number>(4);
    journal.appendBarrier(0, 1, "reorder");

    expect(journal.changesSince(0, 1)).toEqual({
      kind: "reset",
      toRevision: 1,
      reason: "reorder",
    });

    journal.appendBarrier(1, 2, "reorder");
    expect(journal.changesSince(0, 2)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "reorder",
    });
    // A sub-range that is still all-reorder reports "reorder" too.
    expect(journal.changesSince(1, 2)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "reorder",
    });
  });

  test('a changes entry in the range demotes "reorder" to "bulk-replace" (both orders)', () => {
    const changesFirst = createChangeJournal<number>(4);
    changesFirst.appendChanges(0, 1, [
      { kind: "insert", ref: data(1), index: 0 },
    ]);
    changesFirst.appendBarrier(1, 2, "reorder");
    expect(changesFirst.changesSince(0, 2)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "bulk-replace",
    });

    const reorderFirst = createChangeJournal<number>(4);
    reorderFirst.appendBarrier(0, 1, "reorder");
    reorderFirst.appendChanges(1, 2, [
      { kind: "insert", ref: data(1), index: 0 },
    ]);
    expect(reorderFirst.changesSince(0, 2)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "bulk-replace",
    });
    // Resuming from PAST the reorder barrier replays the plain changes.
    expect(reorderFirst.changesSince(1, 2)).toMatchObject({
      kind: "changes",
      changes: [{ previousRevision: 1, revision: 2 }],
    });
  });

  test('a non-"reorder" barrier in the range wins over "reorder" (both orders)', () => {
    const reorderFirst = createChangeJournal<number>(4);
    reorderFirst.appendBarrier(0, 1, "reorder");
    reorderFirst.appendBarrier(1, 2);
    expect(reorderFirst.changesSince(0, 2)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "bulk-replace",
    });

    const barrierFirst = createChangeJournal<number>(4);
    barrierFirst.appendBarrier(0, 1);
    barrierFirst.appendBarrier(1, 2, "reorder");
    expect(barrierFirst.changesSince(0, 2)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "bulk-replace",
    });
  });

  test("rejects malformed or non-contiguous append pairs without changing retained state", () => {
    const journal = createChangeJournal<number>(1);
    journal.appendChanges(0, 1, [{ kind: "insert", ref: data(1), index: 0 }]);
    const before = journal.changesSince(0, 1);

    for (const [previousRevision, revision] of [
      [1, 1],
      [1, 3],
      [0, 2],
      [-1, 0],
      [1.5, 2],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1],
    ]) {
      expect(() =>
        journal.appendChanges(previousRevision, revision, []),
      ).toThrow(RangeError);
    }
    expect(() => journal.appendBarrier(0, 2)).toThrow(RangeError);
    expect(journal.changesSince(0, 1)).toEqual(before);

    journal.appendBarrier(1, 2);
    expect(getChangeJournalDiagnosticsForTesting(journal)).toEqual({
      capacity: 1,
      entryCount: 1,
      latestRevision: 2,
    });
  });

  test("tracks continuity independently of eviction and capacity zero", () => {
    const evicting = createChangeJournal<number>(1);
    evicting.appendChanges(0, 1, []);
    evicting.appendChanges(1, 2, []);
    expect(() => evicting.appendChanges(1, 3, [])).toThrow(RangeError);
    expect(evicting.changesSince(1, 2)).toMatchObject({ kind: "changes" });

    const zero = createChangeJournal<number>(0);
    zero.appendChanges(0, 1, []);
    zero.appendBarrier(1, 2);
    expect(getChangeJournalDiagnosticsForTesting(zero)).toEqual({
      capacity: 0,
      entryCount: 0,
      latestRevision: 2,
    });
    expect(() => zero.appendChanges(1, 3, [])).toThrow(RangeError);
  });

  test("uses bulk barriers for setRows and global query/default-policy replacements", async () => {
    const flat = flatModel();
    flat.applyTransaction({ update: [{ id: 1, changes: { label: "a" } }] });
    flat.setRows([{ id: 9, team: "Z", score: 9, label: "nine" }]);
    expect(flat.changesSince(0)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "bulk-replace",
    });
    expect(flat.changesSince(1)).toEqual({
      kind: "reset",
      toRevision: 2,
      reason: "bulk-replace",
    });

    // A FILTER change: a sort-only change would take the synchronous fast
    // path and journal a "reorder" barrier instead (pinned in
    // sort-fast-path.test.ts).
    const query = flat.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "Z" }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    await query.finished;
    expect(flat.changesSince(2)).toMatchObject({
      kind: "reset",
      reason: "bulk-replace",
    });

    const grouped = groupedModel();
    grouped.collapseAll();
    expect(grouped.changesSince(0)).toMatchObject({
      kind: "reset",
      reason: "bulk-replace",
    });
  });

  test("does not append on semantic no-op or failed preparation", () => {
    const model = flatModel(1);
    const before = model.getState();

    model.applyTransaction({ update: [{ id: 1, changes: { label: "one" } }] });
    expect(() =>
      model.applyTransaction({
        add: [{ id: 1, team: "A", score: 10, label: "duplicate" }],
      }),
    ).toThrow();

    expect(model.getState()).toBe(before);
    expect(model.changesSince(0)).toEqual({
      kind: "changes",
      fromRevision: 0,
      toRevision: 0,
      changes: [],
    });
  });

  test("keeps journal retention independent from captured snapshot roots", () => {
    const model = flatModel(1);
    const captured = model.getState().snapshot;
    model.applyTransaction({ update: [{ id: 1, changes: { label: "a" } }] });
    const first = model.changesSince(0);
    model.applyTransaction({ update: [{ id: 1, changes: { label: "b" } }] });

    expect(captured.revision).toBe(0);
    expect(captured.rowAt(0)).toMatchObject({ row: { label: "one" } });
    expect(first).toMatchObject({ kind: "changes", toRevision: 1 });
    expect(model.changesSince(0)).toMatchObject({
      kind: "reset",
      reason: "journal-evicted",
    });
  });

  test("appends before callbacks so reentrant listener work is a later revision", () => {
    const model = flatModel();
    const listener = vi.fn(() => {
      if (model.getState().snapshot.revision === 1) {
        model.applyTransaction({
          update: [{ id: 2, changes: { label: "listener" } }],
        });
      }
    });
    model.subscribe(listener);

    model.applyTransaction({
      update: [{ id: 1, changes: { label: "outer" } }],
    });

    expect(model.changesSince(0)).toMatchObject({
      kind: "changes",
      toRevision: 2,
      changes: [
        { previousRevision: 0, revision: 1 },
        { previousRevision: 1, revision: 2 },
      ],
    });
  });

  test("leaves final disposed state readable but rejects consumer history commands", () => {
    const model = flatModel();
    const captured = model.getState().snapshot;
    model.applyTransaction({ update: [{ id: 1, changes: { label: "held" } }] });
    expect(
      getLocalRowModelChangeJournalDiagnosticsForTesting(model),
    ).toMatchObject({ entryCount: 1 });
    model.dispose();

    expect(model.getState().status).toEqual({ kind: "disposed" });
    expect(model.getState().snapshot.revision).toBe(1);
    expect(captured.revision).toBe(0);
    expect(captured.rowAt(0)).toMatchObject({ row: { label: "one" } });
    expect(getLocalRowModelChangeJournalDiagnosticsForTesting(model)).toEqual({
      capacity: 32,
      entryCount: 0,
      latestRevision: 1,
    });
    expect(() => model.changesSince(1)).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "changes-since",
      }),
    );
    expect(() => model.changesSince(1)).toThrowError(
      PretableDisposedModelError,
    );
  });

  test("keeps the standalone journal atomic when freezing hostile input throws", () => {
    const journal = createChangeJournal<number>(2);
    const bad = Object.defineProperty({}, "kind", {
      get: () => {
        throw new Error("hostile operation");
      },
    });

    expect(() => journal.appendChanges(0, 1, [bad as never])).toThrow(
      "hostile operation",
    );
    expect(journal.changesSince(0, 0)).toEqual({
      kind: "changes",
      fromRevision: 0,
      toRevision: 0,
      changes: [],
    });
  });

  test("random flat batches replay exactly from every retained revision", () => {
    const model = createLocalRowModel({
      rows: Array.from({ length: 20 }, (_, id) => ({
        id,
        team: String(id % 3),
        score: id,
        label: String(id),
      })),
      columns,
      changeJournalCapacity: 100,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
    });
    const revisions: PretableVisibleRowRef<number>[][] = [refs(model)];
    let seed = 0xdecafbad;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let step = 0; step < 50; step += 1) {
      const id = Math.floor(random() * 20);
      model.applyTransaction({
        update: [
          {
            id,
            changes: { score: Math.floor(random() * 1000), label: `${step}` },
          },
        ],
      });
      revisions.push(refs(model));
    }
    const sequence = model.changesSince(0);
    if (sequence.kind !== "changes") throw new Error("expected changes");
    let replayed = revisions[0]!;
    for (const [index, change] of sequence.changes.entries()) {
      replayed = applyOperations(replayed, change.operations);
      expect(replayed).toEqual(revisions[index + 1]);
    }
  });

  test("random grouped, filtered, sorted, and expansion revisions replay exactly", () => {
    const model = createLocalRowModel({
      rows: Array.from({ length: 30 }, (_, id) => ({
        id,
        team: String(id % 4),
        score: id - 5,
        label: String(id),
      })),
      columns,
      changeJournalCapacity: 100,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team" }],
      },
    });
    let replayed = refs(model);
    let revision = 0;
    let seed = 0xa11ce;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let step = 0; step < 40; step += 1) {
      if (step % 7 === 0) {
        const groupId =
          `__group__:team=s:${Math.floor(random() * 4)}` as PretableGroupId;
        const current = model.getState().snapshot.isGroupExpanded(groupId);
        model.setGroupExpanded(groupId, !current);
      } else {
        const id = Math.floor(random() * 30);
        model.applyTransaction({
          update: [
            {
              id,
              changes: {
                team: String(Math.floor(random() * 4)),
                score: Math.floor(random() * 50) - 10,
                label: `${step}`,
              },
            },
          ],
        });
      }
      const currentRevision = model.getState().snapshot.revision;
      if (currentRevision === revision) continue;
      const sequence = model.changesSince(revision);
      if (sequence.kind !== "changes") throw new Error("expected changes");
      expect(sequence.changes).toHaveLength(1);
      replayed = applyOperations(replayed, sequence.changes[0]!.operations);
      expect(replayed).toEqual(refs(model));
      revision = currentRevision;
    }
  });

  test("replays ordered multi-row grouped batches without stale indices", () => {
    const model = createLocalRowModel({
      rows: Array.from({ length: 40 }, (_, id) => ({
        id,
        team: String(id % 5),
        score: id,
        label: String(id),
      })),
      columns,
      changeJournalCapacity: 100,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team" }],
      },
    });
    let replayed = refs(model);
    let revision = 0;
    for (let batch = 0; batch < 20; batch += 1) {
      model.applyTransaction({
        update: Array.from({ length: 5 }, (_, offset) => {
          const id = (batch * 7 + offset * 3) % 40;
          return {
            id,
            changes: {
              team: String((id + batch + 1) % 5),
              score: (batch % 4 === 0 ? -100 : 1_000) + batch * 5 + offset,
              label: `${batch}:${offset}`,
            },
          };
        }),
      });
      const sequence = model.changesSince(revision);
      if (sequence.kind !== "changes") throw new Error("expected changes");
      expect(sequence.changes).toHaveLength(1);
      replayed = applyOperations(replayed, sequence.changes[0]!.operations);
      expect(
        replayed,
        JSON.stringify({
          batch,
          operations: sequence.changes[0]!.operations,
          final: refs(model),
        }),
      ).toEqual(refs(model));
      revision = model.getState().snapshot.revision;
    }
  });

  test(
    "keeps 50 grouped patches over 100k rows proportional to touched paths",
    { timeout: 30_000 },
    () => {
      const model = createLocalRowModel({
        rows: Array.from({ length: 100_000 }, (_, id) => ({
          id,
          team: String(id % 100),
          score: id,
          label: String(id),
        })),
        columns,
        initialExpansion: { kind: "expanded" },
        query: {
          filters: [],
          sort: [{ columnId: "score", direction: "asc" }],
          rowGroups: [{ columnId: "team" }],
        },
      });

      model.applyTransaction({
        update: Array.from({ length: 50 }, (_, id) => ({
          id,
          changes: { team: String((id + 1) % 100), score: 200_000 + id },
        })),
      });
      const sequence = model.changesSince(0);
      if (sequence.kind !== "changes") throw new Error("expected changes");
      const operations = sequence.changes[0]!.operations;
      const diagnostics = getTransactionChangeDiagnosticsForTesting(operations);

      expect(diagnostics.touchedRefs).toBeLessThanOrEqual(250);
      expect(diagnostics.visibleRowReads).toBeLessThanOrEqual(400);
      expect(operations.length).toBeLessThanOrEqual(350);
    },
  );
});
