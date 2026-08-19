import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableAggregatesFor,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import type { PretableRowModelError } from "./errors";

/**
 * Brand keys are STRING literals, not `unique symbol`s, and that is load-bearing
 * packaging rather than style.
 *
 * These types ship to consumers three ways at once: `tsc` emits them into
 * `row-model/dist`, and `tsup`'s bundled `.d.ts` re-emits them into
 * `core/dist` (`noExternal`) — with `@pretable/react` compiling against BOTH at
 * once. A `unique symbol` is nominal PER DECLARATION FILE, so each re-emission
 * minted a fresh, incompatible brand: `PretableGroupId` from `row-model/dist`
 * was not assignable to `PretableGroupId` from `core/dist` despite being the
 * same declaration, and `RowOf<>`/`ColumnsOf<>` — which match structurally on
 * `~pretableRowModel` — silently resolved to `never` across the seam. The
 * repository carried two `as unknown as` casts to paper over exactly that.
 *
 * A string-literal key is structural, so N copies of the declaration are one
 * type. Nominality is unchanged in practice: `PretableGroupId` is
 * `string & {...}`, which no literal can inhabit without a cast, and the `~`
 * prefix keeps the key unwritable as an identifier (the Standard Schema
 * convention). `scripts/__tests__/public-api-symbol-brands.test.mjs` fails the
 * build if a symbol-keyed brand reappears in a published API report.
 */

/** @public */
export type PretableGroupId = string & {
  readonly "~pretableGroupId": "PretableGroupId";
};

/** @public */
export type PretableVisibleRowRef<TRowId extends PretableRowId> =
  | { readonly kind: "data"; readonly rowId: TRowId }
  | { readonly kind: "group"; readonly groupId: PretableGroupId };

/** @public */
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

/** @public */
export type PretableGroupRow<TColumns> = {
  readonly [TColumnId in ColumnIdOf<TColumns>]: {
    readonly kind: "group";
    readonly groupId: PretableGroupId;
    readonly depth: number;
    readonly columnId: TColumnId;
    readonly value: ColumnValueOf<TColumns, TColumnId>;
    readonly childCount: number;
    readonly aggregates: PretableAggregatesFor<TColumns>;
    readonly expanded: boolean;
  };
}[ColumnIdOf<TColumns>];

/** @public */
export type PretableVisibleRow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> = PretableDataRow<TRow, TRowId> | PretableGroupRow<TColumns>;

/** @public */
export type PretableExpansionDefault =
  | { readonly kind: "collapsed" }
  | { readonly kind: "expanded" }
  | { readonly kind: "through-depth"; readonly depth: number };

/** @public */
export interface PretableExpansionState {
  readonly default: PretableExpansionDefault;
  readonly overrideCount: number;
}

