import type { PretableRowId } from "./column-types";
import type {
  PretableChangeOperation,
  PretableChangeSequence,
  PretableChangeSet,
  PretableVisibleRowRef,
} from "./types";

export const DEFAULT_CHANGE_JOURNAL_CAPACITY = 128;

export interface ChangeOperationDiagnostics {
  readonly touchedRefs: number;
  readonly visibleRowReads: number;
}

export interface ChangeJournalDiagnostics {
  readonly capacity: number;
  readonly entryCount: number;
  readonly latestRevision: number;
}

const operationDiagnostics = new WeakMap<object, ChangeOperationDiagnostics>();
const journalDiagnostics = new WeakMap<object, ChangeJournalDiagnostics>();

export function attachChangeOperationDiagnosticsForTesting<
  TOperations extends readonly unknown[],
>(
  operations: TOperations,
  diagnostics: ChangeOperationDiagnostics,
): TOperations {
  operationDiagnostics.set(operations, Object.freeze({ ...diagnostics }));
  return operations;
}

export function getChangeOperationDiagnosticsForTesting(
  operations: readonly unknown[],
): ChangeOperationDiagnostics {
  const diagnostics = operationDiagnostics.get(operations);
  if (diagnostics === undefined) {
    throw new TypeError(
      "Diagnostics require generated transaction operations.",
    );
  }
  return diagnostics;
}

export function getChangeJournalDiagnosticsForTesting(
  journal: object,
): ChangeJournalDiagnostics {
  const diagnostics = journalDiagnostics.get(journal);
  if (diagnostics === undefined) {
    throw new TypeError("Diagnostics require a Pretable change journal.");
  }
  return diagnostics;
}

type ResetReason = Extract<
  PretableChangeSequence<PretableRowId>,
  { readonly kind: "reset" }
>["reason"];

type JournalEntry<TRowId extends PretableRowId> =
  | {
      readonly kind: "changes";
      readonly changeSet: PretableChangeSet<TRowId>;
    }
  | {
      readonly kind: "barrier";
      readonly previousRevision: number;
      readonly revision: number;
      readonly reason: ResetReason;
    };

function previousRevisionOf<TRowId extends PretableRowId>(
  entry: JournalEntry<TRowId>,
): number {
  return entry.kind === "changes"
    ? entry.changeSet.previousRevision
    : entry.previousRevision;
}

export interface ChangeJournal<TRowId extends PretableRowId> {
  readonly capacity: number;
  appendChanges(
    previousRevision: number,
    revision: number,
    operations: readonly PretableChangeOperation<TRowId>[],
  ): void;
  appendBarrier(
    previousRevision: number,
    revision: number,
    reason?: ResetReason,
  ): void;
  /** Releases every retained entry while preserving revision continuity. */
  clear(): void;
  changesSince(
    fromRevision: number,
    currentRevision: number,
  ): PretableChangeSequence<TRowId>;
}

function freezeRef<TRowId extends PretableRowId>(
  ref: PretableVisibleRowRef<TRowId>,
): PretableVisibleRowRef<TRowId> {
  return ref.kind === "data"
    ? Object.freeze({ kind: "data" as const, rowId: ref.rowId })
    : Object.freeze({ kind: "group" as const, groupId: ref.groupId });
}

function freezeOperation<TRowId extends PretableRowId>(
  operation: PretableChangeOperation<TRowId>,
): PretableChangeOperation<TRowId> {
  switch (operation.kind) {
    case "insert":
      return Object.freeze({
        kind: "insert" as const,
        ref: freezeRef(operation.ref),
        index: operation.index,
      });
    case "remove":
      return Object.freeze({
        kind: "remove" as const,
        ref: freezeRef(operation.ref),
        previousIndex: operation.previousIndex,
      });
    case "move":
      return Object.freeze({
        kind: "move" as const,
        ref: freezeRef(operation.ref),
        previousIndex: operation.previousIndex,
        index: operation.index,
      });
    case "update":
      return Object.freeze({
        kind: "update" as const,
        ref: freezeRef(operation.ref),
        index: operation.index,
        fields: Object.freeze(Array.from(operation.fields)),
      });
  }
}

function changes<TRowId extends PretableRowId>(
  fromRevision: number,
  toRevision: number,
  changeSets: readonly PretableChangeSet<TRowId>[],
): PretableChangeSequence<TRowId> {
  return Object.freeze({
    kind: "changes" as const,
    fromRevision,
    toRevision,
    changes: Object.freeze(Array.from(changeSets)),
  });
}

function reset<TRowId extends PretableRowId>(
  toRevision: number,
  reason: ResetReason,
): PretableChangeSequence<TRowId> {
  return Object.freeze({ kind: "reset" as const, toRevision, reason });
}

/**
 * A root-independent bounded journal. Entries contain only public row refs and
 * frozen scalar metadata, so retaining or evicting them cannot retain or
 * invalidate persistent revision roots.
 */
