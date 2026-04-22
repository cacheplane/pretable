# Stream Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@pretable/stream-adapter`, a private package that batches streaming data into `grid.applyTransaction()` calls via `requestAnimationFrame`, with LLM stream connectors and raw text parsers powered by `@cacheplane/json-stream`.

**Architecture:** RAF-based `TransactionBatcher` accumulates add/update/remove operations and flushes them in a single `applyTransaction` call per animation frame. Two high-level connectors (`connectElementStream`, `connectPartialStream`) consume `AsyncIterable` inputs and pipe through the batcher. Two parser helpers (`parseElementStream`, `parsePartialStream`) convert raw text streams into typed async iterables using `@cacheplane/json-stream`.

**Tech Stack:** TypeScript, `tsc -b` (private package), vitest, `@cacheplane/json-stream`, `@pretable-internal/grid-core` (type-only dependency for `GridCoreTransaction`)

---

## File Structure

```
packages/stream-adapter/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    — Public API barrel export
│   ├── types.ts                    — TransactionBatcher, StreamConnection, GridLike interfaces
│   ├── create-batcher.ts           — createBatcher() implementation
│   ├── connect-element-stream.ts   — connectElementStream() implementation
│   ├── connect-partial-stream.ts   — connectPartialStream() implementation
│   ├── parse-element-stream.ts     — parseElementStream() async generator
│   ├── parse-partial-stream.ts     — parsePartialStream() async generator
│   └── __tests__/
│       ├── create-batcher.test.ts
│       ├── connect-element-stream.test.ts
│       ├── connect-partial-stream.test.ts
│       ├── parse-element-stream.test.ts
│       └── parse-partial-stream.test.ts
```

**Responsibilities:**

- `types.ts` — All public interfaces and the `GridLike` structural type (avoids hard coupling to grid-core's concrete class)
- `create-batcher.ts` — RAF scheduling, buffer accumulation, flush/dispose lifecycle
- `connect-element-stream.ts` — Async iteration → batcher.add, StreamConnection lifecycle
- `connect-partial-stream.ts` — Async iteration → batcher.update, StreamConnection lifecycle
- `parse-element-stream.ts` — Text chunks → json-stream parser → yields complete `TRow` objects from a JSON array
- `parse-partial-stream.ts` — Text chunks → json-stream parser → yields `Partial<TRow>` snapshots from a JSON object

---

### Task 1: Package Scaffolding

**Files:**

- Create: `packages/stream-adapter/package.json`
- Create: `packages/stream-adapter/tsconfig.json`
- Create: `packages/stream-adapter/src/index.ts`
- Create: `packages/stream-adapter/src/types.ts`
- Modify: `tsconfig.json` (root — add project reference)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@pretable-internal/stream-adapter",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@cacheplane/json-stream": "workspace:*"
  },
  "scripts": {
    "build": "tsc -b",
    "lint": "eslint src --ext .ts",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -b --pretty false"
  }
}
```

Note: `@pretable-internal/grid-core` is NOT a runtime dependency. The adapter uses a structural `GridLike` interface so it doesn't import grid-core at runtime. This keeps the package loosely coupled.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "files": ["src/index.ts"],
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.*", "src/**/__tests__/**"],
  "references": [{ "path": "../json-stream" }]
}
```

- [ ] **Step 3: Create `src/types.ts`**

```ts
/**
 * Structural type for any grid that supports applyTransaction.
 * Avoids hard coupling to @pretable-internal/grid-core.
 */
export interface GridLike<TRow extends Record<string, unknown>> {
  applyTransaction(transaction: {
    add?: TRow[];
    update?: Partial<TRow>[];
    remove?: string[];
  }): void;
}

export interface TransactionBatcher<TRow extends Record<string, unknown>> {
  add(rows: TRow[]): void;
  update(patches: Partial<TRow>[]): void;
  remove(ids: string[]): void;
  flush(): void;
  dispose(): void;
}

export interface StreamConnection {
  done: Promise<void>;
  dispose(): void;
}
```

- [ ] **Step 4: Create `src/index.ts` with type-only exports**

```ts
export type { GridLike, TransactionBatcher, StreamConnection } from "./types";
```

