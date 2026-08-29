import { filterVerdict, type CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import type {
  RevisionRoot,
  RowRecord,
  VisibleIndexRoot,
} from "./internal-types";
import {
  createPersistentMap,
  instrumentPersistentMap,
} from "./persistent/persistent-map";
import { instrumentOrderStatisticTree } from "./persistent/order-statistic-tree";
import { slotVectorFromEntries } from "./slot-vector";
import { orderedRowEntry } from "./ordered-row-entry";
import { createFlatVisibleTree, membershipFromFlatTree } from "./visible-index";
import {
  registerCooperativeTransitionCandidateDiagnostics,
  type CooperativeTransitionCandidate,
  type CooperativeTransitionDelta,
  type CreateCooperativeTransitionCandidateOptions,
} from "./cooperative-transition";

/**
 * The flat (ungrouped) cooperative transition candidate. Builds against an
 * immutable source root and replays exact live-row deltas; nothing reachable
 * here is published before `finish` returns the swap root.
 *
 * A flat candidate has no group index, no bulk builder, no seal phase, and no
 * expansion-override reconciliation: it completes when the source iterator and
 * the delta queue drain.
 */
export function createFlatCooperativeCandidate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  options: CreateCooperativeTransitionCandidateOptions<TRow, TRowId, TColumns>,
): CooperativeTransitionCandidate<TRow, TRowId, TColumns> {
  const operation = options.operation;
  const instrumentation = options.instrumentation;
  const initialRows = instrumentPersistentMap(
    createPersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>(),
    instrumentation,
  );
  let retained:
    | {
        captured: RevisionRoot<TRow, TRowId, TColumns>;
        queryPlan: CompiledQuery<TColumns>;
        rows: RevisionRoot<TRow, TRowId, TColumns>["rows"];
        sourceOrder: RevisionRoot<TRow, TRowId, TColumns>["sourceOrder"];
        expansion: RevisionRoot<TRow, TRowId, TColumns>["expansion"];
        flatRows: VisibleIndexRoot<TRow, TRowId, TColumns>["rows"];
        /**
         * Slot-indexed records, as a PLAIN MUTABLE array: nothing here is
         * reachable outside the candidate until `finish` chunks it into the
         * published root's immutable vector, so per-step writes are O(1)
         * instead of a COW chunk copy per slice.
         */
        recordsBySlot: Array<RowRecord<TRow, TRowId, TColumns> | undefined>;
        /**
         * The slot-space size for the root `finish` will publish. Seeded from
         * the CAPTURED root's self-described capacity and widened only by
         * replayed delta targets' capacities — never read from the live
         * allocator, so growth after capture cannot leak into this build's
         * domain.
         */
        slotCapacity: number;
        iterator: Iterator<
          Readonly<{ readonly rowId: TRowId; readonly sourceOrder: number }>
        > | null;
        deltas: Array<CooperativeTransitionDelta<
          TRow,
          TRowId,
          TColumns
        > | null>;
        reconciledExpansion:
          RevisionRoot<TRow, TRowId, TColumns>["expansion"] | undefined;
      }
    | undefined = {
    captured: options.captured,
    queryPlan: options.queryPlan,
    rows: initialRows,
    sourceOrder: options.captured.sourceOrder,
    expansion: options.captured.expansion,
    flatRows: instrumentOrderStatisticTree(
      createFlatVisibleTree<TRow, TRowId, TColumns>(options.queryPlan),
      instrumentation,
    ),
    recordsBySlot: [],
    slotCapacity: options.captured.slotCapacity,
    iterator: options.captured.sourceOrder.entries(),
    deltas: [],
    reconciledExpansion: undefined,
  };
  // Candidate methods retain only the nullable state binding below. Clear the
  // input container so it cannot independently keep the captured root alive.
  options = undefined as never;
  let deltaIndex = 0;
  let deltaRowIndex = 0;
  let deltaRowPhase: "remove" | "insert" = "remove";
  let completedRows = 0;
  let totalRows = retained.captured.rows.size;
  let released = false;

  const resetOverrideReconciliation = (
    state: Exclude<typeof retained, undefined>,
  ): void => {
    // A flat candidate never starts an override reconciliation pass, so the
    // grouped module's `totalRows -= reconciliation.remaining` shrink can
    // never apply here; the only effect this reset has on the flat path is
    // clearing the reconciled-expansion marker.
    state.reconciledExpansion = undefined;
  };

  const removeRecord = (record: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    state.rows = state.rows.delete(record.rowId);
    state.recordsBySlot[record.slot] = undefined;
    state.flatRows = state.flatRows.remove(record.rowId);
  };

  const insertRecord = (source: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    if (instrumentation !== undefined) {
      instrumentation.work.transitionRows += 1;
      instrumentation.work.rowsEvaluated += 1;
    }
    const metadata = state.queryPlan.evaluate({
      rowId: source.rowId,
      row: source.row as never,
      sourceOrder: source.sourceOrder,
      slot: source.slot,
    }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const record = Object.freeze({ ...source, metadata });
    state.rows = state.rows.set(record.rowId, record);
    state.recordsBySlot[record.slot] = record;
    // Computed here, used here: the flat tree this inserts into is where
    // the verdict is recorded.
    if (filterVerdict(state.queryPlan, record as never)) {
      state.flatRows = state.flatRows.insertOrReplace(
        orderedRowEntry(state.queryPlan, record),
      );
    }
  };

  const removeReplayRow = (rowId: TRowId): void => {
    const state = retained;
    if (state === undefined) return;
    const previous = state.rows.get(rowId);
    if (previous !== undefined) removeRecord(previous);
  };

  const insertReplayRow = (
    target: RevisionRoot<TRow, TRowId, TColumns>,
    rowId: TRowId,
  ): void => {
    if (retained === undefined) return;
    const next = target.rows.get(rowId);
    if (next !== undefined) insertRecord(next);
  };

  const candidate: CooperativeTransitionCandidate<TRow, TRowId, TColumns> = {
    get completedRows() {
      return completedRows;
    },
    get totalRows() {
      return totalRows;
    },
    append(delta) {
      const state = retained;
      if (state === undefined) return;
      resetOverrideReconciliation(state);
      state.deltas.push(delta);
      // Capacity is monotone across commits, so the widest replayed target
      // bounds every slot this candidate can ever bind (still a captured
      // root's value — the live allocator is never consulted).
      state.slotCapacity = Math.max(
        state.slotCapacity,
        delta.target.slotCapacity,
      );
      totalRows += delta.affectedRowIds.length * 2 + 1;
    },
    step() {
      const state = retained;
      if (state === undefined) return true;
      if (state.iterator !== null) {
        const source = state.iterator.next();
        if (!source.done) {
          const previous = state.captured.rows.get(source.value.rowId);
          if (previous !== undefined) insertRecord(previous);
          completedRows += 1;
          return false;
        }
        state.iterator = null;
      }

      while (deltaIndex < state.deltas.length) {
        const delta = state.deltas[deltaIndex];
        if (delta === null) {
          deltaIndex += 1;
          deltaRowIndex = 0;
          deltaRowPhase = "remove";
          continue;
        }
        const rowId = delta.affectedRowIds[deltaRowIndex];
        if (rowId !== undefined) {
          if (deltaRowPhase === "remove") {
            removeReplayRow(rowId);
            deltaRowPhase = "insert";
          } else {
            insertReplayRow(delta.target, rowId);
            deltaRowPhase = "remove";
            deltaRowIndex += 1;
          }
          completedRows += 1;
          return false;
        }
        state.sourceOrder = delta.target.sourceOrder;
        state.expansion = delta.target.expansion;
        resetOverrideReconciliation(state);
        state.deltas[deltaIndex] = null;
        deltaIndex += 1;
        deltaRowIndex = 0;
        deltaRowPhase = "remove";
        completedRows += 1;
        return false;
      }
      // Terminal condition: the flat candidate is complete once the source
      // iterator and the delta queue drain. This mirrors the grouped module's
      // `reconcileOneOverride` short-circuit for a groupless state byte for
      // byte — it marks the expansion reconciled and reports completion in
      // the same step, without counting a unit against `completedRows`.
      state.reconciledExpansion = state.expansion;
      return true;
    },
    finish(revision) {
      const state = retained;
      if (state === undefined)
        throw new Error("Released transition candidate.");
      const visible: VisibleIndexRoot<TRow, TRowId, TColumns> = Object.freeze({
        rows: state.flatRows,
      });
      const slotEntries: Array<
        readonly [number, RowRecord<TRow, TRowId, TColumns>]
      > = [];
      for (let slot = 0; slot < state.recordsBySlot.length; slot += 1) {
        const record = state.recordsBySlot[slot];
        if (record !== undefined) slotEntries.push([slot, record]);
      }
      return Object.freeze({
        revision,
        parentRevision: revision - 1,
        rows: state.rows,
        sourceOrder: state.sourceOrder,
        recordsBySlot: slotVectorFromEntries(slotEntries, state.slotCapacity),
        slotCapacity: state.slotCapacity,
        // Flat transitions built their membership into `flatRows`; index it
        // over the state's self-described capacity.
        visibleSlots: membershipFromFlatTree(
          state.flatRows,
          state.slotCapacity,
        ),
        visible,
        queryPlan: state.queryPlan,
        expansion: state.expansion,
        cause: Object.freeze({ kind: operation }),
      });
    },
    release() {
      const state = retained;
      if (state === undefined) return;
      released = true;
      state.iterator = null;
      state.deltas.fill(null);
      state.deltas.length = 0;
      state.recordsBySlot.length = 0;
      state.reconciledExpansion = undefined;
      retained = undefined;
    },
  };
  registerCooperativeTransitionCandidateDiagnostics(candidate, () =>
    Object.freeze({
      released,
      hasCapturedRoot: retained !== undefined,
      hasQueryPlan: retained !== undefined,
      hasIterator: retained?.iterator !== null && retained !== undefined,
      deltaCount:
        retained?.deltas.reduce(
          (count, delta) => count + (delta === null ? 0 : 1),
          0,
        ) ?? 0,
      hasRows: retained !== undefined,
      hasSourceOrder: retained !== undefined,
      hasExpansion: retained !== undefined,
      hasFlatRows: retained !== undefined,
      // The flat lane never holds a group index or a bulk builder; the shape
      // matches the grouped module's registration with the grouped-only
      // fields pinned to their groupless values.
      hasGroups: false,
      deltaSlotCount: retained?.deltas.length ?? 0,
      processedDeltaCount: retained === undefined ? 0 : deltaIndex,
      retainedDeltaRootCount:
        retained?.deltas.reduce(
          (count, delta) => count + (delta === null ? 0 : 1),
          0,
        ) ?? 0,
      overrideReconciliationRemaining: 0,
    }),
  );
  return candidate;
}
