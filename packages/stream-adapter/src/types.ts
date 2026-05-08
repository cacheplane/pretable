/**
 * Structural type for any grid that supports `applyTransaction`. Avoids
 * hard coupling to `@pretable-internal/grid-core` so consumers can wire
 * up streaming against a custom grid implementation that conforms to the
 * same shape.
 *
 * @public
 */
export interface GridLike<TRow extends Record<string, unknown>> {
  applyTransaction(transaction: {
    add?: TRow[];
    update?: Partial<TRow>[];
    remove?: string[];
  }): void;
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
export interface TransactionBatcher<TRow extends Record<string, unknown>> {
  add(rows: TRow[]): void;
  update(patches: Partial<TRow>[]): void;
  remove(ids: string[]): void;
  flush(): void;
  dispose(): void;
}

/**
 * Handle returned by the `connect*Stream` functions. `done` resolves
 * when the source stream ends (or rejects on stream error); `dispose()`
 * cancels the active read loop and resolves `done` immediately.
 *
 * @public
 */
export interface StreamConnection {
  done: Promise<void>;
  dispose(): void;
}
