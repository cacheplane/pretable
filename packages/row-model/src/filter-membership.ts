/**
 * Filter verdicts are not stored. A committed root already carries the answer
 * structurally: a row passes this root's filters exactly when it is a MEMBER
 * of the root's visible structure. This module is the one place that knows
 * which structure answers for which root shape.
 *
 * - **Flat root** (`query.rowGroups.length === 0`): `root.visible.rows` holds
 *   one entry per passing row and nothing else, so membership is a lookup.
 *   This is the same predicate `nearestVisibleRef` has always used.
 * - **Grouped root**: `root.visible.rows` is deliberately EMPTY (a grouped
 *   visible index attaches the group index to an empty flat tree), so the
 *   answer lives in the group index: every inserted row — passing or not —
 *   gets a `rowParents` entry, and only passing rows are inserted into their
 *   leaf group's `leaves` tree. So `rowParents` locates the leaf group and
 *   `leaves` holds the verdict.
 *
 * Absence is the answer, not a fault: a row this root never saw, or one its
 * filters reject, is simply not a member. Nothing here fails loud.
 *
 * These read a COMMITTED root, so they answer "did this row pass under the
 * plan that built this root" — the OLD verdict at every site that compares
 * against a new one. A NEW verdict is computed, never resolved: producers
 * call `filterVerdict(plan, record)` and use it locally to decide where the
 * row goes.
 */

import type { PretableRowId } from "./column-types";
import { getGroupIndex, type GroupIndexRoot } from "./group-index";
import type { RevisionRoot } from "./internal-types";

/**
 * The grouped half of the seam, exposed on its own for callers that hold a
 * group index rather than a root (the group index is rebuilt in place during
 * a transaction, and the caller must read the PREVIOUS one).
 */
export function rowPassesFilterInGroupIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  grouped: GroupIndexRoot<TRow, TRowId, TColumns>,
  rowId: TRowId,
): boolean {
  const parentGroupId = grouped.rowParents.get(rowId);
  if (parentGroupId === undefined) return false;
  return grouped.groups.get(parentGroupId)?.leaves.get(rowId) !== undefined;
}

/** Did `rowId` pass the filters of the plan that built `root`? */
export function rowPassesFilter<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(root: RevisionRoot<TRow, TRowId, TColumns>, rowId: TRowId): boolean {
  const grouped = getGroupIndex(root.visible);
  return grouped === undefined
    ? root.visible.rows.get(rowId) !== undefined
    : rowPassesFilterInGroupIndex(grouped, rowId);
}
