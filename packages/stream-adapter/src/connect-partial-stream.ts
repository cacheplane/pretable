import type { RowModelLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

function sameValueZero<T extends string | number>(left: T, right: T): boolean {
  return (
    left === right ||
    (typeof left === "number" &&
      typeof right === "number" &&
      Number.isNaN(left) &&
      Number.isNaN(right))
  );
}

/**
 * Options for {@link connectPartialStream}. `rowId` is the fixed target for
 * every partial update. Unknown targets are reported through `onIssue`; an
 * optional `createRow` factory may turn the partial into a complete row to add.
 *
 * @public
 */
export interface PartialStreamOptions<
  TRow extends object,
  TRowId extends string | number,
> {
  readonly rowId: TRowId;
  readonly onIssue?: (issue: {
    readonly code: "unknown-update-id";
    readonly rowId: TRowId;
  }) => void;
  readonly createRow?: (partial: Partial<TRow>, id: TRowId) => TRow;
}

/**
 * Drive a row model from an `AsyncIterable<Partial<TRow>>`. Every yielded
 * partial updates the fixed `options.rowId` via a RAF-batched
 * `{ id, changes }` transaction. A missing target is reported instead of
 * fabricating a row; provide `createRow` when the stream is allowed to add one.
 *
 * Pair with {@link parsePartialStream} for end-to-end partial-update
 * streaming over UTF-8 strings.
 *
 * @public
 */
export function connectPartialStream<
  TRow extends object,
  TRowId extends string | number,
>(
  rowModel: RowModelLike<TRow, TRowId>,
  stream: AsyncIterable<Partial<TRow>>,
  options: PartialStreamOptions<TRow, TRowId>,
): StreamConnection {
  const iterator = stream[Symbol.asyncIterator]();
  const issueAwareRowModel: RowModelLike<TRow, TRowId> = {
    applyTransaction(transaction) {
      const result = rowModel.applyTransaction(transaction);
      if (result === undefined || result.issues === undefined) return result;

      let targetMissing = false;
      for (const issue of result.issues) {
        if (
          issue.code !== "unknown-update-id" ||
          issue.rowId === undefined ||
          !sameValueZero(issue.rowId, options.rowId)
        ) {
          continue;
        }
        targetMissing = true;
        options.onIssue?.({
          code: "unknown-update-id",
          rowId: options.rowId,
        });
      }

      if (targetMissing && options.createRow !== undefined) {
        const updates = transaction.update ?? [];
        const combinedChanges: Partial<TRow> = {};
        let hasTargetUpdate = false;
        for (const update of updates) {
          if (!sameValueZero(update.id, options.rowId)) continue;
          Object.assign(combinedChanges, update.changes);
          hasTargetUpdate = true;
        }
        if (hasTargetUpdate) {
          const row = options.createRow(combinedChanges, options.rowId);
          rowModel.applyTransaction({ add: [row] });
        }
      }

      return result;
    },
  };
  const batcher = createBatcher(issueAwareRowModel);
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
      // Source closure is best-effort; preserve the exact primary failure.
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
        batcher.update([{ id: options.rowId, changes: result.value }]);
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
