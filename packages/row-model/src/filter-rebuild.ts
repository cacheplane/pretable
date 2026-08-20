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
  compareWithSortKeys,
  fillSortKeysFromPrevious,
  filterVerdict,
  isFilterOnlyChange,
  type CompiledQuery,
  type CompiledSortKey,
} from "./compiled-query";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import { rowPassesFilter } from "./filter-membership";
import type { OrderedRowEntry, RevisionRoot } from "./internal-types";
import {
  compareOrderStatisticTreeIds,
  createOrderStatisticTreeFromSortedEntries,
  instrumentOrderStatisticTree,
} from "./persistent/order-statistic-tree";
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
  // One pass over ALL records in source order: seed the next plan's sort-key
  // store (100% carries — a filter-only change keeps every sort column), run
  // the new plan's verdict, and diff it against the record's current one.
  // Unflipped records carry by identity: no rebuild, no map write. Flipped
  // records are rebuilt around their carried metadata values.
  const flippedIn: OrderedRowEntry<TRow, TRowId, TColumns>[] = [];
  const flippedOut = new Set<TRowId>();
  for (const source of captured.sourceOrder.entries()) {
    const previous = captured.rows.get(source.rowId);
    if (previous === undefined) continue;
    // The fill seeds the NEXT plan's sort-key store — the one piece of
    // per-row derived state that is plan-scoped. Everything else on the
    // record survives a filter change untouched.
    const keys = fillSortKeysFromPrevious(
      nextPlan,
      captured.queryPlan,
      previous as never,
      instrumentation,
    ) as readonly CompiledSortKey<TColumns>[];
    const passes = filterVerdict(nextPlan, previous as never);
    // The OLD verdict is the captured root's membership — the flip diff is a
    // set difference between two structures, not a comparison of two stored
    // flags. And since no record stores a verdict, a FLIPPED row needs no new
    // record either: it carries by identity exactly like an unflipped one,
    // and the flip is expressed entirely by where it sits in the new visible
    // tree.
    if (passes === rowPassesFilter(captured, previous.rowId)) continue;
    if (passes) {
      flippedIn.push(Object.freeze({ record: previous, keys }));
    } else {
      flippedOut.add(previous.rowId);
    }
  }

  const flipped = flippedIn.length + flippedOut.size;
  // Identity, unconditionally: a filter-only change reconstructs NO record,
  // so the rows HAMT is carried whole and the transient is never opened.
  const rows = captured.rows;
  let visible = captured.visible;
  if (flipped === 0) {
    // Zero flips (decided here, pinned by tests): still a NEW root at the
    // requested revision under the next plan, with the rows map AND the
    // visible tree object carried wholesale. Reusing the tree is sound even
    // though its entries' keys resolved under the OLD plan and its comparator
    // closure captured it: a filter-only change keeps sort columns and
    // comparators identical, and every record's keys were just seeded into
    // the next plan's store above, so future inserts decorate entries whose
    // keys are value-identical to the carried ones — ordering stays coherent.
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
    for (const entry of captured.visible.rows.entries()) {
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
      ),
    });
  }

  const root: RevisionRoot<TRow, TRowId, TColumns> = Object.freeze({
    revision,
    parentRevision: revision - 1,
    rows,
    sourceOrder: captured.sourceOrder,
    visible,
    queryPlan: nextPlan,
    expansion: captured.expansion,
    cause: Object.freeze({ kind: "set-query" as const }),
  });
  if (instrumentation !== undefined) {
    instrumentation.work.filterRebuilds += 1;
    instrumentation.work.filterRowsFlipped += flipped;
    instrumentation.work.filterMergeSortedInsertions += flippedIn.length;
    instrumentation.work.filterRebuildMs += Math.max(0, now() - startedAt);
  }
  return root;
}