/** @public */
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
  /**
   * Returns the half-open visible-row interval `[start, end)`. Both bounds are
   * clamped to `[0, visibleRowCount]`.
   */
  range(
    start: number,
    end: number,
  ): readonly PretableVisibleRow<TRow, TRowId, TColumns>[];
  /** Returns the visible rank of `ref`, or `-1` when it is absent. */
  indexOf(ref: PretableVisibleRowRef<TRowId>): number;
  /** Returns the data-only rank of `ref`, or `-1` when it is absent. */
  dataIndexOf(ref: PretableVisibleRowRef<TRowId>): number;
  /**
   * Returns the data row at a data-only rank. Group rows do not consume an
   * index; an out-of-bounds rank returns `undefined`.
   */
  dataRowAt(index: number): PretableDataRow<TRow, TRowId> | undefined;
  /** Returns the first visible data row, or `undefined` when none is visible. */
  firstDataRow(): PretableDataRow<TRow, TRowId> | undefined;
  /** Returns the last visible data row, or `undefined` when none is visible. */
  lastDataRow(): PretableDataRow<TRow, TRowId> | undefined;
  /**
   * Returns the next visible data row after `ref`, skipping group rows, or
   * `undefined` when `ref` is absent or has no following data row.
   */
  nextDataRow(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableDataRow<TRow, TRowId> | undefined;
  /**
   * Returns the previous visible data row before `ref`, skipping group rows,
   * or `undefined` when `ref` is absent or has no preceding data row.
   */
  previousDataRow(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableDataRow<TRow, TRowId> | undefined;
  /** Returns the immediate parent group of `ref`, if it has one. */
  parentGroupOf(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableGroupRow<TColumns> | undefined;
  /**
   * Returns `ref` when visible, otherwise its nearest visible ancestor group;
   * returns `undefined` when neither the ref nor a visible ancestor is known.
   */
  nearestVisibleRef(
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableVisibleRowRef<TRowId> | undefined;
  isGroupExpanded(groupId: PretableGroupId): boolean;

  readonly query: Readonly<PretableQueryFor<TColumns>>;
  readonly expansion: Readonly<PretableExpansionState>;
}

/** @public */
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

/** @public */
export interface PretableRowModelState<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly status: PretableRowModelStatus;
}

/** @public */
export interface PretableRowUpdate<
  TRow extends object,
  TRowId extends PretableRowId,
> {
  readonly id: TRowId;
  /**
   * An enumerable-own-data-property patch for an ordinary object or
   * null-prototype record. Class instances, arrays, built-in exotic objects,
   * and proxies are not valid partial-update targets because cloning them
   * would lose private state or observable behavior. Replace those values
   * atomically with `setRows` instead. Development builds enforce this for
   * rows that cannot be verified and frozen; production trusts this contract
   * without reflection or proxy detection.
   */
  readonly changes: Partial<TRow>;
}

/** @public */
export interface PretableTransaction<
  TRow extends object,
  TRowId extends PretableRowId,
> {
  readonly add?: readonly TRow[];
  readonly update?: readonly PretableRowUpdate<TRow, TRowId>[];
  readonly remove?: readonly TRowId[];
}

/** @public */
export type PretableMutationIssue<TRowId extends PretableRowId> =
  | { readonly code: "unknown-update-id"; readonly rowId: TRowId }
  | { readonly code: "unknown-remove-id"; readonly rowId: TRowId }
  | { readonly code: "unknown-group-id"; readonly groupId: PretableGroupId };

/** @public */
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

/** @public */
export interface PretableQueryTransition<TColumns> {
  readonly id: number;
  readonly requestedQuery: Readonly<PretableQueryFor<TColumns>>;
  readonly finished: Promise<number>;
  cancel(): void;
}

/** @public */
export interface PretableDerivationTransition<TColumns> {
  readonly id: number;
  readonly requestedDerivations: Readonly<PretableDerivationsFor<TColumns>>;
  readonly finished: Promise<number>;
  cancel(): void;
}

/** @public */
export type PretableVisibleRowField =
  "row" | "depth" | "expanded" | "childCount" | "aggregates";

/** @public */
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

/** @public */
export interface PretableChangeSet<TRowId extends PretableRowId> {
  /** The snapshot revision to which the first operation applies. */
  readonly previousRevision: number;
  /** The atomically published revision produced by the complete operation list. */
  readonly revision: number;
  /**
   * Applies sequentially: every index is measured after the preceding
   * operation in this list. Row data and group fields are read from the
   * snapshot at `revision`; operations never expose mutable row-model roots.
   */
  readonly operations: readonly PretableChangeOperation<TRowId>[];
}

/** @public */
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

/** @public */
export interface PretableDistinctValueOptions {
  readonly search?: string;
  readonly start?: number;
  readonly limit?: number;
  readonly population?: "all" | "filtered";
  /** Includes nullish, NaN, and trim-empty string values. Defaults to false. */
  readonly includeBlanks?: boolean;
  /** Places included blank values before or after non-blank values. */
  readonly blankOrder?: "first" | "last";
}

/** @public */
export interface PretableDistinctValueResult<TValue> {
  readonly values: readonly {
    /** Numeric zero uses SameValueZero identity and is returned as positive zero. */
    readonly value: TValue;
    readonly count: number;
  }[];
  readonly totalDistinct: number;
  readonly population: "all" | "filtered";
  readonly rowModelRevision: number;
}

/** @public */
export interface PretableDistinctValueQuery<TValue> {
  readonly status: "pending" | "ready" | "error" | "cancelled";
  readonly finished: Promise<PretableDistinctValueResult<TValue>>;
  cancel(): void;
}

/**
 * Column IDs whose complete inferred value type has stable local identity.
 * @public
 */
export type PretableDistinctColumnIdOf<TColumns> =
  TColumns extends readonly (infer TColumn)[]
    ? TColumn extends {
        readonly id: infer TColumnId extends string;
        readonly accessor: (...args: never[]) => infer TValue;
      }
      ? [TValue] extends [
          string | number | bigint | boolean | null | undefined,
        ]
        ? [TValue] extends [never]
          ? never
          : TColumnId
        : never
      : never
    : never;

/** @public */
export interface PretableRowModel<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly ["~pretableRowModel"]: {
    readonly row: TRow;
    readonly rowId: TRowId;
    readonly columns: TColumns;
  };
  getState(): PretableRowModelState<TRow, TRowId, TColumns>;
  /**
   * Returns the immutable original schema/presentation tuple supplied when
   * this model was created. `setDerivations` replaces engine behavior only;
   * it never changes this presentation fallback or its identity.
   */
  getColumns(): TColumns;
  subscribe(listener: () => void): () => void;

  setRows(rows: readonly TRow[]): PretableMutationResult<TRowId>;
  /**
   * Applies one atomic batch. Partial updates require ordinary or
   * null-prototype row records; use `setRows` to replace proxy, class, array,
   * or other exotic row values.
   */
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

  /**
   * Returns a retained contiguous sequence through the current revision, or a
   * reset instruction when replay is no longer possible. The current revision
   * always returns an empty `changes` sequence.
   */
  changesSince(revision: number): PretableChangeSequence<TRowId>;
  distinctValues<TColumnId extends PretableDistinctColumnIdOf<TColumns>>(
    columnId: TColumnId,
    options?: PretableDistinctValueOptions,
  ): PretableDistinctValueQuery<ColumnValueOf<TColumns, TColumnId>>;

  dispose(): void;
}

/** @public */
export type RowOf<TModel> = TModel extends {
  readonly ["~pretableRowModel"]: {
    readonly row: infer TRow extends object;
  };
}
  ? TRow
  : never;

/** @public */
export type RowIdOf<TModel> = TModel extends {
  readonly ["~pretableRowModel"]: {
    readonly rowId: infer TRowId extends PretableRowId;
  };
}
  ? TRowId
  : never;

/** @public */
export type ColumnsOf<TModel> = TModel extends {
  readonly ["~pretableRowModel"]: { readonly columns: infer TColumns };
}
  ? TColumns
  : never;
