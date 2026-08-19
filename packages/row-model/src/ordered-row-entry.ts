import type { PretableRowId } from "./column-types";
import { sortKeysOf, type CompiledQuery } from "./compiled-query";
import type { OrderedRowEntry, RowRecord } from "./internal-types";

/**
 * Standalone module because both visible-index and group-index need it and
 * visible-index already imports group-index — either home would cycle.
 *
 * Decorates a record for tree residence: ONE store get, at insert time. The
 * record must already be evaluated (or swap-filled) under `queryPlan` —
 * `sortKeysOf` throws otherwise, which is the fail-loud contract. Entry keys
 * stay valid for the tree's lifetime because a tree is bound to one plan
 * (the A2 rebuild-or-reseed invariant) and row updates replace the entry.
 */
export function orderedRowEntry<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  queryPlan: CompiledQuery<TColumns>,
  record: RowRecord<TRow, TRowId, TColumns>,
): OrderedRowEntry<TRow, TRowId, TColumns> {
  return Object.freeze({
    record,
    keys: sortKeysOf<TColumns, TRowId>(queryPlan, record as never),
  });
}
