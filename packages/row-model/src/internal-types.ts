import type {
  CompiledQuery,
  CompiledRowMetadata,
  CompiledSortKey,
} from "./compiled-query";
import type { PretableRowId } from "./column-types";
import type { OrderStatisticTree } from "./persistent/order-statistic-tree";
import type { PersistentMap } from "./persistent/persistent-map";
import type { RowIntegrityRecord } from "./row-integrity";
import type {
  PretableDataRow,
  PretableExpansionDefault,
  PretableExpansionState,
  PretableGroupId,
} from "./types";

export interface SourceOrderKey<TRowId extends PretableRowId> {
  readonly rowId: TRowId;
  readonly sourceOrder: number;
}

export interface RowRecord<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly sourceOrder: number;
  /**
   * Dense integer handle, assigned at ingest, stable for the row's lifetime
   * (updates carry it; only permanent removal releases it). Slot-indexed
   * structures (`recordsBySlot`, `visibleSlots`) are the array-resident fast
   * path that replaces string-keyed lookups on O(n) walks.
   */
  readonly slot: number;
  readonly metadata: CompiledRowMetadata<TRow, TRowId, TColumns>;
  readonly publicRow: PretableDataRow<TRow, TRowId>;
  readonly integrity: RowIntegrityRecord;
}

export interface ExpansionRoot {
  readonly default: PretableExpansionDefault;
  readonly overrides: PersistentMap<PretableGroupId, boolean>;
  readonly state: PretableExpansionState;
}

/**
 * A visible-tree entry: the record decorated with its sort keys, resolved
 * exactly once at insert. Comparators become property reads — zero WeakMap
 * gets on any O(n log n) or per-insert comparison path (the measured grouped
 * gate regression). Keys are valid for the tree's lifetime: a tree is bound
 * to one plan (the A2 rebuild-or-reseed invariant), and entry replacement on
 * row update replaces the keys with the entry.
 */
export interface OrderedRowEntry<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly record: RowRecord<TRow, TRowId, TColumns>;
  readonly keys: readonly CompiledSortKey<TColumns>[];
}

export interface VisibleIndexRoot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: OrderStatisticTree<
    TRowId,
    OrderedRowEntry<TRow, TRowId, TColumns>,
    number
  >;
}

export type PretableRevisionCause =
  | { readonly kind: "initial" }
  | { readonly kind: "set-rows" }
  | { readonly kind: "set-query" }
  | { readonly kind: "set-derivations" };

export interface RevisionRoot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly rows: PersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>;
  readonly sourceOrder: OrderStatisticTree<
    TRowId,
    SourceOrderKey<TRowId>,
    number
  >;
  readonly visible: VisibleIndexRoot<TRow, TRowId, TColumns>;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly expansion: ExpansionRoot;
  readonly cause: PretableRevisionCause;
}
