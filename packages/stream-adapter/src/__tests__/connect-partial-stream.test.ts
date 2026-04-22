import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { connectPartialStream } from "../connect-partial-stream";
import type { GridLike } from "../types";

interface TestRow {
  id: string;
  name: string;
  score: number;
}

function createMockGrid(): GridLike<TestRow> & {
  calls: Array<{
    add?: TestRow[];
    update?: Partial<TestRow>[];
    remove?: string[];
  }>;
} {
  const calls: Array<{
    add?: TestRow[];
    update?: Partial<TestRow>[];
    remove?: string[];
  }> = [];
  return {
    calls,
    applyTransaction(tx) {
      calls.push(tx);
    },
  };
}

describe("connectPartialStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("progressive partials are batched as updates", async () => {
    const grid = createMockGrid();

    async function* partials(): AsyncIterable<Partial<TestRow>> {
      yield { id: "row-1", name: "Al" };
      yield { id: "row-1", name: "Alice" };
      yield { id: "row-1", name: "Alice", score: 100 };
    }

    const conn = connectPartialStream(grid, partials(), { rowId: "row-1" });

    await vi.advanceTimersToNextTimerAsync();
    await conn.done;

    const allUpdates = grid.calls.flatMap((c) => c.update ?? []);
    expect(allUpdates).toHaveLength(3);
    expect(allUpdates[0]).toEqual({ id: "row-1", name: "Al" });
    expect(allUpdates[2]).toEqual({ id: "row-1", name: "Alice", score: 100 });
  });

  test("rowId is injected into each partial", async () => {
    const grid = createMockGrid();

    async function* partials(): AsyncIterable<Partial<TestRow>> {
      yield { name: "Alice" };
      yield { name: "Alice", score: 100 };
    }

    const conn = connectPartialStream(grid, partials(), { rowId: "row-1" });

    await vi.advanceTimersToNextTimerAsync();
    await conn.done;

    const allUpdates = grid.calls.flatMap((c) => c.update ?? []);
    for (const u of allUpdates) {
      expect(u.id).toBe("row-1");
    }
  });

  test("multiple partials within one frame are coalesced", async () => {
    const grid = createMockGrid();

    async function* burst(): AsyncIterable<Partial<TestRow>> {
      yield { name: "A" };
      yield { name: "Al" };
      yield { name: "Ali" };
    }

    const conn = connectPartialStream(grid, burst(), { rowId: "row-1" });

    await vi.advanceTimersToNextTimerAsync();
    await conn.done;

    const allUpdates = grid.calls.flatMap((c) => c.update ?? []);
    expect(allUpdates).toHaveLength(3);
  });

  test("done resolves when iterable completes", async () => {
    const grid = createMockGrid();

    async function* empty(): AsyncIterable<Partial<TestRow>> {
      // empty
    }

    const conn = connectPartialStream(grid, empty(), { rowId: "row-1" });
    await conn.done;
  });

  test("done rejects when iterable throws", async () => {
    const grid = createMockGrid();

    async function* throwing(): AsyncIterable<Partial<TestRow>> {
      yield { name: "Alice" };
      throw new Error("partial error");
    }

    const conn = connectPartialStream(grid, throwing(), { rowId: "row-1" });

    await vi.advanceTimersToNextTimerAsync();
    await expect(conn.done).rejects.toThrow("partial error");
  });

  test("dispose() stops iteration and flushes", async () => {
    const grid = createMockGrid();

    async function* slow(): AsyncIterable<Partial<TestRow>> {
      for (let i = 0; i < 100; i++) {
        yield { name: `name-${i}` };
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const conn = connectPartialStream(grid, slow(), { rowId: "row-1" });

    await vi.advanceTimersByTimeAsync(50);
    conn.dispose();

    const totalUpdates = grid.calls.flatMap((c) => c.update ?? []).length;
    expect(totalUpdates).toBeGreaterThan(0);
    expect(totalUpdates).toBeLessThan(100);

    await conn.done;
  });
});
