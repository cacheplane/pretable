import type { GridLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

/**
 * Drive a grid from an `AsyncIterable<TRow>`. Each yielded row is added
 * via a {@link createBatcher | RAF batcher}; the returned
 * {@link StreamConnection} resolves `done` when the stream ends and
 * supports `dispose()` for early cancellation.
 *
 * Pair with {@link parseElementStream} to turn a raw UTF-8 string stream
 * (e.g., from `fetch().body`) into a row stream end-to-end.
 *
 * @public
 */
export function connectElementStream<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<TRow>,
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
      for await (const element of stream) {
        if (disposed) break;
        batcher.add([element]);
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
