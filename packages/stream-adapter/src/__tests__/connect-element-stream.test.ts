import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { connectElementStream } from "../connect-element-stream";
import type { RowModelLike } from "../types";

type TestRow = {
  id: string;
  name: string;
};

function createMockGrid(): RowModelLike<TestRow, string> & {
  calls: Array<{
    add?: TestRow[];
    update?: { id: string; changes: Partial<TestRow> }[];
    remove?: string[];
  }>;
} {
  const calls: Array<{
    add?: TestRow[];
    update?: { id: string; changes: Partial<TestRow> }[];
    remove?: string[];
  }> = [];
  return {
    calls,
    applyTransaction(tx) {
      calls.push(tx);
    },
  };
}

async function* asyncFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe("connectElementStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("complete objects are batched as adds", async () => {
    const grid = createMockGrid();
    const rows: TestRow[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];

    const conn = connectElementStream(grid, asyncFrom(rows));

    await vi.advanceTimersToNextTimerAsync();
    await conn.done;

    expect(grid.calls.length).toBeGreaterThanOrEqual(1);
    const allAdds = grid.calls.flatMap((c) => c.add ?? []);
    expect(allAdds).toEqual(rows);
  });

  test("done resolves when iterable completes", async () => {
    const grid = createMockGrid();
    const conn = connectElementStream(grid, asyncFrom([]));

    await conn.done;
  });

  test("done rejects when iterable throws", async () => {
    const grid = createMockGrid();

    async function* throwing(): AsyncIterable<TestRow> {
      yield { id: "1", name: "Alice" };
      throw new Error("stream error");
    }

    const conn = connectElementStream(grid, throwing());

    await vi.advanceTimersToNextTimerAsync();
    await expect(conn.done).rejects.toThrow("stream error");
  });

  test("dispose() stops iteration and flushes remaining", async () => {
    const grid = createMockGrid();

    async function* slow(): AsyncIterable<TestRow> {
      for (let i = 0; i < 100; i++) {
        yield { id: String(i), name: `row-${i}` };
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const conn = connectElementStream(grid, slow());

    await vi.advanceTimersByTimeAsync(50);

    conn.dispose();

    const totalAdds = grid.calls.flatMap((c) => c.add ?? []).length;
    expect(totalAdds).toBeGreaterThan(0);
    expect(totalAdds).toBeLessThan(100);

    await conn.done;
  });

  test("multiple elements within one frame are coalesced", async () => {
    const grid = createMockGrid();

    async function* burst(): AsyncIterable<TestRow> {
      yield { id: "1", name: "Alice" };
      yield { id: "2", name: "Bob" };
      yield { id: "3", name: "Carol" };
    }

    const conn = connectElementStream(grid, burst());

    await vi.advanceTimersToNextTimerAsync();
    await conn.done;

    const allAdds = grid.calls.flatMap((c) => c.add ?? []);
    expect(allAdds).toHaveLength(3);
  });

  test("settles once with the source error when catch-path flushing throws", async () => {
    const sourceError = new Error("element source failed");
    const flushError = new Error("element flush failed");
    const rowModel: RowModelLike<TestRow, string> = {
      applyTransaction() {
        throw flushError;
      },
    };
    async function* throwing(): AsyncIterable<TestRow> {
      yield { id: "1", name: "buffered" };
      throw sourceError;
    }
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const connection = connectElementStream(rowModel, throwing());
      let settlements = 0;
      const outcome = connection.done.then(
        () => {
          settlements += 1;
          return { kind: "resolved" as const };
        },
        (error) => {
          settlements += 1;
          return { kind: "rejected" as const, error };
        },
      );
      await vi.advanceTimersByTimeAsync(100);
      const timed = await Promise.race([
        outcome,
        Promise.resolve({ kind: "pending" as const }),
      ]);

      expect(timed).toEqual({ kind: "rejected", error: sourceError });
      expect(settlements).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
