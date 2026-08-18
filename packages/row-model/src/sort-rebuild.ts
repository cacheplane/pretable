/**
 * Synchronous whole-root rebuild for a sort-only plan change on an ungrouped
 * query. Runs to completion on the caller's stack — the deliberate trade
 * measured in #457: scheduler hops cost frames in the browser, and metadata
 * carryover makes the total work small enough to spend inline.
 */

import type { PretableRowId } from "./column-types";
import {
  compareRecordRows,
  isSortOnlyChange,
  resortRecordMetadata,
  type CompiledQuery,
} from "./compiled-query";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import type { RevisionRoot, RowRecord } from "./internal-types";
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
  const rowsDraft = captured.rows.asTransient();
  const visible: RowRecord<TRow, TRowId, TColumns>[] = [];
  for (const source of captured.sourceOrder.entries()) {
    const previous = captured.rows.get(source.rowId);
    if (previous === undefined) continue;
    const metadata = resortRecordMetadata(
      nextPlan,
      previous.metadata as never,
    ) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const record = Object.freeze({ ...previous, metadata });
    rowsDraft.set(record.rowId, record);
    if (metadata.filterPasses) visible.push(record);
  }
  // compareRecordRows already totalizes distinct rows via its final
  // sourceOrder comparison, so the id clause is unreachable today. It stays
  // because the composite mirrors the tree's own order (comparator, then id)
  // exactly, so this sort can never diverge from the bulk constructor's
  // strict-order verification even if the comparator ever stopped being
  // total. The records were rebuilt under `nextPlan`, whose sort-key store
  // was seeded row-by-row by the carryover above, so record resolution holds.
  visible.sort(
    (left, right) =>
      compareRecordRows<TColumns, TRowId>(
        nextPlan,
        left as never,
        right as never,
      ) || compareOrderStatisticTreeIds(left.rowId, right.rowId),
  );
  const tree = createOrderStatisticTreeFromSortedEntries(
    instrumentOrderStatisticTree(
      createFlatVisibleTree<TRow, TRowId, TColumns>(nextPlan),
      instrumentation,
    ),
    visible,
  );
  const root: RevisionRoot<TRow, TRowId, TColumns> = Object.freeze({
    revision,
    parentRevision: revision - 1,
    rows: rowsDraft.freeze(),
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
