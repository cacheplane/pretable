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
  const iterator = stream[Symbol.asyncIterator]();
  const batcher = createBatcher(rowModel);
  let disposed = false;
  let sourceClosed = false;

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

  const closeSource = () => {
    if (sourceClosed) return;
    sourceClosed = true;
    try {
      const closing = iterator.return?.();
      if (closing !== undefined)
        void Promise.resolve(closing).catch(() => undefined);
    } catch {
      // Source closure is best-effort; the transaction/source failure remains
      // the exact public rejection.
    }
  };

  let settled = false;
  const settle = (
    failure?: { readonly error: unknown },
    flush = true,
    close = failure !== undefined,
  ) => {
    if (settled) return;
    settled = true;
    disposed = true;
    if (close) closeSource();
    let finalFailure = failure;
    if (flush) {
      try {
        batcher.flush();
      } catch (error) {
        finalFailure ??= { error };
      }
    }
    batcher.dispose();
    if (finalFailure === undefined) resolveDone();
    else rejectDone(finalFailure.error);
  };

  batcher.subscribeError((error: unknown) => {
    settle({ error }, false, true);
  });

  void (async () => {
    try {
      while (!disposed) {
        const result = await iterator.next();
        if (disposed) return;
        if (result.done) {
          settle();
          return;
        }
        batcher.add([result.value]);
      }
    } catch (err) {
      settle({ error: err }, true, true);
    }
  })().catch((error: unknown) => settle({ error }));

  return {
    done,
    dispose() {
      if (disposed) return;
      settle(undefined, true, true);
    },
  };
}