This barrel will grow as we implement each module.

- [ ] **Step 5: Add project reference to root `tsconfig.json`**

Add `{ "path": "packages/stream-adapter" }` to the `references` array in the root `tsconfig.json`.

- [ ] **Step 6: Run `pnpm install` and verify build**

```bash
pnpm install
cd packages/stream-adapter && pnpm build
```

Expected: Clean build with `dist/` containing `index.js`, `index.d.ts`, `types.js`, `types.d.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/stream-adapter/package.json packages/stream-adapter/tsconfig.json packages/stream-adapter/src/index.ts packages/stream-adapter/src/types.ts tsconfig.json pnpm-lock.yaml
git commit -m "feat(stream-adapter): scaffold package with types"
```

---

### Task 2: TransactionBatcher

**Files:**

- Create: `packages/stream-adapter/src/create-batcher.ts`
- Create: `packages/stream-adapter/src/__tests__/create-batcher.test.ts`
- Modify: `packages/stream-adapter/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/stream-adapter/src/__tests__/create-batcher.test.ts`:

```ts
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

    // RAF should not fire again (already flushed)
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

    // No new mutations — next RAF should not fire a new transaction
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: FAIL — `createBatcher` not found.

- [ ] **Step 3: Implement `createBatcher`**

Create `packages/stream-adapter/src/create-batcher.ts`:

```ts
import type { GridLike, TransactionBatcher } from "./types";

export function createBatcher<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
): TransactionBatcher<TRow> {
  let addBuffer: TRow[] = [];
  let updateBuffer: Partial<TRow>[] = [];
  let removeBuffer: string[] = [];
  let rafId: number | null = null;
  let disposed = false;

  function scheduleFlush(): void {
    if (rafId !== null || disposed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      applyBuffered();
    });
  }

  function applyBuffered(): void {
    if (
      addBuffer.length === 0 &&
      updateBuffer.length === 0 &&
      removeBuffer.length === 0
    ) {
      return;
    }

    const tx: {
      add?: TRow[];
      update?: Partial<TRow>[];
      remove?: string[];
    } = {};

    if (addBuffer.length > 0) {
      tx.add = addBuffer;
      addBuffer = [];
    }
    if (updateBuffer.length > 0) {
      tx.update = updateBuffer;
      updateBuffer = [];
    }
    if (removeBuffer.length > 0) {
      tx.remove = removeBuffer;
      removeBuffer = [];
    }

    grid.applyTransaction(tx);
  }

  return {
    add(rows) {
      if (disposed) return;
      addBuffer.push(...rows);
      scheduleFlush();
    },
    update(patches) {
      if (disposed) return;
      updateBuffer.push(...patches);
      scheduleFlush();
    },
    remove(ids) {
      if (disposed) return;
      removeBuffer.push(...ids);
      scheduleFlush();
    },
    flush() {
      if (disposed) return;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      applyBuffered();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      addBuffer = [];
      updateBuffer = [];
      removeBuffer = [];
    },
  };
}
```

- [ ] **Step 4: Export from index**

Add to `packages/stream-adapter/src/index.ts`:

```ts
export { createBatcher } from "./create-batcher";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: All 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/stream-adapter/src/create-batcher.ts packages/stream-adapter/src/__tests__/create-batcher.test.ts packages/stream-adapter/src/index.ts
git commit -m "feat(stream-adapter): implement TransactionBatcher with RAF flush"
```

---

### Task 3: connectElementStream

**Files:**

- Create: `packages/stream-adapter/src/connect-element-stream.ts`
- Create: `packages/stream-adapter/src/__tests__/connect-element-stream.test.ts`
- Modify: `packages/stream-adapter/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/stream-adapter/src/__tests__/connect-element-stream.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { connectElementStream } from "../connect-element-stream";
import type { GridLike } from "../types";

interface TestRow {
  id: string;
  name: string;
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

    // Let the async iteration and RAF run
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
    // No error — resolved successfully
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
        // Simulate async delay
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const conn = connectElementStream(grid, slow());

    // Let a few items come through
    await vi.advanceTimersByTimeAsync(50);

    conn.dispose();

