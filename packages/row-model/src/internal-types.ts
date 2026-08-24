import type {
  CompiledQuery,
  CompiledRowMetadata,
  CompiledSortKey,
} from "./compiled-query";
import type { PretableRowId } from "./column-types";
import type { OrderStatisticTree } from "./persistent/order-statistic-tree";
import type { PersistentMap } from "./persistent/persistent-map";
import type { MembershipBitset } from "./membership-bitset";
import type { RowIntegrityRecord } from "./row-integrity";
import type { SlotVector } from "./slot-vector";
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
   * (updates carry it; only permanent removal releases it). This slot is
   * what the slot-indexed structures the dense-handle arc adds next
   * (`recordsBySlot`, `visibleSlots`) will be indexed by — the
   * array-resident fast path that replaces string-keyed lookups on O(n)
   * walks. Those structures don't exist yet; this field is laid down ahead
   * of them.
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
  /**
   * Slot-indexed view of `rows` — same records, array-resident. Per-revision
   * immutable (chunked COW), which is what keeps THIS root's bindings valid
   * when the allocator later reuses a slot. Invariant, test-pinned:
   * slotVectorGet(recordsBySlot, record.slot) === record for every record in
   * `rows`, at every committed root.
   */
  readonly recordsBySlot: SlotVector<RowRecord<TRow, TRowId, TColumns>>;
  /**
   * The slot-space size this root's slot-indexed structures were built for
   * (the allocator's capacity at commit time). A root must be
   * SELF-DESCRIBING: readers size bitsets and walks from this field, never
   * from the live allocator — reading the allocator would let later growth
   * leak into a held snapshot's domain.
   */
  readonly slotCapacity: number;
  /**
   * Flat roots: one bit per slot, set iff the row is a member of
   * `visible.rows` — the same structural verdict `filter-membership`
   * resolves, indexed for O(1)/word-scan access (membership IS the verdict;
   * this is never a stored copy that could diverge). Grouped roots carry
   * `EMPTY_MEMBERSHIP` (their membership lives in the group index) and every
   * reader must treat it per that module's contract. Never mutated after the
   * root commits.
   */
  readonly visibleSlots: MembershipBitset;
  readonly visible: VisibleIndexRoot<TRow, TRowId, TColumns>;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly expansion: ExpansionRoot;
  readonly cause: PretableRevisionCause;
}
