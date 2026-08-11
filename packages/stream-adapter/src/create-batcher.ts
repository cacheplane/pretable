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

  function scheduleFlush(): void {
    if (rafId !== null || disposed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      applyBuffered();
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
    },
  };
}