    // Flush should have been called
    const totalAdds = grid.calls.flatMap((c) => c.add ?? []).length;
    expect(totalAdds).toBeGreaterThan(0);
    expect(totalAdds).toBeLessThan(100);

    // done should resolve (not reject) after dispose
    await conn.done;
  });

  test("multiple elements within one frame are coalesced", async () => {
    const grid = createMockGrid();

    // All items yield synchronously (no await between them)
    async function* burst(): AsyncIterable<TestRow> {
      yield { id: "1", name: "Alice" };
      yield { id: "2", name: "Bob" };
      yield { id: "3", name: "Carol" };
    }

    const conn = connectElementStream(grid, burst());

    await vi.advanceTimersToNextTimerAsync();
    await conn.done;

    // Should be coalesced into one or few transactions, not 3 separate ones
    // The exact count depends on microtask timing, but total adds should be 3
    const allAdds = grid.calls.flatMap((c) => c.add ?? []);
    expect(allAdds).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: FAIL — `connectElementStream` not found.

- [ ] **Step 3: Implement `connectElementStream`**

Create `packages/stream-adapter/src/connect-element-stream.ts`:

```ts
import type { GridLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

export function connectElementStream<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<TRow>,
): StreamConnection {
  const batcher = createBatcher(grid);
  let disposed = false;

  const done = (async () => {
    try {
      for await (const element of stream) {
        if (disposed) break;
        batcher.add([element]);
      }
      batcher.flush();
    } catch (err) {
      batcher.flush();
      throw err;
    }
  })();

  return {
    done,
    dispose() {
      if (disposed) return;
      disposed = true;
      batcher.flush();
      batcher.dispose();
    },
  };
}
```

- [ ] **Step 4: Export from index**

Add to `packages/stream-adapter/src/index.ts`:

```ts
export { connectElementStream } from "./connect-element-stream";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: All connectElementStream tests PASS. Previous batcher tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/stream-adapter/src/connect-element-stream.ts packages/stream-adapter/src/__tests__/connect-element-stream.test.ts packages/stream-adapter/src/index.ts
git commit -m "feat(stream-adapter): implement connectElementStream"
```

---

### Task 4: connectPartialStream

**Files:**

- Create: `packages/stream-adapter/src/connect-partial-stream.ts`
- Create: `packages/stream-adapter/src/__tests__/connect-partial-stream.test.ts`
- Modify: `packages/stream-adapter/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/stream-adapter/src/__tests__/connect-partial-stream.test.ts`:

```ts
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
    // Each update should have the rowId injected as `id`
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

    // All updates should arrive, coalesced into transactions
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: FAIL — `connectPartialStream` not found.

- [ ] **Step 3: Implement `connectPartialStream`**

Create `packages/stream-adapter/src/connect-partial-stream.ts`:

```ts
import type { GridLike, StreamConnection } from "./types";
import { createBatcher } from "./create-batcher";

export function connectPartialStream<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<Partial<TRow>>,
  options: { rowId: string },
): StreamConnection {
  const batcher = createBatcher(grid);
  let disposed = false;

  const done = (async () => {
    try {
      for await (const partial of stream) {
        if (disposed) break;
        batcher.update([{ ...partial, id: options.rowId } as Partial<TRow>]);
      }
      batcher.flush();
    } catch (err) {
      batcher.flush();
      throw err;
    }
  })();

  return {
    done,
    dispose() {
      if (disposed) return;
      disposed = true;
      batcher.flush();
      batcher.dispose();
    },
  };
}
```

- [ ] **Step 4: Export from index**

Add to `packages/stream-adapter/src/index.ts`:

```ts
export { connectPartialStream } from "./connect-partial-stream";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: All connectPartialStream tests PASS. All previous tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/stream-adapter/src/connect-partial-stream.ts packages/stream-adapter/src/__tests__/connect-partial-stream.test.ts packages/stream-adapter/src/index.ts
git commit -m "feat(stream-adapter): implement connectPartialStream"
```

---

### Task 5: parseElementStream

**Files:**

- Create: `packages/stream-adapter/src/parse-element-stream.ts`
- Create: `packages/stream-adapter/src/__tests__/parse-element-stream.test.ts`
- Modify: `packages/stream-adapter/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/stream-adapter/src/__tests__/parse-element-stream.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseElementStream } from "../parse-element-stream";