export function createChangeJournal<TRowId extends PretableRowId>(
  capacity = DEFAULT_CHANGE_JOURNAL_CAPACITY,
): ChangeJournal<TRowId> {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError(
      "Change journal capacity must be a non-negative integer.",
    );
  }
  let entries: readonly JournalEntry<TRowId>[] = Object.freeze([]);
  let latestRevision = 0;

  function publishDiagnostics(): void {
    journalDiagnostics.set(
      journal,
      Object.freeze({
        capacity,
        entryCount: entries.length,
        latestRevision,
      }),
    );
  }

  const assertContiguous = (
    previousRevision: number,
    revision: number,
  ): void => {
    if (
      !Number.isSafeInteger(previousRevision) ||
      !Number.isSafeInteger(revision) ||
      previousRevision < 0 ||
      revision !== previousRevision + 1 ||
      previousRevision !== latestRevision
    ) {
      throw new RangeError(
        "Change journal entries must be safe, non-negative, and contiguous.",
      );
    }
  };

  const retain = (entry: JournalEntry<TRowId>): void => {
    if (capacity === 0) {
      entries = Object.freeze([]);
      return;
    }
    const next = [...entries, entry];
    entries = Object.freeze(next.slice(Math.max(0, next.length - capacity)));
  };

  const journal: ChangeJournal<TRowId> = {
    capacity,
    appendChanges(
      previousRevision: number,
      revision: number,
      operations: readonly PretableChangeOperation<TRowId>[],
    ) {
      assertContiguous(previousRevision, revision);
      const diagnostics = operationDiagnostics.get(operations);
      const frozenOperations = Object.freeze(
        Array.from(operations, (operation) => freezeOperation(operation)),
      );
      if (diagnostics !== undefined) {
        operationDiagnostics.set(frozenOperations, diagnostics);
      }
      const changeSet = Object.freeze({
        previousRevision,
        revision,
        operations: frozenOperations,
      });
      retain(Object.freeze({ kind: "changes" as const, changeSet }));
      latestRevision = revision;
      publishDiagnostics();
    },
    appendBarrier(
      previousRevision: number,
      revision: number,
      reason: ResetReason = "bulk-replace",
    ) {
      assertContiguous(previousRevision, revision);
      retain(
        Object.freeze({
          kind: "barrier" as const,
          previousRevision,
          revision,
          reason,
        }),
      );
      latestRevision = revision;
      publishDiagnostics();
    },
    clear() {
      entries = Object.freeze([]);
      publishDiagnostics();
    },
    changesSince(fromRevision: number, currentRevision: number) {
      if (currentRevision !== latestRevision) {
        throw new RangeError(
          "The supplied current revision does not match the journal.",
        );
      }
      if (
        !Number.isSafeInteger(fromRevision) ||
        fromRevision < 0 ||
        fromRevision > currentRevision
      ) {
        return reset<TRowId>(currentRevision, "unknown-revision");
      }
      if (fromRevision === currentRevision) {
        return changes<TRowId>(fromRevision, currentRevision, []);
      }
      const first = entries[0];
      if (first === undefined || fromRevision < previousRevisionOf(first)) {
        return reset<TRowId>(currentRevision, "journal-evicted");
      }
      const start = entries.findIndex(
        (entry) => previousRevisionOf(entry) === fromRevision,
      );
      if (start < 0) return reset<TRowId>(currentRevision, "unknown-revision");
      const retained = entries.slice(start);
      // "reorder" is a PROMISE (order moved, nothing else), so it only
      // survives aggregation when every entry in the range is a reorder
      // barrier. Any other entry — changes or a plain barrier — voids the
      // promise and the whole range degrades to a plain bulk reset.
      let allReorder = retained.length > 0;
      let reorderExpected = fromRevision;
      for (const entry of retained) {
        if (
          entry.kind !== "barrier" ||
          entry.reason !== "reorder" ||
          entry.previousRevision !== reorderExpected
        ) {
          allReorder = false;
          break;
        }
        reorderExpected = entry.revision;
      }
      if (allReorder && reorderExpected === currentRevision) {
        return reset<TRowId>(currentRevision, "reorder");
      }
      let expected = fromRevision;
      const changeSets: PretableChangeSet<TRowId>[] = [];
      for (const entry of retained) {
        if (previousRevisionOf(entry) !== expected) {
          return reset<TRowId>(currentRevision, "unknown-revision");
        }
        if (entry.kind === "barrier") {
          return reset<TRowId>(
            currentRevision,
            entry.reason === "reorder" ? "bulk-replace" : entry.reason,
          );
        }
        changeSets.push(entry.changeSet);
        expected = entry.changeSet.revision;
      }
      if (expected !== currentRevision) {
        return reset<TRowId>(currentRevision, "journal-evicted");
      }
      return changes<TRowId>(fromRevision, currentRevision, changeSets);
    },
  };
  const frozen = Object.freeze(journal);
  publishDiagnostics();
  return frozen;
}
