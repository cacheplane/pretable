/**
 * Structural contract for a row model that accepts atomic row transactions.
 * The adapter depends only on this ID-generic shape, so callers may pass a
 * Pretable row model or a compatible custom implementation.
 *
 * @public
 */
export interface RowModelLike<
  TRow extends object,
  TRowId extends string | number,
> {
  readonly applyTransaction: (transaction: {
    add?: TRow[];
    update?: {
      id: TRowId;
      changes: Partial<TRow>;
    }[];
    remove?: TRowId[];
  }) => void | {
    readonly issues?: readonly {
      readonly code: string;
      readonly rowId?: TRowId;
    }[];
  };
}

/**
 * RAF-batched mutator returned by {@link createBatcher}. Buffer
 * `add` / `update` / `remove` calls; the batcher coalesces them into a
 * single `applyTransaction` per animation frame. `flush()` forces an
 * immediate apply; `dispose()` cancels any pending RAF and stops
 * accepting new calls.
 *
 * @public
 */
export interface TransactionBatcher<
  TRow extends object,
  TRowId extends string | number,
> {
  /** Rejects with the exact model error from a scheduled RAF transaction. */
  readonly error: Promise<never>;
  /** Observes a scheduled model failure synchronously before later races. */
  readonly subscribeError: (listener: (error: unknown) => void) => () => void;
  readonly add: (rows: readonly TRow[]) => void;
  readonly update: (
    patches: readonly {
      readonly id: TRowId;
      readonly changes: Partial<TRow>;
    }[],
  ) => void;
  readonly remove: (ids: readonly TRowId[]) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

/**
 * Handle returned by the `connect*Stream` functions. `done` resolves
 * when the source stream ends (or rejects on stream error); `dispose()`
 * cancels the active read loop and resolves `done` immediately.
 *
 * @public
 */
export interface StreamConnection {
  readonly done: Promise<void>;
  readonly dispose: () => void;
}
