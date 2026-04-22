import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createBatcher } from "../create-batcher";
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

describe("createBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("coalesces multiple add calls into single RAF flush", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);
    batcher.add([{ id: "2", name: "Bob", score: 20 }]);

    expect(grid.calls).toHaveLength(0);

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(1);
    expect(grid.calls[0].add).toEqual([
      { id: "1", name: "Alice", score: 10 },
      { id: "2", name: "Bob", score: 20 },
    ]);

    batcher.dispose();
  });

  test("coalesces mixed add, update, remove into single transaction", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);
    batcher.update([{ id: "1", score: 99 }]);
    batcher.remove(["2"]);

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(1);
    expect(grid.calls[0]).toEqual({
      add: [{ id: "1", name: "Alice", score: 10 }],
      update: [{ id: "1", score: 99 }],
      remove: ["2"],
    });

    batcher.dispose();
  });

  test("flush() applies immediately and cancels pending RAF", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);
    batcher.flush();

    expect(grid.calls).toHaveLength(1);
    expect(grid.calls[0].add).toEqual([{ id: "1", name: "Alice", score: 10 }]);

    await vi.advanceTimersToNextTimerAsync();
    expect(grid.calls).toHaveLength(1);

    batcher.dispose();
  });

  test("flush() with empty buffers does not call applyTransaction", () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.flush();

    expect(grid.calls).toHaveLength(0);

    batcher.dispose();
  });

  test("dispose() cancels pending RAF and clears buffers", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);
    batcher.dispose();

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(0);
  });

  test("calls after dispose() are no-ops", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.dispose();
    batcher.add([{ id: "1", name: "Alice", score: 10 }]);
    batcher.update([{ id: "1", score: 99 }]);
    batcher.remove(["1"]);
    batcher.flush();

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(0);
  });

  test("empty buffers after RAF do not trigger applyTransaction", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(1);

    await vi.advanceTimersToNextTimerAsync();
    expect(grid.calls).toHaveLength(1);

    batcher.dispose();
  });

  test("new mutations after flush schedule a new RAF", async () => {
    const grid = createMockGrid();
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(1);

    batcher.add([{ id: "2", name: "Bob", score: 20 }]);

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(2);
    expect(grid.calls[1].add).toEqual([{ id: "2", name: "Bob", score: 20 }]);

    batcher.dispose();
  });

  test("subsequent mutations still batch after applyTransaction throws", async () => {
    // Contract: if grid.applyTransaction throws, the batch that triggered it
    // is lost (buffers are cleared before the call), but the batcher's
    // internal state remains consistent. Subsequent mutations schedule a new
    // RAF and land as a fresh transaction.
    let throwOnce = true;
    const calls: Array<{
      add?: TestRow[];
      update?: Partial<TestRow>[];
      remove?: string[];
    }> = [];
    const grid: GridLike<TestRow> = {
      applyTransaction(tx) {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("grid boom");
        }
        calls.push(tx);
      },
    };
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);

    // First RAF: applyTransaction throws. The rejection propagates out of
    // the RAF callback — vitest's fake-RAF surfaces it as a test failure
    // unless we tolerate it. Using a process-level guard is overkill here;
    // instead catch via try/await on the timer advance.
    await expect(vi.advanceTimersToNextTimerAsync()).rejects.toThrow(
      "grid boom",
    );

    expect(calls).toHaveLength(0);

    // Batcher state must still be usable.
    batcher.add([{ id: "2", name: "Bob", score: 20 }]);
    await vi.advanceTimersToNextTimerAsync();

    expect(calls).toHaveLength(1);
    expect(calls[0].add).toEqual([{ id: "2", name: "Bob", score: 20 }]);

    batcher.dispose();
  });
});
