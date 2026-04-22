import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { connectElementStream } from "../connect-element-stream";
import type { GridLike } from "../types";

interface TestRow {
  id: string;
  name: string;
}

function createMockGrid(): GridLike<TestRow> & {
  calls: Array<{ add?: TestRow[]; update?: Partial<TestRow>[]; remove?: string[] }>;
} {
  const calls: Array<{ add?: TestRow[]; update?: Partial<TestRow>[]; remove?: string[] }> = [];
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

    let yieldCount = 0;
    async function* slow(): AsyncIterable<TestRow> {
      for (let i = 0; i < 100; i++) {
        yieldCount++;
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
});
