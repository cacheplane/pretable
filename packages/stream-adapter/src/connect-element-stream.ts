import type { GridLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

type Settled =
  | { status: "pending" }
  | { status: "resolved" }
  | { status: "rejected"; reason: unknown };

export function connectElementStream<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<TRow>,
): StreamConnection {
  const batcher = createBatcher(grid);
  let disposed = false;
  let settled: Settled = { status: "pending" };
  const waiters: Array<{
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];

  function settle(next: Settled): void {
    if (settled.status !== "pending") return;
    settled = next;
    for (const w of waiters) {
      if (next.status === "resolved") w.resolve();
      else if (next.status === "rejected") w.reject(next.reason);
    }
    waiters.length = 0;
  }

  (async () => {
    try {
      for await (const element of stream) {
        if (disposed) break;
        batcher.add([element]);
      }
      batcher.flush();
      batcher.dispose();
      settle({ status: "resolved" });
    } catch (err) {
      batcher.flush();
      batcher.dispose();
      settle({ status: "rejected", reason: err });
    }
  })();

  return {
    get done(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (settled.status === "resolved") resolve();
        else if (settled.status === "rejected") reject(settled.reason);
        else waiters.push({ resolve, reject });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      batcher.flush();
      batcher.dispose();
      settle({ status: "resolved" });
    },
  };
}
