import type { RowModelLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

/**
 * Drive a row model from an `AsyncIterable<TRow>`. Each yielded row is added
 * via a {@link createBatcher | RAF batcher}; the returned
 * {@link StreamConnection} resolves `done` when the stream ends and
 * supports `dispose()` for early cancellation.
 *
 * Pair with {@link parseElementStream} to turn a raw UTF-8 string stream
 * (e.g., from `fetch().body`) into a row stream end-to-end.
 *
 * @public
 */
export function connectElementStream<
  TRow extends object,
  TRowId extends string | number,
>(
  rowModel: RowModelLike<TRow, TRowId>,
  stream: AsyncIterable<TRow>,
): StreamConnection {
  const batcher = createBatcher(rowModel);
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

  let settled = false;
  const settle = (failure?: { readonly error: unknown }) => {
    if (settled) return;
    settled = true;
    disposed = true;
    let finalFailure = failure;
    try {
      batcher.flush();
    } catch (error) {
      finalFailure ??= { error };
    } finally {
      batcher.dispose();
    }
    if (finalFailure === undefined) resolveDone();
    else rejectDone(finalFailure.error);
  };

  void (async () => {
    try {
      for await (const element of stream) {
        if (disposed) break;
        batcher.add([element]);
      }
      settle();
    } catch (err) {
      settle({ error: err });
    }
  })().catch((error: unknown) => settle({ error }));

  return {
    done,
    dispose() {
      if (disposed) return;
      disposed = true;
      settle();
    },
  };
}
