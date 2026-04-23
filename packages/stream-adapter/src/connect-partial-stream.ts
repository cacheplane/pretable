import type { GridLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

export interface PartialStreamOptions {
  rowId: string;
}

export function connectPartialStream<
  TRow extends Record<string, unknown> & { id: string },
>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<Partial<TRow>>,
  options: PartialStreamOptions,
): StreamConnection {
  const batcher = createBatcher(grid);
  let disposed = false;

  let resolveDone!: () => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // Swallow unhandled-rejection warnings if the caller hasn't attached a
  // handler before the stream rejects. Consumers that await `done` still
  // observe the rejection — attaching `.catch` here doesn't consume it.
  done.catch(() => undefined);

  (async () => {
    try {
      for await (const partial of stream) {
        if (disposed) break;
        batcher.update([{ ...partial, id: options.rowId } as Partial<TRow>]);
      }
      batcher.flush();
      batcher.dispose();
      resolveDone();
    } catch (err) {
      batcher.flush();
      batcher.dispose();
      rejectDone(err);
    }
  })();

  return {
    done,
    dispose() {
      if (disposed) return;
      disposed = true;
      batcher.flush();
      batcher.dispose();
      resolveDone();
    },
  };
}
