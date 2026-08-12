import type { RowModelLike, TransactionBatcher } from "./types";

/**
 * Create a `requestAnimationFrame`-batched mutator that coalesces
 * `add` / `update` / `remove` calls into a single `applyTransaction` per
 * frame. Use this when driving a row model from a stream that emits faster
 * than the browser can render.
 *
 * @example
 * ```ts
 * const batcher = createBatcher(rowModel);
 * batcher.add([{ id: "1", name: "Ada" }]);
 * batcher.update([{ id: "1", changes: { age: 36 } }]);
 * batcher.flush(); // optional — RAF will flush automatically
 * ```
 *
 * @public
 */
export function createBatcher<
  TRow extends object,
  TRowId extends string | number,
>(rowModel: RowModelLike<TRow, TRowId>): TransactionBatcher<TRow, TRowId> {
  let addBuffer: TRow[] = [];
  let updateBuffer: Array<{
    id: TRowId;
    changes: Partial<TRow>;
  }> = [];
  let removeBuffer: TRowId[] = [];
  let rafId: number | null = null;
  let disposed = false;
  let rejectError!: (error: unknown) => void;
  const errorListeners = new Set<(error: unknown) => void>();
  let failed = false;
  let failure: unknown;
  const error = new Promise<never>((_resolve, reject) => {
    rejectError = reject;
  });
  // A connector may attach after the RAF callback fires. Keep that race from
  // surfacing as an unhandled rejection while preserving the rejection for
  // every consumer that awaits the public channel.
  error.catch(() => undefined);

  function fail(error: unknown): void {
    if (disposed) return;
    disposed = true;
    failed = true;
    failure = error;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    addBuffer = [];
    updateBuffer = [];
    removeBuffer = [];
    const listeners = [...errorListeners];
    errorListeners.clear();
    for (const listener of listeners) {
      try {
        listener(error);
      } catch {
        // A hostile observer cannot replace the exact model failure.
      }
    }
    rejectError(error);
  }

  function scheduleFlush(): void {
    if (rafId !== null || disposed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (disposed) return;
      try {
        applyBuffered();
      } catch (error) {
        fail(error);
      }
    });
  }

  function applyBuffered(): void {
    if (
      addBuffer.length === 0 &&
      updateBuffer.length === 0 &&
      removeBuffer.length === 0
    ) {
      return;
    }

    const bufferedAdds = addBuffer;
    const bufferedUpdates = updateBuffer;
    const bufferedRemovals = removeBuffer;
    addBuffer = [];
    updateBuffer = [];
    removeBuffer = [];

    const transaction: {
      add?: TRow[];
      update?: Array<{ id: TRowId; changes: Partial<TRow> }>;
      remove?: TRowId[];
    } = {};

    if (bufferedAdds.length > 0) {
      transaction.add = bufferedAdds.map((row) => ({ ...row }));
    }
    if (bufferedUpdates.length > 0) {
      transaction.update = bufferedUpdates.map(({ id, changes }) => ({
        id,
        changes: { ...changes },
      }));
    }
    if (bufferedRemovals.length > 0) {
      transaction.remove = [...bufferedRemovals];
    }

    rowModel.applyTransaction(transaction);
  }

  return {
    error,
    subscribeError(listener) {
      if (failed) {
        try {
          listener(failure);
        } catch {
          // Keep the exact model failure on `error` observable.
        }
        return () => undefined;
      }
      if (disposed) return () => undefined;
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    add(rows) {
      if (disposed) return;
      addBuffer.push(...rows);
      scheduleFlush();
    },
    update(patches) {
      if (disposed) return;
      updateBuffer.push(...patches);
      scheduleFlush();
    },
    remove(ids) {
      if (disposed) return;
      removeBuffer.push(...ids);
      scheduleFlush();
    },
    flush() {
      if (disposed) return;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      applyBuffered();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      addBuffer = [];
      updateBuffer = [];
      removeBuffer = [];
      errorListeners.clear();
    },
  };
}
