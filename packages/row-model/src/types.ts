import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableAggregatesFor,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import type { PretableRowModelError } from "./errors";

declare const groupIdBrand: unique symbol;
declare const rowModelDescriptor: unique symbol;

export type PretableGroupId = string & {
  readonly [groupIdBrand]: "PretableGroupId";
};

export type PretableVisibleRowRef<TRowId extends PretableRowId> =
  | { readonly kind: "data"; readonly rowId: TRowId }
  | { readonly kind: "group"; readonly groupId: PretableGroupId };

export interface PretableDataRow<
  TRow extends object,
  TRowId extends PretableRowId,
> {
  readonly kind: "data";
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly sourceIndex: number;
  readonly depth: number;
}

export interface PretableGroupRow<TColumns = readonly []> {
  readonly kind: "group";
  readonly groupId: PretableGroupId;
  readonly depth: number;
  readonly columnId: string;
  readonly value: unknown;
  readonly childCount: number;
  readonly aggregates: PretableAggregatesFor<TColumns>;
  readonly expanded: boolean;
}

export type PretableVisibleRow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns = readonly [],
> = PretableDataRow<TRow, TRowId> | PretableGroupRow<TColumns>;

export type PretableExpansionDefault =
  | { readonly kind: "collapsed" }
  | { readonly kind: "expanded" }
  | { readonly kind: "through-depth"; readonly depth: number };

export interface PretableExpansionState {
  readonly default: PretableExpansionDefault;
  readonly overrideCount: number;
}

