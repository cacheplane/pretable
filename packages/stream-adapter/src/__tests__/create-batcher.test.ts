import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createBatcher } from "../create-batcher";
import type { RowModelLike } from "../types";

type TestRow = {
  id: string;
  name: string;
  score: number;
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
    batcher.update([{ id: "1", changes: { score: 99 } }]);
    batcher.remove(["2"]);

    await vi.advanceTimersToNextTimerAsync();

    expect(grid.calls).toHaveLength(1);
    expect(grid.calls[0]).toEqual({
      add: [{ id: "1", name: "Alice", score: 10 }],
      update: [{ id: "1", changes: { score: 99 } }],
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
    batcher.update([{ id: "1", changes: { score: 99 } }]);
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

  test("scheduled transaction failures reject the error channel and make later callbacks inert", async () => {
    const applyError = new Error("grid boom");
    const calls: Array<{
      add?: TestRow[];
      update?: { id: string; changes: Partial<TestRow> }[];
      remove?: string[];
    }> = [];
    const grid: RowModelLike<TestRow, string> = {
      applyTransaction(tx) {
        calls.push(tx);
        throw applyError;
      },
    };
    const batcher = createBatcher(grid);

    batcher.add([{ id: "1", name: "Alice", score: 10 }]);

    await vi.advanceTimersToNextTimerAsync();
    await expect(batcher.error).rejects.toBe(applyError);
    expect(calls).toHaveLength(1);

    batcher.add([{ id: "2", name: "Bob", score: 20 }]);
    await vi.advanceTimersToNextTimerAsync();

    expect(calls).toHaveLength(1);
    expect(calls[0].add).toEqual([{ id: "1", name: "Alice", score: 10 }]);

    batcher.dispose();
  });

  test("preserves numeric IDs in coalesced updates", async () => {
    type NumericRow = { id: number; score: number };
    const calls: Array<{
      update?: { id: number; changes: Partial<NumericRow> }[];
    }> = [];
    const rowModel: RowModelLike<NumericRow, number> = {
      applyTransaction(transaction) {
        calls.push(transaction);
      },
    };
    const batcher = createBatcher(rowModel);

    batcher.update([
      { id: 7, changes: { score: 10 } },
      { id: 8, changes: { score: 20 } },
    ]);
    await vi.advanceTimersToNextTimerAsync();

    expect(calls).toEqual([
      {
        update: [
          { id: 7, changes: { score: 10 } },
          { id: 8, changes: { score: 20 } },
        ],
      },
    ]);
    batcher.dispose();
  });

  test("publishes an atomic detached transaction even when the model throws", () => {
    const captured: object[] = [];
    const rowModel: RowModelLike<TestRow, string> = {
      applyTransaction(transaction) {
        captured.push(transaction);
        throw new Error("reject");
      },
    };
    const batcher = createBatcher(rowModel);
    const update = { id: "1", changes: { score: 99 } };
    batcher.update([update]);

    expect(() => batcher.flush()).toThrow("reject");
    update.changes.score = 0;
    expect(captured).toEqual([
      { update: [{ id: "1", changes: { score: 99 } }] },
    ]);
    batcher.dispose();
  });
});
