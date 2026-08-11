import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { connectPartialStream } from "../connect-partial-stream";
import type { RowModelLike } from "../types";

type TestRow = {
  id: string;
  name: string;
  score: number;
};

function createMockGrid(existing = new Set<string>(["row-1"])): RowModelLike<
  TestRow,
  string
> & {
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
      const update = tx.update ?? [];
      const unknown = update.filter(({ id }) => !existing.has(id));
      for (const row of tx.add ?? []) existing.add(row.id);
      return {
        issues: unknown.map(({ id }) => ({
          code: "unknown-update-id" as const,
          rowId: id,
        })),
      };
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
    expect(allUpdates[0]).toEqual({
      id: "row-1",
      changes: { id: "row-1", name: "Al" },
    });
    expect(allUpdates[2]).toEqual({
      id: "row-1",
      changes: { id: "row-1", name: "Alice", score: 100 },
    });
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

  test("reports a missing target ID and never fabricates a full row", async () => {
    const rowModel = createMockGrid(new Set());
    const onIssue = vi.fn();
    async function* partials(): AsyncIterable<Partial<TestRow>> {
      yield { name: "partial only" };
    }

    const connection = connectPartialStream(rowModel, partials(), {
      rowId: "missing",
      onIssue,
    });
    await vi.advanceTimersToNextTimerAsync();
    await connection.done;

    expect(rowModel.calls.flatMap((call) => call.add ?? [])).toEqual([]);
    expect(onIssue).toHaveBeenCalledWith({
      code: "unknown-update-id",
      rowId: "missing",
    });
  });

  test("uses createRow to add a complete row after a missing-ID issue", async () => {
    const rowModel = createMockGrid(new Set());
    const createRow = vi.fn(
      (partial: Partial<TestRow>, id: string): TestRow => ({
        id,
        name: String(partial.name ?? ""),
        score: Number(partial.score ?? 0),
      }),
    );
    async function* partials(): AsyncIterable<Partial<TestRow>> {
      yield { name: "created", score: 4 };
    }

    const connection = connectPartialStream(rowModel, partials(), {
      rowId: "new-row",
      createRow,
    });
    await vi.advanceTimersToNextTimerAsync();
    await connection.done;

    expect(createRow).toHaveBeenCalledWith(
      { name: "created", score: 4 },
      "new-row",
    );
    expect(rowModel.calls.flatMap((call) => call.add ?? [])).toContainEqual({
      id: "new-row",
      name: "created",
      score: 4,
    });
  });

  test("coalesces every same-frame partial before creating a missing row", async () => {
    const rowModel = createMockGrid(new Set());
    const createRow = vi.fn(
      (partial: Partial<TestRow>, id: string): TestRow => ({
        id,
        name: String(partial.name ?? ""),
        score: Number(partial.score ?? 0),
      }),
    );
    async function* partials(): AsyncIterable<Partial<TestRow>> {
      yield { name: "created" };
      yield { score: 9 };
    }

    const connection = connectPartialStream(rowModel, partials(), {
      rowId: "new-row",
      createRow,
    });
    await vi.advanceTimersToNextTimerAsync();
    await connection.done;

    expect(createRow).toHaveBeenCalledOnce();
    expect(createRow).toHaveBeenCalledWith(
      { name: "created", score: 9 },
      "new-row",
    );
    expect(rowModel.calls.flatMap((call) => call.add ?? [])).toEqual([
      { id: "new-row", name: "created", score: 9 },
    ]);
  });

  test("preserves numeric target IDs", async () => {
    type NumericRow = { id: number; value: string };
    const calls: Array<{
      update?: { id: number; changes: Partial<NumericRow> }[];
    }> = [];
    const rowModel: RowModelLike<NumericRow, number> = {
      applyTransaction(transaction) {
        calls.push(transaction);
        return { issues: [] };
      },
    };
    async function* partials(): AsyncIterable<Partial<NumericRow>> {
      yield { value: "next" };
    }

    const connection = connectPartialStream(rowModel, partials(), {
      rowId: 42,
    });
    await vi.advanceTimersToNextTimerAsync();
    await connection.done;
    expect(calls[0]?.update).toEqual([{ id: 42, changes: { value: "next" } }]);
  });

  test("matches issue IDs with SameValueZero semantics", async () => {
    type NumericRow = { id: string | number; value: string };
    const cases = [
      { issueId: Number.NaN, targetId: Number.NaN, matches: true },
      { issueId: -0, targetId: +0, matches: true },
      { issueId: "1", targetId: 1, matches: false },
    ] as const;

    for (const { issueId, targetId, matches } of cases) {
      const onIssue = vi.fn();
      const createRow = vi.fn(
        (partial: Partial<NumericRow>, id: string | number): NumericRow => ({
          id,
          value: String(partial.value ?? ""),
        }),
      );
      const rowModel: RowModelLike<NumericRow, string | number> = {
        applyTransaction(transaction) {
          if (transaction.update !== undefined) {
            return {
              issues: [{ code: "unknown-update-id", rowId: issueId }] as const,
            };
          }
          return { issues: [] };
        },
      };
      async function* partials(): AsyncIterable<Partial<NumericRow>> {
        yield { value: "created" };
      }

      const connection = connectPartialStream(rowModel, partials(), {
        rowId: targetId,
        createRow,
        onIssue,
      });
      await vi.advanceTimersToNextTimerAsync();
      await connection.done;

      expect(onIssue).toHaveBeenCalledTimes(matches ? 1 : 0);
      expect(createRow).toHaveBeenCalledTimes(matches ? 1 : 0);
    }
  });

  test("settles once with the source error when catch-path flushing throws", async () => {
    const sourceError = new Error("partial source failed");
    const flushError = new Error("partial flush failed");
    const rowModel: RowModelLike<TestRow, string> = {
      applyTransaction() {
        throw flushError;
      },
    };
    async function* throwing(): AsyncIterable<Partial<TestRow>> {
      yield { name: "buffered" };
      throw sourceError;
    }
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const connection = connectPartialStream(rowModel, throwing(), {
        rowId: "row-1",
      });
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