export interface PretableRowModelSnapshot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly revision: number;
  readonly sourceRowCount: number;
  readonly visibleRowCount: number;
  readonly visibleDataRowCount: number;

  rowAt(index: number): PretableVisibleRow<TRow, TRowId, TColumns> | undefined;
  range(
    start: number,
    end: number,
  ): readonly PretableVisibleRow<TRow, TRowId, TColumns>[];
  indexOf(ref: PretableVisibleRowRef<TRowId>): number;
  dataRowAt(index: number): PretableDataRow<TRow, TRowId> | undefined;
  firstDataRow(): PretableDataRow<TRow, TRowId> | undefined;
  lastDataRow(): PretableDataRow<TRow, TRowId> | undefined;
  nextDataRow(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableDataRow<TRow, TRowId> | undefined;
  previousDataRow(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableDataRow<TRow, TRowId> | undefined;
  parentGroupOf(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableGroupRow<TColumns> | undefined;
  nearestVisibleRef(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableVisibleRowRef<TRowId> | undefined;
  isGroupExpanded(groupId: PretableGroupId): boolean;

  readonly query: Readonly<PretableQueryFor<TColumns>>;
  readonly expansion: Readonly<PretableExpansionState>;
}

export type PretableRowModelStatus =
  | { readonly kind: "ready" }
  | {
      readonly kind: "rebuilding";
      readonly transitionId: number;
      readonly completedRows: number;
      readonly totalRows: number;
    }
  | {
      readonly kind: "error";
      readonly transitionId: number;
      readonly error: PretableRowModelError;
    }
  | { readonly kind: "disposed" };

export interface PretableRowModelState<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly status: PretableRowModelStatus;
}

export interface PretableRowUpdate<
  TRow extends object,
  TRowId extends PretableRowId,
> {
  readonly id: TRowId;
  readonly changes: Partial<TRow>;
}

export interface PretableTransaction<
  TRow extends object,
  TRowId extends PretableRowId,
> {
  readonly add?: readonly TRow[];
  readonly update?: readonly PretableRowUpdate<TRow, TRowId>[];
  readonly remove?: readonly TRowId[];
}

export type PretableMutationIssue<TRowId extends PretableRowId> =
  | { readonly code: "unknown-update-id"; readonly rowId: TRowId }
  | { readonly code: "unknown-remove-id"; readonly rowId: TRowId }
  | { readonly code: "unknown-group-id"; readonly groupId: PretableGroupId };

export interface PretableMutationResult<TRowId extends PretableRowId> {
  readonly previousRevision: number;
  readonly revision: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly ignored: number;
  readonly issues: readonly PretableMutationIssue<TRowId>[];
}

export interface PretableQueryTransition<TColumns> {
  readonly id: number;
  readonly requestedQuery: Readonly<PretableQueryFor<TColumns>>;
  readonly finished: Promise<number>;
  cancel(): void;
}

export interface PretableDerivationTransition<TColumns> {
  readonly id: number;
  readonly requestedDerivations: PretableDerivationsFor<TColumns>;
  readonly finished: Promise<number>;
  cancel(): void;
}

export type PretableVisibleRowField =
  "row" | "depth" | "expanded" | "childCount" | "aggregates";

export type PretableChangeOperation<TRowId extends PretableRowId> =
  | {
      readonly kind: "insert";
      readonly ref: PretableVisibleRowRef<TRowId>;
      readonly index: number;
    }
  | {
      readonly kind: "remove";
      readonly ref: PretableVisibleRowRef<TRowId>;
      readonly previousIndex: number;
    }
  | {
      readonly kind: "move";
      readonly ref: PretableVisibleRowRef<TRowId>;
      readonly previousIndex: number;
      readonly index: number;
    }
  | {
      readonly kind: "update";
      readonly ref: PretableVisibleRowRef<TRowId>;
      readonly index: number;
      readonly fields: readonly PretableVisibleRowField[];
    };

export interface PretableChangeSet<TRowId extends PretableRowId> {
  readonly previousRevision: number;
  readonly revision: number;
  readonly operations: readonly PretableChangeOperation<TRowId>[];
}

export type PretableChangeSequence<TRowId extends PretableRowId> =
  | {
      readonly kind: "changes";
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly changes: readonly PretableChangeSet<TRowId>[];
    }
  | {
      readonly kind: "reset";
      readonly toRevision: number;
      readonly reason: "unknown-revision" | "journal-evicted" | "bulk-replace";
    };

export interface PretableDistinctValueOptions {
  readonly search?: string;
  readonly start?: number;
  readonly limit?: number;
  readonly population?: "all" | "filtered";
}

export interface PretableDistinctValueResult<TValue> {
  readonly values: readonly {
    readonly value: TValue;
    readonly count: number;
  }[];
  readonly totalDistinct: number;
  readonly population: "all" | "filtered";
  readonly rowModelRevision: number;
}

export interface PretableDistinctValueQuery<TValue> {
  readonly status: "pending" | "ready" | "error" | "cancelled";
  readonly finished: Promise<PretableDistinctValueResult<TValue>>;
  cancel(): void;
}

export interface PretableRowModelCarrier<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly [rowModelDescriptor]: {
    readonly row: TRow;
    readonly rowId: TRowId;
    readonly columns: TColumns;
  };
}

export interface PretableRowModel<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> extends PretableRowModelCarrier<TRow, TRowId, TColumns> {
  getState(): PretableRowModelState<TRow, TRowId, TColumns>;
  getColumns(): TColumns;
  subscribe(listener: () => void): () => void;

  setRows(rows: readonly TRow[]): PretableMutationResult<TRowId>;
  applyTransaction(
    transaction: PretableTransaction<TRow, TRowId>,
  ): PretableMutationResult<TRowId>;
  setQuery(
    query: PretableQueryFor<TColumns>,
  ): PretableQueryTransition<TColumns>;
  setDerivations(
    derivations: PretableDerivationsFor<TColumns>,
  ): PretableDerivationTransition<TColumns>;
  setGroupExpanded(
    groupId: PretableGroupId,
    expanded: boolean,
  ): PretableMutationResult<TRowId>;
  setExpansionDefault(
    policy: PretableExpansionDefault,
    options?: { readonly preserveOverrides?: boolean },
  ): PretableMutationResult<TRowId>;
  expandAll(): PretableMutationResult<TRowId>;
  collapseAll(): PretableMutationResult<TRowId>;

  changesSince(revision: number): PretableChangeSequence<TRowId>;
  distinctValues<TColumnId extends ColumnIdOf<TColumns>>(
    columnId: TColumnId,
    options?: PretableDistinctValueOptions,
  ): PretableDistinctValueQuery<ColumnValueOf<TColumns, TColumnId>>;

  dispose(): void;
}

export type RowOf<TModel> =
  TModel extends PretableRowModelCarrier<infer TRow, PretableRowId, unknown>
    ? TRow
    : never;

export type RowIdOf<TModel> =
  TModel extends PretableRowModelCarrier<object, infer TRowId, unknown>
    ? TRowId
    : never;

export type ColumnsOf<TModel> =
  TModel extends PretableRowModelCarrier<object, PretableRowId, infer TColumns>
    ? TColumns
    : never;
