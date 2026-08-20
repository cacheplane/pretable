import type { PretableRowId } from "./column-types";
import {
  compareWithSortKeys,
  filterVerdict,
  type CompiledQuery,
} from "./compiled-query";
import type { PretableRowModelOperation } from "./errors";
import { orderedRowEntry } from "./ordered-row-entry";
import {
  attachGroupIndex,
  createGroupIndex,
  dataAt,
  dataRankAtRef,
  getGroupIndex,
  isExpanded,
  nearestVisible,
  parentGroup,
  visibleCount,
  visibleDataCount,
  visibleIndexOf,
  visibleRange,
  type GroupIndexRoot,
} from "./group-index";
import type {
  OrderedRowEntry,
  RevisionRoot,
  RowRecord,
  VisibleIndexRoot,
} from "./internal-types";
import { createOrderStatisticTree } from "./persistent/order-statistic-tree";
import type { PersistentMap } from "./persistent/persistent-map";
import type {
  PretableGroupId,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "./types";

export function createFlatVisibleIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  records: readonly RowRecord<TRow, TRowId, TColumns>[],
  queryPlan: CompiledQuery<TColumns>,
): VisibleIndexRoot<TRow, TRowId, TColumns> {
  const draft = createFlatVisibleTree<TRow, TRowId, TColumns>(
    queryPlan,
  ).asTransient();
  for (const record of records) {
    // The verdict is COMPUTED here and stays local: the tree this loop fills
    // IS where the answer is recorded, so storing it on the record would only
    // duplicate what membership already says.
    if (filterVerdict(queryPlan, record as never)) {
      draft.insertOrReplace(orderedRowEntry(queryPlan, record));
    }
  }
  return Object.freeze({ rows: draft.freeze() });
}

export function createVisibleIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  records: readonly RowRecord<TRow, TRowId, TColumns>[],
  queryPlan: CompiledQuery<TColumns>,
  aggregateFilteredRows: boolean,
  overrides: PersistentMap<PretableGroupId, boolean>,
  operation: PretableRowModelOperation = "set-rows",
  reusable?: GroupIndexRoot<TRow, TRowId, TColumns>,
): VisibleIndexRoot<TRow, TRowId, TColumns> {
  if (queryPlan.query.rowGroups.length === 0) {
    return createFlatVisibleIndex(records, queryPlan);
  }
  return attachGroupIndex(
    createFlatVisibleTree<TRow, TRowId, TColumns>(queryPlan),
    createGroupIndex(
      records,
      queryPlan,
      aggregateFilteredRows,
      overrides,
      operation,
      reusable,
    ),
  );
}

export function createFlatVisibleTree<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(queryPlan: CompiledQuery<TColumns>) {
  return createOrderStatisticTree<
    TRowId,
    OrderedRowEntry<TRow, TRowId, TColumns>,
    number
  >({
    getId: (entry) => entry.record.rowId,
    // Entries carry their resolved keys, so a comparison is property reads
    // only — no store gets on this slice-hot path (the measured grouped-gate
    // regression was per-comparison WeakMap resolution).
    compare: (left, right) =>
      compareWithSortKeys<TColumns, TRowId>(
        queryPlan,
        left.record as never,
        left.keys,
        right.record as never,
        right.keys,
      ),
    measure: {
      empty: 0,
      fromEntry: () => 1,
      combine: (left, right) => left + right,
    },
  });
}

function dataRef<TRowId extends PretableRowId>(
  rowId: TRowId,
): PretableVisibleRowRef<TRowId> {
  return Object.freeze({ kind: "data", rowId });
}

