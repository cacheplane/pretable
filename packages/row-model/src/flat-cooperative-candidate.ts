import {
  adoptEvaluationCache,
  fillSortKeysFromPrevious,
  filterVerdict,
  isFilterOnlyChange,
  type CompiledQuery,
  type CompiledSortKey,
} from "./compiled-query";
import type { PretableRowId } from "./column-types";
import type {
  OrderedRowEntry,
  RevisionRoot,
  RowRecord,
  VisibleIndexRoot,
} from "./internal-types";
import {
  createPersistentMap,
  instrumentPersistentMap,
} from "./persistent/persistent-map";
import type { TransientMap } from "./persistent/transient";
import {
  instrumentOrderStatisticTree,
  type TransientOrderStatisticTree,
} from "./persistent/order-statistic-tree";
import { forEachSlotEntry, slotVectorFromEntries } from "./slot-vector";
import { orderedRowEntry } from "./ordered-row-entry";
import { createFlatVisibleTree, membershipFromFlatTree } from "./visible-index";
import {
  clearMembershipBit,
  cloneMembership,
  createMembership,
  setMembershipBit,
  type MembershipBitset,
} from "./membership-bitset";
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
 * expansion-override reconciliation: it completes when the source sweep and
 * the delta queue drain.
 *
 * Two lanes (#490):
 *
 * - **Identity-carry** (flat `set-query` over a flat captured root): records,
 *   the rows HAMT and the slot vector all carry BY IDENTITY from the captured
 *   root — the sweep only re-runs the filter verdict, decorates survivors
 *   with next-plan sort keys, and sets membership bits. Zero evaluations,
 *   zero HAMT writes, zero record allocations.
 * - **Evaluate** (`set-derivations`, or a grouped captured root): metadata
 *   genuinely changes, so every row is re-evaluated into fresh structures
 *   exactly as before the split.
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
  /**
   * Lane eligibility (spec amendment): identity-carry requires the CAPTURED
   * plan to be ungrouped too — a grouped→flat `set-query` captures records
   * whose metadata still holds the grouped `groupPath`/`aggregateLeaves`, so
   * those transitions re-evaluate. The NEXT plan is already known flat: the
   * shared constructor dispatches here only when
   * `queryPlan.query.rowGroups.length === 0`.
   */
  const identityCarry =
    options.operation === "set-query" &&
    options.captured.queryPlan.query.rowGroups.length === 0;
  /**
   * Whole-store evaluation-cache handoff, gated on the SAME precondition the
   * synchronous filter rebuild owns (`adoptEvaluationCache`'s documented
   * contract): only a filter-only change leaves every cached field —
   * including the sort-key arrays, which are index-aligned to the plan that
   * wrote them — valid under the next plan. On a sort-changed set-query the
   * per-row `fillSortKeysFromPrevious` below carries what it can instead.
   * Pure perf lever either way: nothing below depends on the adoption.
   */
  if (isFilterOnlyChange(options.captured.queryPlan, options.queryPlan)) {
    adoptEvaluationCache(options.queryPlan, options.captured.queryPlan);
    if (instrumentation !== undefined) {
      instrumentation.work.evaluationCacheAdoptions += 1;
    }
  }
  // The evaluate lane rebuilds the rows map per row; the identity lane never
  // writes it, so it starts from — and without a delta, finishes as — the
  // captured root's own map.
  const initialRows = identityCarry
    ? options.captured.rows
    : instrumentPersistentMap(
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
        /** Evaluate lane's visible tree, persistent per-insert as before. */
        flatRows: VisibleIndexRoot<TRow, TRowId, TColumns>["rows"];
        /**
         * Identity lane's visible tree, built TRANSIENT and frozen once at
         * `finish`: nothing outside the candidate can reach it mid-flight,
         * and the transient's byId writes are O(1) in-place instead of a
         * HAMT path copy per visible row — which is what keeps the lane's
         * `hamtNodesCopied === 0` pin honest rather than merely uncounted.
         * `null` on the evaluate lane.
         */
        transientFlatRows: TransientOrderStatisticTree<
          TRowId,
          OrderedRowEntry<TRow, TRowId, TColumns>,
          number
        > | null;
        /**
         * Slot-indexed records, as a PLAIN MUTABLE array: nothing here is
         * reachable outside the candidate until `finish` chunks it into the
         * published root's immutable vector, so per-step writes are O(1)
         * instead of a COW chunk copy per slice.
         *
         * Evaluate lane: written per swept row. Identity lane: EMPTY (the
         * captured vector carries by identity) until the first delta
         * upgrades the candidate, which fills it with a whole copy.
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
        /**
         * Identity lane only: the membership bitset the sweep fills as it
         * verdicts each row — published verbatim at `finish`, deleting the
         * O(n) `membershipFromFlatTree` walk from the finish stack. Mutable
         * here because nothing is published mid-flight. `null` on the
         * evaluate lane (it still derives membership from the tree at
         * finish — Task 3 unifies).
         */
        membership: MembershipBitset | null;
        /**
         * Identity lane's build cursor: an ascending slot walk over the
         * CAPTURED root's chunked slot vector. One populated slot per
         * `step()` (holes are skipped for free and never counted); `null`
         * once exhausted, mirroring `iterator`.
         */
        sweep: { chunkIndex: number; offset: number } | null;
        /**
         * Identity lane, armed by the first delta (`append` upgrades the
         * candidate): replay needs keyed get/set/delete, which the carried
         * map cannot serve immutably at O(1) — one `asTransient()` on the
         * carried map (structural sharing, no copy) provides it. `finish`
         * then freezes it instead of carrying the captured map. A
         * transition that never sees a delta never pays any of this.
         */
        transientRows: TransientMap<
          TRowId,
          RowRecord<TRow, TRowId, TColumns>
        > | null;
        /** Evaluate lane's build cursor (source order, as before the split). */
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
    transientFlatRows: identityCarry
      ? instrumentOrderStatisticTree(
          createFlatVisibleTree<TRow, TRowId, TColumns>(options.queryPlan),
          instrumentation,
        ).asTransient()
      : null,
    recordsBySlot: [],
    slotCapacity: options.captured.slotCapacity,
    membership: identityCarry
      ? createMembership(options.captured.slotCapacity)
      : null,
    sweep: identityCarry ? { chunkIndex: 0, offset: 0 } : null,
    transientRows: null,
    iterator: identityCarry ? null : options.captured.sourceOrder.entries(),
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

  /**
   * Identity-carry unit: the record carries WHOLE — metadata included —
   * because on an ungrouped `set-query` no metadata field can change:
   * `groupPath` is `[]` under both plans (both are flat — the lane predicate
   * above pins the captured side), and `aggregateLeaves` derive from
   * derivations, which `set-query` does not touch. Leaves DO embed sortKeys
   * in their `dependency`, but on a flat root nothing consumes
   * `metadata.aggregateLeaves` — only the group index reads them (see
   * `group-index.ts`, the sole `.aggregateLeaves` consumer), and a flat root
   * has none. A future grouped-leaves reader must re-derive before reading a
   * root produced here. Sort keys are the one plan-scoped piece, resolved
   * via the per-row carry fill exactly as `sort-rebuild.ts` does.
   */
  const carryRecord = (record: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    if (instrumentation !== undefined) {
      // `rowsEvaluated` deliberately NOT incremented: nothing is evaluated
      // on this lane — that zero is the dense claim `work.test.ts` pins.
      instrumentation.work.transitionRows += 1;
    }
    if (filterVerdict(state.queryPlan, record as never)) {
      const keys = fillSortKeysFromPrevious(
        state.queryPlan,
        state.captured.queryPlan,
        record as never,
        instrumentation,
      ) as readonly CompiledSortKey<TColumns>[];
      state.transientFlatRows!.insertOrReplace(Object.freeze({ record, keys }));
      setMembershipBit(state.membership!, record.slot);
    }
  };

  /**
   * Converts the identity-carry candidate to replayable form on the FIRST
   * delta: keyed mutation via the transient, per-slot mutation via a whole
   * copy of the carried vector. From here `finish` builds fresh structures
   * (the upgraded arm) — the carried ones are no longer the truth.
   */
  const upgradeForReplay = (
    state: Exclude<typeof retained, undefined>,
  ): void => {
    state.transientRows = state.captured.rows.asTransient();
    forEachSlotEntry(state.captured.recordsBySlot, (record, slot) => {
      state.recordsBySlot[slot] = record;
    });
  };

  const removeRecord = (record: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    if (state.transientRows !== null) {
      state.transientRows.delete(record.rowId);
      clearMembershipBit(state.membership!, record.slot);
      state.recordsBySlot[record.slot] = undefined;
      state.transientFlatRows!.remove(record.rowId);
      return;
    }
    state.rows = state.rows.delete(record.rowId);
    state.recordsBySlot[record.slot] = undefined;
    state.flatRows = state.flatRows.remove(record.rowId);
  };

  const insertRecord = (source: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    if (state.transientRows !== null) {
      // Identity-lane replay insert: the delta TARGET root's record carries
      // by identity too — it was evaluated under the model's still-committed
      // plan (the captured plan's lineage), and the candidate plan differs
      // only in filter/sort, which cannot change metadata (see
      // `carryRecord`). Only the verdict is re-run, under the candidate's
      // plan.
      state.transientRows.set(source.rowId, source);
      state.recordsBySlot[source.slot] = source;
      carryRecord(source);
      return;
    }
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
    const previous =
      state.transientRows !== null
        ? state.transientRows.get(rowId)
        : state.rows.get(rowId);
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

  /** Identity lane's build unit: the next populated slot, ascending. */
  const sweepOne = (state: Exclude<typeof retained, undefined>): boolean => {
    const cursor = state.sweep;
    if (cursor === null) return false;
    const chunks = state.captured.recordsBySlot.chunks;
    while (cursor.chunkIndex < chunks.length) {
      const chunk = chunks[cursor.chunkIndex];
      if (chunk === undefined) {
        cursor.chunkIndex += 1;
        cursor.offset = 0;
        continue;
      }
      while (cursor.offset < chunk.length) {
        const record = chunk[cursor.offset];
        cursor.offset += 1;
        if (record !== undefined) {
          carryRecord(record);
          completedRows += 1;
          return true;
        }
      }
      cursor.chunkIndex += 1;
      cursor.offset = 0;
    }
    state.sweep = null;
    return false;
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
      if (identityCarry && state.transientRows === null) {
        upgradeForReplay(state);
      }
      state.deltas.push(delta);
      // Capacity is monotone across commits, so the widest replayed target
      // bounds every slot this candidate can ever bind (still a captured
      // root's value — the live allocator is never consulted).
      state.slotCapacity = Math.max(
        state.slotCapacity,
        delta.target.slotCapacity,
      );
      // Bitset capacity decision: the bitset is maintained incrementally, so
      // widening reallocates it here — a whole copy into the wider word
      // array. Provably correct because slots are stable (a bit's index
      // never changes) and setting a bit beyond a Uint32Array's length is a
      // silent no-op, so the copy MUST precede any replayed write to a
      // grown slot; `append` runs before every such write.
      if (
        state.membership !== null &&
        (state.slotCapacity + 31) >>> 5 > state.membership.length
      ) {
        state.membership = cloneMembership(
          state.membership,
          state.slotCapacity,
        );
      }
      totalRows += delta.affectedRowIds.length * 2 + 1;
    },
    step() {
      const state = retained;
      if (state === undefined) return true;
      if (identityCarry) {
        if (sweepOne(state)) return false;
      } else if (state.iterator !== null) {
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
      // sweep and the delta queue drain. This mirrors the grouped module's
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
        rows:
          state.transientFlatRows !== null
            ? state.transientFlatRows.freeze()
            : state.flatRows,
      });
      if (identityCarry && state.transientRows === null) {
        // Delta-free identity carry: rows, the slot vector and its domain
        // all carry from the captured root's own objects, and membership is
        // the bitset the sweep already filled — no `membershipFromFlatTree`
        // walk, no slot sweep, on the finish stack.
        return Object.freeze({
          revision,
          parentRevision: revision - 1,
          rows: state.captured.rows,
          sourceOrder: state.sourceOrder,
          recordsBySlot: state.captured.recordsBySlot,
          slotCapacity: state.slotCapacity,
          visibleSlots: state.membership!,
          visible,
          queryPlan: state.queryPlan,
          expansion: state.expansion,
          cause: Object.freeze({ kind: operation }),
        });
      }
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
        rows:
          state.transientRows !== null
            ? state.transientRows.freeze()
            : state.rows,
        sourceOrder: state.sourceOrder,
        recordsBySlot: slotVectorFromEntries(slotEntries, state.slotCapacity),
        slotCapacity: state.slotCapacity,
        // Upgraded identity lane: membership as maintained by carry/replay.
        // Evaluate lane: membership was built into the visible tree; index
        // it over the state's self-described capacity (Task 3 unifies this
        // arm with the maintained bitset).
        visibleSlots:
          state.membership !== null
            ? state.membership
            : membershipFromFlatTree(visible.rows, state.slotCapacity),
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
      state.sweep = null;
      state.transientRows = null;
      state.transientFlatRows = null;
      state.membership = null;
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
      hasIterator:
        retained !== undefined &&
        (identityCarry ? retained.sweep !== null : retained.iterator !== null),
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