interface TestRow {
  id: string;
  name: string;
}

async function* asyncChunks(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

describe("parseElementStream", () => {
  test("yields complete elements from a JSON array", async () => {
    const chunks = ['[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]'];
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  test("handles chunk boundaries within elements", async () => {
    const chunks = [
      '[{"id":"1","na',
      'me":"Alice"},{"id',
      '":"2","name":"Bob"}]',
    ];
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  test("yields nothing until first element is complete", async () => {
    const yielded: TestRow[] = [];

    async function* slowChunks(): AsyncIterable<string> {
      yield '[{"id":"1"';
      // At this point no complete element yet
      // We'll check yielded is still empty after consuming
      yield ',"name":"Alice"}';
      // Now the first element is complete
      yield "]";
    }

    for await (const row of parseElementStream<TestRow>(slowChunks())) {
      yielded.push(row);
    }

    expect(yielded).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("yields elements one at a time as they complete", async () => {
    const chunks = [
      '[{"id":"1","name":"Alice"}',
      ',{"id":"2","name":"Bob"}',
      ",",
      '{"id":"3","name":"Carol"}]',
    ];

    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );
    expect(results).toHaveLength(3);
  });

  test("handles empty array", async () => {
    const chunks = ["[]"];
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );
    expect(results).toEqual([]);
  });

  test("handles nested objects in elements", async () => {
    interface NestedRow {
      id: string;
      meta: { score: number };
    }
    const chunks = ['[{"id":"1","meta":{"score":100}}]'];
    const results = await collect(
      parseElementStream<NestedRow>(asyncChunks(chunks)),
    );
    expect(results).toEqual([{ id: "1", meta: { score: 100 } }]);
  });

  test("character-at-a-time streaming", async () => {
    const json = '[{"id":"1","name":"Alice"}]';
    const chunks = json.split("");
    const results = await collect(
      parseElementStream<TestRow>(asyncChunks(chunks)),
    );
    expect(results).toEqual([{ id: "1", name: "Alice" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: FAIL — `parseElementStream` not found.

- [ ] **Step 3: Implement `parseElementStream`**

Create `packages/stream-adapter/src/parse-element-stream.ts`:

```ts
import {
  create,
  push,
  finish,
  isArrayNode,
  isComplete,
} from "@cacheplane/json-stream";
import type { StreamState, ArrayNode } from "@cacheplane/json-stream";

/**
 * Feeds text chunks into the json-stream parser and yields complete
 * array elements as they finish parsing.
 *
 * Expects the root JSON value to be an array. Each child that reaches
 * status "complete" is yielded as a TRow.
 */
export async function* parseElementStream<TRow>(
  stream: AsyncIterable<string>,
): AsyncIterable<TRow> {
  let state: StreamState = create();
  let yieldedCount = 0;

  for await (const chunk of stream) {
    state = push(state, chunk);

    if (state.error) {
      throw new Error(state.error.message);
    }

    // Check for complete children in the root array
    if (state.rootId !== null) {
      const root = state.nodes[state.rootId];
      if (!isArrayNode(root)) {
        throw new Error(
          `parseElementStream expects root to be an array, got "${root.kind}"`,
        );
      }

      // Yield any newly completed children
      while (yieldedCount < root.children.length) {
        const childNode = state.nodes[root.children[yieldedCount]];
        if (!isComplete(childNode)) break;
        if (childNode.value !== undefined) {
          yield childNode.value as TRow;
        }
        yieldedCount++;
      }
    }
  }

  // Finish parsing and yield any remaining complete elements
  state = finish(state);

  if (state.error) {
    throw new Error(state.error.message);
  }

  if (state.rootId !== null) {
    const root = state.nodes[state.rootId];
    if (isArrayNode(root)) {
      while (yieldedCount < root.children.length) {
        const childNode = state.nodes[root.children[yieldedCount]];
        if (isComplete(childNode) && childNode.value !== undefined) {
          yield childNode.value as TRow;
        }
        yieldedCount++;
      }
    }
  }
}
```

- [ ] **Step 4: Export from index**

Add to `packages/stream-adapter/src/index.ts`:

```ts
export { parseElementStream } from "./parse-element-stream";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: All parseElementStream tests PASS. All previous tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/stream-adapter/src/parse-element-stream.ts packages/stream-adapter/src/__tests__/parse-element-stream.test.ts packages/stream-adapter/src/index.ts
git commit -m "feat(stream-adapter): implement parseElementStream"
```

---

### Task 6: parsePartialStream

**Files:**

- Create: `packages/stream-adapter/src/parse-partial-stream.ts`
- Create: `packages/stream-adapter/src/__tests__/parse-partial-stream.test.ts`
- Modify: `packages/stream-adapter/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/stream-adapter/src/__tests__/parse-partial-stream.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parsePartialStream } from "../parse-partial-stream";

interface TestRow {
  id: string;
  name: string;
  score: number;
}

async function* asyncChunks(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

describe("parsePartialStream", () => {
  test("yields partial object snapshots as properties complete", async () => {
    const chunks = ['{"id":"1"', ',"name":"Ali', 'ce","score":', "100}"];

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    // Should have multiple snapshots as the object builds up
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Last snapshot should be the complete object
    const last = results[results.length - 1];
    expect(last).toEqual({ id: "1", name: "Alice", score: 100 });
  });

  test("only yields when resolved value reference changes (identity-preserving)", async () => {
    // Push chunks that don't change the resolved value
    const chunks = ['{"id":"1",', " ", " ", '"name":"Alice"}'];

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    // Whitespace-only chunks should not produce new yields
    // Each yield should be a distinct object reference
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).not.toBe(results[i - 1]);
    }
  });

  test("handles chunk boundaries within the object", async () => {
    const json = '{"id":"1","name":"Alice","score":100}';
    // Split character by character
    const chunks = json.split("");

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    const last = results[results.length - 1];
    expect(last).toEqual({ id: "1", name: "Alice", score: 100 });
  });

  test("throws if root is an array", async () => {
    const chunks = ["[1, 2, 3]"];

    await expect(
      collect(parsePartialStream<TestRow>(asyncChunks(chunks))),
    ).rejects.toThrow("object");
  });

  test("throws if root is a primitive", async () => {
    const chunks = ['"hello"'];

    await expect(
      collect(parsePartialStream<TestRow>(asyncChunks(chunks))),
    ).rejects.toThrow("object");
  });

  test("single chunk complete object yields at least one snapshot", async () => {
    const chunks = ['{"id":"1","name":"Alice","score":100}'];

    const results = await collect(
      parsePartialStream<TestRow>(asyncChunks(chunks)),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[results.length - 1]).toEqual({
      id: "1",
      name: "Alice",
      score: 100,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: FAIL — `parsePartialStream` not found.

- [ ] **Step 3: Implement `parsePartialStream`**

Create `packages/stream-adapter/src/parse-partial-stream.ts`:

```ts
import { create, push, finish, isObjectNode } from "@cacheplane/json-stream";
import type { StreamState } from "@cacheplane/json-stream";

/**
 * Feeds text chunks into the json-stream parser and yields partial
 * object snapshots whenever the resolved value reference changes.
 *
 * Expects the root JSON value to be an object. Yields Partial<TRow>
 * snapshots using the parser's identity preservation — only yields
 * when the resolved value is a new object reference.
 */
export async function* parsePartialStream<TRow>(
  stream: AsyncIterable<string>,
): AsyncIterable<Partial<TRow>> {
  let state: StreamState = create();
  let lastValue: Record<string, unknown> | undefined;

  for await (const chunk of stream) {
    state = push(state, chunk);

    if (state.error) {
      throw new Error(state.error.message);
    }

    if (state.rootId !== null) {
      const root = state.nodes[state.rootId];
      if (!isObjectNode(root)) {
        throw new Error(
          `parsePartialStream expects root to be an object, got "${root.kind}"`,
        );
      }

      if (root.value !== undefined && root.value !== lastValue) {
        lastValue = root.value;
        yield root.value as Partial<TRow>;
      }
    }
  }

  // Finish and yield final snapshot if changed
  state = finish(state);

  if (state.error) {
    throw new Error(state.error.message);
  }

  if (state.rootId !== null) {
    const root = state.nodes[state.rootId];
    if (
      isObjectNode(root) &&
      root.value !== undefined &&
      root.value !== lastValue
    ) {
      yield root.value as Partial<TRow>;
    }
  }
}
```

- [ ] **Step 4: Export from index**

Add to `packages/stream-adapter/src/index.ts`:

```ts
export { parsePartialStream } from "./parse-partial-stream";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/stream-adapter && pnpm test
```

Expected: All parsePartialStream tests PASS. All previous tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/stream-adapter/src/parse-partial-stream.ts packages/stream-adapter/src/__tests__/parse-partial-stream.test.ts packages/stream-adapter/src/index.ts
git commit -m "feat(stream-adapter): implement parsePartialStream"
```

---

### Task 7: Benchmark Refactoring

**Files:**

- Modify: `apps/bench/src/bench-runtime.ts` (lines 571-675)
- Modify: `apps/bench/package.json` (add stream-adapter dependency)

- [ ] **Step 1: Add `@pretable-internal/stream-adapter` dependency to bench app**

Add to `apps/bench/package.json` dependencies:

```json
"@pretable-internal/stream-adapter": "workspace:*"
```

Run `pnpm install`.

- [ ] **Step 2: Refactor `measureBenchUpdatesRun` to use batcher**

Replace the `setInterval` loop in `apps/bench/src/bench-runtime.ts` (`measureBenchUpdatesRun` function, approximately lines 619-647) with the stream adapter's batcher pattern. The refactored function uses an async generator that yields update batches on a 50ms cadence, piped through `connectElementStream`.

Replace the `await new Promise<void>((resolve) => { ... });` block (lines 620-647) with:

```ts
const { createBatcher } = await import("@pretable-internal/stream-adapter");
const batcher = createBatcher(grid);

await new Promise<void>((resolve) => {
  let elapsed = 0;

  const interval = setInterval(() => {
    elapsed += BATCH_INTERVAL_MS;

    const patches: Record<string, unknown>[] = [];

    for (let i = 0; i < UPDATES_PER_TICK; i += 1) {
      const rowIndex = Math.floor(Math.random() * dataset.rows.length);
      const row = dataset.rows[rowIndex];
      const colIndex = Math.floor(Math.random() * columnIds.length);
      const columnId = columnIds[colIndex];
      const id = String((row as Record<string, unknown>).id ?? rowIndex);

      patches.push({ id, [columnId]: `upd-${totalUpdates + i}` });
    }

    batcher.update(patches);
    totalUpdates += UPDATES_PER_TICK;

    if (elapsed >= DURATION_MS) {
      clearInterval(interval);
      batcher.flush();
      resolve();
    }
  }, BATCH_INTERVAL_MS);
});

batcher.dispose();
```

The key changes:

1. Replace direct `grid.applyTransaction({ update: patches })` with `batcher.update(patches)`
2. Call `batcher.flush()` before resolving to ensure all buffered updates are applied
3. Call `batcher.dispose()` after the promise resolves to clean up

This proves the adapter works under benchmark conditions while keeping the same timing semantics (50ms interval, 3s duration, same metrics collection).

- [ ] **Step 3: Verify build succeeds**

```bash
cd /path/to/worktree && pnpm build
```

Expected: Clean build including stream-adapter and bench app.

- [ ] **Step 4: Commit**

```bash
git add apps/bench/package.json apps/bench/src/bench-runtime.ts pnpm-lock.yaml
git commit -m "refactor(bench): use stream-adapter batcher in updates benchmark"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass across all packages.

- [ ] **Step 2: Run full typecheck**

```bash
pnpm typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: No lint errors.

- [ ] **Step 4: Verify final `src/index.ts` exports**

The final `packages/stream-adapter/src/index.ts` should export:

```ts
export type { GridLike, TransactionBatcher, StreamConnection } from "./types";

export { createBatcher } from "./create-batcher";
export { connectElementStream } from "./connect-element-stream";
export { connectPartialStream } from "./connect-partial-stream";
export { parseElementStream } from "./parse-element-stream";
export { parsePartialStream } from "./parse-partial-stream";
```
