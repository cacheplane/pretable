/**
 * Synchronous subset rebuild for a filter-only plan change on an ungrouped
 * query. Runs to completion on the caller's stack, like `sort-rebuild` — a
 * filter-only change is a membership change over an already-sorted set:
 * values, sort keys, group paths, and relative order are all unchanged. No
 * record is reconstructed — not even a flipped one, because no record holds a
 * verdict any more — so the rows HAMT carries by identity exactly as
 * sort-rebuild's does, and the only new structure is the visible tree: a
 * linear merge of the surviving old order with the sorted flipped-in subset,
 * with no comparator sort of the full set, ever.
 */

import type { PretableRowId } from "./column-types";
import {
  adoptEvaluationCache,
  compareWithSortKeys,
  filterVerdict,
  isFilterOnlyChange,
  sortKeysOf,
  type CompiledQuery,
  type CompiledSortKey,
} from "./compiled-query";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import type { OrderedRowEntry, RevisionRoot } from "./internal-types";
import {
  createMembership,
  setMembershipBit,
  testMembershipBit,
} from "./membership-bitset";
import {
  compareOrderStatisticTreeIds,
  createOrderStatisticTreeFromSortedEntries,
  instrumentOrderStatisticTree,
} from "./persistent/order-statistic-tree";
import { forEachSlotEntry } from "./slot-vector";
import { createFlatVisibleTree } from "./visible-index";