/** Creates an immutable indexed facade that closes over exactly one root. */
export function createFlatSnapshot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: RevisionRoot<TRow, TRowId, TColumns>,
): PretableRowModelSnapshot<TRow, TRowId, TColumns> {
  const grouped = getGroupIndex(root.visible);
  if (grouped !== undefined) {
    const policy = root.expansion.default;
    const resolveCurrentRecord = (record: RowRecord<TRow, TRowId, TColumns>) =>
      root.rows.get(record.rowId) ?? record;
    const publicRowAt = (index: number) =>
      visibleRange(grouped, policy, index, index + 1, resolveCurrentRecord)[0];
    const refAtDataRank = (index: number) =>
      dataAt(grouped, policy, index, resolveCurrentRecord);
    const neighbor = (ref: PretableVisibleRowRef<TRowId>, delta: -1 | 1) => {
      const rank = dataRankAtRef(grouped, policy, ref);
      if (rank === undefined) return undefined;
      return dataAt(
        grouped,
        policy,
        ref.kind === "data" ? rank + delta : rank + (delta < 0 ? -1 : 0),
        resolveCurrentRecord,
      );
    };
    const count = visibleCount(grouped, policy);
    const dataCount = visibleDataCount(grouped, policy);
    return Object.freeze({
      revision: root.revision,
      sourceRowCount: root.rows.size,
      visibleRowCount: count,
      visibleDataRowCount: dataCount,
      rowAt: publicRowAt,
      range: (start: number, end: number) =>
        visibleRange(grouped, policy, start, end, resolveCurrentRecord),
      indexOf: (ref: PretableVisibleRowRef<TRowId>) =>
        visibleIndexOf(grouped, policy, ref),
      dataIndexOf: (ref: PretableVisibleRowRef<TRowId>) =>
        dataRankAtRef(grouped, policy, ref) ?? -1,
      dataRowAt: refAtDataRank,
      firstDataRow: () => refAtDataRank(0),
      lastDataRow: () => refAtDataRank(dataCount - 1),
      nextDataRow: (ref: PretableVisibleRowRef<TRowId>) => neighbor(ref, 1),
      previousDataRow: (ref: PretableVisibleRowRef<TRowId>) =>
        neighbor(ref, -1),
      parentGroupOf: (ref: PretableVisibleRowRef<TRowId>) =>
        parentGroup(grouped, ref, policy),
      nearestVisibleRef: (ref: PretableVisibleRowRef<TRowId>) =>
        nearestVisible(grouped, ref, policy),
      isGroupExpanded: (groupId: PretableGroupId) =>
        isExpanded(grouped, groupId, policy),
      query: root.queryPlan.query,
      expansion: root.expansion.state,
    });
  }
  const visible = root.visible.rows;
  const publicRowAt = (index: number) => {
    const ordered = visible.entryAt(index);
    return ordered === undefined
      ? undefined
      : root.rows.get(ordered.record.rowId)?.publicRow;
  };
  const lookupRank = (
    ref: PretableVisibleRowRef<TRowId>,
  ): number | undefined =>
    ref.kind === "data" ? visible.rankOf(ref.rowId) : undefined;
  return Object.freeze({
    revision: root.revision,
    sourceRowCount: root.rows.size,
    visibleRowCount: visible.size,
    visibleDataRowCount: visible.size,
    rowAt: publicRowAt,
    range: (start: number, end: number) =>
      Object.freeze(
        visible
          .range(start, end)
          .map((entry) => root.rows.get(entry.record.rowId)?.publicRow)
          .filter((row): row is NonNullable<typeof row> => row !== undefined),
      ),
    indexOf: (ref: PretableVisibleRowRef<TRowId>) => lookupRank(ref) ?? -1,
    dataIndexOf: (ref: PretableVisibleRowRef<TRowId>) => lookupRank(ref) ?? -1,
    dataRowAt: publicRowAt,
    firstDataRow: () => publicRowAt(0),
    lastDataRow: () => publicRowAt(visible.size - 1),
    nextDataRow: (ref: PretableVisibleRowRef<TRowId>) => {
      const rank = lookupRank(ref);
      return rank === undefined ? undefined : publicRowAt(rank + 1);
    },
    previousDataRow: (ref: PretableVisibleRowRef<TRowId>) => {
      const rank = lookupRank(ref);
      return rank === undefined ? undefined : publicRowAt(rank - 1);
    },
    parentGroupOf: () => undefined,
    nearestVisibleRef: (ref: PretableVisibleRowRef<TRowId>) => {
      if (ref.kind !== "data" || visible.rankOf(ref.rowId) === undefined)
        return undefined;
      return dataRef(ref.rowId);
    },
    isGroupExpanded: () => false,
    query: root.queryPlan.query,
    expansion: root.expansion.state,
  });
}
