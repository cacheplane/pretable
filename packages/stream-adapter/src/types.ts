/**
 * Structural type for any grid that supports applyTransaction.
 * Avoids hard coupling to @pretable-internal/grid-core.
 */
export interface GridLike<TRow extends Record<string, unknown>> {
  applyTransaction(transaction: {
    add?: TRow[];
    update?: Partial<TRow>[];
    remove?: string[];
  }): void;
}

export interface TransactionBatcher<TRow extends Record<string, unknown>> {
  add(rows: TRow[]): void;
  update(patches: Partial<TRow>[]): void;
  remove(ids: string[]): void;
  flush(): void;
  dispose(): void;
}

export interface StreamConnection {
  done: Promise<void>;
  dispose(): void;
}