export function rebuildRootForFilterOnlyChange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(options: {
  readonly captured: RevisionRoot<TRow, TRowId, TColumns>;
  readonly nextPlan: CompiledQuery<TColumns>;
  readonly revision: number;
  readonly now: () => number;
  readonly instrumentation?: LocalRowModelInstrumentation;
}): RevisionRoot<TRow, TRowId, TColumns> {
  const { captured, nextPlan, revision, now, instrumentation } = options;
  if (!isFilterOnlyChange(captured.queryPlan, nextPlan)) {
    throw new TypeError(
      "Synchronous filter rebuild requires a filter-only plan change.",
    );
  }
  if (nextPlan.query.rowGroups.length > 0) {
    throw new TypeError(
      "Synchronous filter rebuild requires an ungrouped query.",
    );
  }
  const startedAt = now();
  // The next plan ADOPTS the captured plan's evaluation cache by reference:
  // one assignment for the whole store instead of a per-row refill. A
  // filter-only change leaves every cached field valid (the field-by-field
  // argument lives on the seam), and the one filter-dependent field — the
  // verdict memo — is tagged with the plan that wrote it, so the loop below
  // still runs the NEW filters over every row.
  adoptEvaluationCache(nextPlan, captured.queryPlan);
  // One hole-skipping pass over ALL records via the slot vector: run the new
  // plan's verdict, record it as a bit in the next root's membership bitset,
  // and diff it against the captured root's bit. Every record carries by
  // identity — flipped or not — so the pass collects nothing but the two flip
  // sets, and only a flipped-IN row needs its keys resolved (survivors keep
  // their existing entry objects, leavers need nothing). The bitset is sized
  // by `captured.slotCapacity` — roots are self-describing, and reading the
  // live allocator instead would let later growth leak into this snapshot's
  // domain. This path throws on grouped plans above, so
  // `captured.visibleSlots` is always the REAL flat bitset, never the
  // grouped sentinel.
  const nextVisibleSlots = createMembership(captured.slotCapacity);
  const flippedIn: OrderedRowEntry<TRow, TRowId, TColumns>[] = [];
  const flippedOut = new Set<TRowId>();
  // Slot order, not source order — sound because nothing downstream reads
  // this walk's order: flippedIn is comparator-sorted below, flippedOut is a
  // set, and the merge consumes the OLD TREE's walk. recordsBySlot replaces
  // the rows-HAMT get; visibleSlots replaces the old-verdict membership get.
  forEachSlotEntry(captured.recordsBySlot, (previous) => {
    const passes = filterVerdict(nextPlan, previous as never);
    if (passes) setMembershipBit(nextVisibleSlots, previous.slot);
    // The OLD verdict is the captured root's membership bit — the flip diff
    // is a set difference between two structures, not a comparison of two
    // stored flags. And since no record stores a verdict, a FLIPPED row needs
    // no new record either: it carries by identity exactly like an unflipped
    // one, and the flip is expressed entirely by where it sits in the new
    // visible tree.
    if (passes === testMembershipBit(captured.visibleSlots, previous.slot)) {
      return;
    }
    if (passes) {
      // Resolved from the adopted store — the same array the captured plan
      // handed out, since a filter-only change leaves the keys untouched.
      const keys = sortKeysOf(
        nextPlan,
        previous as never,
      ) as readonly CompiledSortKey<TColumns>[];
      flippedIn.push(Object.freeze({ record: previous, keys }));
    } else {
      flippedOut.add(previous.rowId);
    }
  });

  const flipped = flippedIn.length + flippedOut.size;
  // Identity, unconditionally: a filter-only change reconstructs NO record,
  // so the rows HAMT is carried whole and the transient is never opened.
  const rows = captured.rows;
  let visible = captured.visible;
  // Zero flips carry the captured bitset by identity — same member set —
  // and the freshly-computed (bit-identical) `nextVisibleSlots` is dropped.
  let visibleSlots = captured.visibleSlots;
  if (flipped === 0) {
    // Zero flips (decided here, pinned by tests): still a NEW root at the
    // requested revision under the next plan, with the rows map AND the
    // visible tree object carried wholesale. Reusing the tree is sound even
    // though its entries' keys resolved under the OLD plan and its comparator
    // closure captured it: a filter-only change keeps sort columns and
    // comparators identical, and the next plan now READS THE SAME STORE, so
    // future inserts decorate entries with the very arrays the carried ones
    // hold — ordering stays coherent.
  } else {
    // Both sequences below are strictly sorted by the same composite order
    // the tree maintains (comparator, then id): the old tree's in-order walk
    // by construction, the flipped-in subset by this k log k sort — the only
    // sort in the rebuild, and it never sees an unflipped row.
    const compareEntries = (
      left: OrderedRowEntry<TRow, TRowId, TColumns>,
      right: OrderedRowEntry<TRow, TRowId, TColumns>,
    ) =>
      compareWithSortKeys<TColumns, TRowId>(
        nextPlan,
        left.record as never,
        left.keys,
        right.record as never,
        right.keys,
      ) || compareOrderStatisticTreeIds(left.record.rowId, right.record.rowId);
    flippedIn.sort(compareEntries);
    // Single linear merge: surviving entries keep their ENTRY objects (a
    // still-passing row is by definition unflipped — record and keys are both
    // unchanged), flipped-out rows are skipped, flipped-in entries interleave
    // where the composite order puts them.
    const merged: OrderedRowEntry<TRow, TRowId, TColumns>[] = [];
    let next = 0;
    // `range(0, size)` rather than `entries()`: this walk always runs to
    // completion, and the tree's non-generator walk is the cheaper way to
    // get one — ~1ms against ~30ms at 50,000 rows (see `iterateEntries`).
    for (const entry of captured.visible.rows.range(
      0,
      captured.visible.rows.size,
    )) {
      if (flippedOut.has(entry.record.rowId)) continue;
      while (
        next < flippedIn.length &&
        compareEntries(flippedIn[next], entry) < 0
      ) {
        merged.push(flippedIn[next]);
        next += 1;
      }
      merged.push(entry);
    }
    while (next < flippedIn.length) {
      merged.push(flippedIn[next]);
      next += 1;
    }
    visible = Object.freeze({
      rows: createOrderStatisticTreeFromSortedEntries(
        instrumentOrderStatisticTree(
          createFlatVisibleTree<TRow, TRowId, TColumns>(nextPlan),
          instrumentation,
        ),
        merged,
        // Both proofs are earned by the merge directly above, and neither
        // would be available to a caller that re-sorted the full set.
        // Order: a merge of two strictly-increasing, id-disjoint sequences
        // under one total order is strictly increasing — so the n−1
        // verification would re-derive what the loop just guaranteed.
        // byId: the visible set changes by exactly `flippedOut` leaving and
        // `flippedIn` arriving; every survivor is pushed into `merged` as the
        // base tree's OWN entry object (unflipped ⇒ record and keys
        // unchanged), which is the identity precondition derived mode
        // requires. Cost drops from n inserts to `flipped` edits.
        {
          orderIsProven: true,
          derivedById: {
            base: captured.visible.rows,
            removedIds: flippedOut,
            addedEntries: flippedIn,
          },
        },
      ),
    });
    // The verdict pass above already set a bit for every member, so the new
    // root takes its bitset directly — no second walk over the tree.
    visibleSlots = nextVisibleSlots;
  }

  const root: RevisionRoot<TRow, TRowId, TColumns> = Object.freeze({
    revision,
    parentRevision: revision - 1,
    rows,
    sourceOrder: captured.sourceOrder,
    // A filter-only change reconstructs no record and touches no slot, so
    // the slot vector and its domain carry by identity with the rows HAMT.
    recordsBySlot: captured.recordsBySlot,
    slotCapacity: captured.slotCapacity,
    visibleSlots,
    visible,
    queryPlan: nextPlan,
    expansion: captured.expansion,
    cause: Object.freeze({ kind: "set-query" as const }),
  });
  if (instrumentation !== undefined) {
    instrumentation.work.filterRebuilds += 1;
    instrumentation.work.evaluationCacheAdoptions += 1;
    instrumentation.work.filterRowsFlipped += flipped;
    instrumentation.work.filterMergeSortedInsertions += flippedIn.length;
    instrumentation.work.filterRebuildMs += Math.max(0, now() - startedAt);
  }
  return root;
}
