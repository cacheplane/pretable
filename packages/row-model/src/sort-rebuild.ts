/**
 * Synchronous whole-root rebuild for a sort-only plan change on an ungrouped
 * query. Runs to completion on the caller's stack — the deliberate trade
 * measured in #457: scheduler hops cost frames in the browser, and identity
 * carry makes the total work small enough to spend inline. No record is
 * rebuilt and no rows transient is opened: the committed root reuses the
 * captured `rows` map BY IDENTITY, and only the next plan's sort-key store
 * and the visible tree are produced fresh.
 */

import type { PretableRowId } from "./column-types";
import {
  compareWithSortKeys,
  fillSortKeysFromPrevious,
  isSortOnlyChange,
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

export function rebuildRootForSortOnlyChange<
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
  if (!isSortOnlyChange(captured.queryPlan, nextPlan)) {
    throw new TypeError(
      "Synchronous rebuild requires a sort-only plan change.",
    );
  }
  if (nextPlan.query.rowGroups.length > 0) {
    throw new TypeError("Synchronous rebuild requires an ungrouped query.");
  }
  const startedAt = now();
  // Decorated sort: keys resolve ONCE per row here (the fill already returns
  // them) and travel with the record, so the O(n log n) comparison loop does
  // no WeakMap lookups — measured at 50k, per-comparison resolution costs
  // ~4x the decorated form. The pairs ARE the tree's entry type, so the
  // sorted array feeds the bulk constructor directly.
  const visible: OrderedRowEntry<TRow, TRowId, TColumns>[] = [];
  // `range(0, size)` rather than `entries()`: this walk always runs to
  // completion into an array, and the tree's non-generator walk is the
  // cheaper way to get one (see `iterateEntries`).
  for (const source of captured.sourceOrder.range(
    0,
    captured.sourceOrder.size,
  )) {
    const previous = captured.rows.get(source.rowId);
    if (previous === undefined) continue;
    // Seed the NEXT plan's store for every carried record — the one part of
    // a record's derived state that is plan-scoped. Everything else
    // (metadata, publicRow, integrity) carries with the record itself.
    const keys = fillSortKeysFromPrevious(
      nextPlan,
      captured.queryPlan,
      previous as never,
      instrumentation,
    ) as readonly CompiledSortKey<TColumns>[];
    // A sort-only change cannot move a row across the filter, so the CAPTURED
    // root's membership is this row's verdict under the next plan too.
    if (rowPassesFilter(captured, source.rowId)) {
      visible.push(Object.freeze({ record: previous, keys }));
    }
  }
  // The key comparator already totalizes distinct rows via its final
  // sourceOrder comparison, so the id clause is unreachable today. It stays
  // because the composite mirrors the tree's own order (comparator, then id)
  // exactly, so this sort can never diverge from the bulk constructor's
  // strict-order verification even if the comparator ever stopped being
  // total. Every record's keys were seeded into nextPlan's store by the
  // carry loop above, so later insert sites can decorate their entries from
  // the store; the tree's own comparator reads only entry-carried keys.
  visible.sort(
    (left, right) =>
      compareWithSortKeys<TColumns, TRowId>(
        nextPlan,
        left.record as never,
        left.keys,
        right.record as never,
        right.keys,
      ) || compareOrderStatisticTreeIds(left.record.rowId, right.record.rowId),
  );
  const tree = createOrderStatisticTreeFromSortedEntries(
    instrumentOrderStatisticTree(
      createFlatVisibleTree<TRow, TRowId, TColumns>(nextPlan),
      instrumentation,
    ),
    visible,
    // Order only. The `visible.sort` above is under the tree's own composite
    // order (comparator, then id) over ids drawn from a HAMT, so it is
    // strictly increasing by construction and the n−1 verification can only
    // re-confirm it. Derived byId is deliberately NOT taken: a sort-only
    // change keeps the same entry SET but allocates a fresh entry object per
    // row to carry the next plan's keys, so every "survivor" is a new object
    // and a derived map would keep pointing at the previous plan's entries.
    { orderIsProven: true },
  );
  const root: RevisionRoot<TRow, TRowId, TColumns> = Object.freeze({
    revision,
    parentRevision: revision - 1,
    // Identity — the entire point: records, publicRow, integrity, and the
    // rows HAMT all survive a sort-only change untouched.
    rows: captured.rows,
    sourceOrder: captured.sourceOrder,
    visible: Object.freeze({ rows: tree }),
    queryPlan: nextPlan,
    expansion: captured.expansion,
    cause: Object.freeze({ kind: "set-query" as const }),
  });
  if (instrumentation !== undefined) {
    instrumentation.work.synchronousRebuilds += 1;
    instrumentation.work.synchronousRebuildMs += Math.max(0, now() - startedAt);
  }
  return root;
}
