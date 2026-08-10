import type { PretableRowId } from "./column-types";
import type {
  RevisionRoot,
  RowRecord,
  VisibleIndexRoot,
} from "./internal-types";
import { createOrderStatisticTree } from "./persistent/order-statistic-tree";
import type { PretableRowModelSnapshot, PretableVisibleRowRef } from "./types";

export function createFlatVisibleIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  records: readonly RowRecord<TRow, TRowId, TColumns>[],
  compareRows: (
    left: RowRecord<TRow, TRowId, TColumns>["metadata"],
    right: RowRecord<TRow, TRowId, TColumns>["metadata"],
  ) => number,
): VisibleIndexRoot<TRow, TRowId, TColumns> {
  const draft = createFlatVisibleTree<TRow, TRowId, TColumns>(
    compareRows,
  ).asTransient();
  for (const record of records) {
    if (record.metadata.filterPasses) draft.insertOrReplace(record);
  }
  return Object.freeze({ rows: draft.freeze() });
}

export function createFlatVisibleTree<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  compareRows: (
    left: RowRecord<TRow, TRowId, TColumns>["metadata"],
    right: RowRecord<TRow, TRowId, TColumns>["metadata"],
  ) => number,
) {
  return createOrderStatisticTree<
    TRowId,
    RowRecord<TRow, TRowId, TColumns>,
    number
  >({
    getId: (record) => record.rowId,
    compare: (left, right) => compareRows(left.metadata, right.metadata),
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
  const visible = root.visible.rows;
  const lookupRank = (
    ref: PretableVisibleRowRef<TRowId>,
  ): number | undefined =>
    ref.kind === "data" ? visible.rankOf(ref.rowId) : undefined;
  return Object.freeze({
    revision: root.revision,
    sourceRowCount: root.rows.size,
    visibleRowCount: visible.size,
    visibleDataRowCount: visible.size,
    rowAt: (index: number) => visible.entryAt(index)?.publicRow,
    range: (start: number, end: number) =>
      Object.freeze(
        visible.range(start, end).map((record) => record.publicRow),
      ),
    indexOf: (ref: PretableVisibleRowRef<TRowId>) => lookupRank(ref) ?? -1,
    dataRowAt: (index: number) => visible.entryAt(index)?.publicRow,
    firstDataRow: () => visible.entryAt(0)?.publicRow,
    lastDataRow: () => visible.entryAt(visible.size - 1)?.publicRow,
    nextDataRow: (ref: PretableVisibleRowRef<TRowId>) => {
      const rank = lookupRank(ref);
      return rank === undefined
        ? undefined
        : visible.entryAt(rank + 1)?.publicRow;
    },
    previousDataRow: (ref: PretableVisibleRowRef<TRowId>) => {
      const rank = lookupRank(ref);
      return rank === undefined
        ? undefined
        : visible.entryAt(rank - 1)?.publicRow;
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
