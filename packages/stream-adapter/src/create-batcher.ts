import type { GridLike, TransactionBatcher } from "./types";

/**
 * Create a `requestAnimationFrame`-batched mutator that coalesces
 * `add` / `update` / `remove` calls into a single `applyTransaction` per
 * frame. Use this when driving a grid from a stream that emits faster
 * than the browser can render — batching keeps DOM mutations to one per
 * frame regardless of stream rate.
 *
 * @example
 * ```ts
 * const batcher = createBatcher(grid);
 * batcher.add([{ id: "1", name: "Ada" }]);
 * batcher.update([{ id: "1", age: 36 }]);
 * batcher.flush(); // optional — RAF will flush automatically
 * ```
 *
 * @public
 */
export function createBatcher<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
): TransactionBatcher<TRow> {
  let addBuffer: TRow[] = [];
  let updateBuffer: Partial<TRow>[] = [];
  let removeBuffer: string[] = [];
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

    const tx: {
      add?: TRow[];
      update?: Partial<TRow>[];
      remove?: string[];
    } = {};

    if (addBuffer.length > 0) {
      tx.add = addBuffer;
      addBuffer = [];
    }
    if (updateBuffer.length > 0) {
      tx.update = updateBuffer;
      updateBuffer = [];
    }
    if (removeBuffer.length > 0) {
      tx.remove = removeBuffer;
      removeBuffer = [];
    }

    grid.applyTransaction(tx);
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
