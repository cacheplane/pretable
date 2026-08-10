import type { CompiledQuery, CompiledRowMetadata } from "./compiled-query";
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
  readonly metadata: CompiledRowMetadata<TRow, TRowId, TColumns>;
  readonly publicRow: PretableDataRow<TRow, TRowId>;
  readonly integrity: RowIntegrityRecord;
}

export interface ExpansionRoot {
  readonly default: PretableExpansionDefault;
  readonly overrides: PersistentMap<PretableGroupId, boolean>;
  readonly state: PretableExpansionState;
}

export interface VisibleIndexRoot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: OrderStatisticTree<
    TRowId,
    RowRecord<TRow, TRowId, TColumns>,
    number
  >;
}

export type PretableRevisionCause =
  { readonly kind: "initial" } | { readonly kind: "set-rows" };

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
