import type {
  PretableGridSnapshot,
  PretableGroupRow,
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable/core";

import { formatCellValue } from "./rendering";

/**
 * Label for a group whose key value is null, undefined or empty. Grouping by a
 * nullable column is the common case, and a blank group row is
 * indistinguishable from a broken one.
 */
export const GROUP_BLANK_LABEL = "(Blanks)";

/**
 * Expanded state of one group, read off a snapshot.
 *
 * The engine stores expansion as a DEFAULT plus a set of ids that differ from
 * it — which is what lets `expandAll`/`collapseAll` apply to groups that do not
 * exist yet — so membership in the set means "collapsed" or "expanded"
 * depending on the default. Never read the set on its own.
 */
export function isGroupExpanded(
  snapshot: Pick<
    PretableGridSnapshot,
    "groupExpansionOverrides" | "groupsDefaultExpanded"
  >,
  groupId: string,
): boolean {
  return snapshot.groupExpansionOverrides.has(groupId)
    ? !snapshot.groupsDefaultExpanded
    : snapshot.groupsDefaultExpanded;
}

/**
 * The group row one level out from `ref`, or `null` at the top level. This is
 * exactly the row `Left` on a collapsed group navigates to.
 */
export function findParentGroupRow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  ref: PretableVisibleRowRef<TRowId>,
): PretableGroupRow<TColumns> | null {
  return rowModelSnapshot.parentGroupOf(ref) ?? null;
}

/** The label a group row shows for its key value. */
export function groupLabel(value: unknown): string {
  const text = formatCellValue(value);

  return text === "" ? GROUP_BLANK_LABEL : text;
}
