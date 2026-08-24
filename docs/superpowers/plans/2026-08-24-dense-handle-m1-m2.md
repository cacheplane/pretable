# Dense-Handle M1+M2 Implementation Plan (slots + membership bitsets)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every row a dense integer slot for its lifetime, carry a per-revision `recordsBySlot` chunked-COW vector and a `visibleSlots` membership bitset, and rewrite the filter-only rebuild to consume them — eliminating the 18.5ms records-HAMT walk and the 11.9ms old-verdict double lookup at 50k.

**Architecture:** Three new row-model-internal primitives (spec: `docs/superpowers/specs/2026-08-24-dense-handle-core-design.md`; pricing: `...m0-results.md`, GO) sit UNDER the existing persistent structures. `RevisionRoot` gains two REQUIRED fields so the TypeScript compiler enumerates every construction site; a decision table in Task 5 says what each site does. String ids remain the public currency; public API diff must be zero.

**Tech Stack:** TypeScript, vitest (`pnpm --filter @pretable/row-model test`), existing bench harness (`scripts/bench-matrix.mjs`).

**Worktree:** `/Users/blove/repos/pretable/.claude/worktrees/homepage-hero-demo-3878ef`, branch `blove/filter-fast-path`. All paths below are relative to it.

**Plan-level deviation from the spec (deliberate, record it in the results doc):** the spec names a per-revision "live set" bitset; it is NOT built. Hole-skipping iteration over `recordsBySlot` (undefined = free slot) serves as the live domain, which removes a whole structure and its maintenance. The visible set IS built (M2).

**Design invariants (repeat in code comments where noted):**
1. A slot binds to one row for that row's lifetime; release only on permanent removal; reuse allowed afterwards.
2. Old snapshots stay valid under slot reuse because every revision holds its own immutable chunk table — revision N's `recordsBySlot` still binds slot s to whatever row owned s at revision N.
3. `visibleSlots` is REAL only for flat (ungrouped) roots; grouped roots carry the `EMPTY_MEMBERSHIP` sentinel and keep answering membership from the group index (`filter-membership.ts` is unchanged).
4. Membership IS the verdict (H-cycle invariant) — the bitset is a faster index of the same structural answer, never a stored verdict.

---

### Task 1: `membership-bitset.ts`

**Files:**
- Create: `packages/row-model/src/membership-bitset.ts`
- Test: `packages/row-model/src/__tests__/membership-bitset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMBERSHIP,
  cloneMembership,
  createMembership,
  clearMembershipBit,
  setMembershipBit,
  testMembershipBit,
} from "../membership-bitset";

describe("membership bitset", () => {
  it("round-trips set/clear/test across word boundaries", () => {
    const bits = createMembership(100);
    for (const slot of [0, 31, 32, 63, 64, 99]) {
      expect(testMembershipBit(bits, slot)).toBe(false);
      setMembershipBit(bits, slot);
      expect(testMembershipBit(bits, slot)).toBe(true);
    }
    clearMembershipBit(bits, 32);
    expect(testMembershipBit(bits, 32)).toBe(false);
    expect(testMembershipBit(bits, 31)).toBe(true);
    expect(testMembershipBit(bits, 63)).toBe(true);
  });

  it("clone is independent of the original", () => {
    const bits = createMembership(64);
    setMembershipBit(bits, 10);
    const copy = cloneMembership(bits, 64);
    clearMembershipBit(copy, 10);
    setMembershipBit(copy, 20);
    expect(testMembershipBit(bits, 10)).toBe(true);
    expect(testMembershipBit(bits, 20)).toBe(false);
  });

  it("clone can grow capacity, preserving low bits", () => {
    const bits = createMembership(32);
    setMembershipBit(bits, 31);
    const grown = cloneMembership(bits, 200);
    expect(testMembershipBit(grown, 31)).toBe(true);
    setMembershipBit(grown, 199);
    expect(testMembershipBit(grown, 199)).toBe(true);
  });

  it("reads beyond a bitset's words answer false (EMPTY sentinel contract)", () => {
    expect(testMembershipBit(EMPTY_MEMBERSHIP, 0)).toBe(false);
    expect(testMembershipBit(EMPTY_MEMBERSHIP, 12345)).toBe(false);
    const bits = createMembership(32);
    expect(testMembershipBit(bits, 500)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/row-model test -- membership-bitset`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Membership bitsets: one bit per SLOT (see `slot-allocator`). A committed
 * root's verdict is its membership (the filter-membership invariant); the
 * bitset is a faster INDEX of that same structural answer for flat roots,
 * never a stored verdict. Grouped roots carry `EMPTY_MEMBERSHIP` and keep
 * answering from the group index.
 *
 * Mutable while a producer is building the next revision's set; frozen by
 * convention once a root captures it (no Object.freeze — typed arrays do not
 * support it; discipline is "producers build fresh or clone, never write a
 * captured root's bitset", the same convention every persistent structure
 * here relies on).
 *
 * Whole-copy on change is the point: 50k rows is 6.25KB, negligible per
 * commit (M0 measured ~1µs), so no COW machinery exists at this layer.
 */

export type MembershipBitset = Uint32Array;

/** Shared sentinel for roots whose membership lives elsewhere (grouped). */
export const EMPTY_MEMBERSHIP: MembershipBitset = new Uint32Array(0);

export function createMembership(capacity: number): MembershipBitset {
  return new Uint32Array((capacity + 31) >>> 5);
}

/** Clone, growing to `capacity` when it exceeds the source's words. */
export function cloneMembership(
  bits: MembershipBitset,
  capacity: number,
): MembershipBitset {
  const words = Math.max(bits.length, (capacity + 31) >>> 5);
  const next = new Uint32Array(words);
  next.set(bits);
  return next;
}

export function setMembershipBit(bits: MembershipBitset, slot: number): void {
  bits[slot >>> 5]! |= 1 << (slot & 31);
}

export function clearMembershipBit(
  bits: MembershipBitset,
  slot: number,
): void {
  bits[slot >>> 5]! &= ~(1 << (slot & 31));
}

/** Out-of-range slots read as false — the EMPTY sentinel relies on this. */
export function testMembershipBit(
  bits: MembershipBitset,
  slot: number,
): boolean {
  const word = bits[slot >>> 5];
  return word === undefined ? false : ((word >>> (slot & 31)) & 1) === 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pretable/row-model test -- membership-bitset`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/row-model/src/membership-bitset.ts packages/row-model/src/__tests__/membership-bitset.test.ts
git commit -m "feat(row-model): membership bitset primitive"
```

---

### Task 2: `slot-allocator.ts`

**Files:**
- Create: `packages/row-model/src/slot-allocator.ts`
- Test: `packages/row-model/src/__tests__/slot-allocator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createSlotAllocator } from "../slot-allocator";

describe("slot allocator", () => {
  it("allocates dense sequential slots from zero", () => {
    const slots = createSlotAllocator();
    expect([slots.allocate(), slots.allocate(), slots.allocate()]).toEqual([
      0, 1, 2,
    ]);
    expect(slots.capacity).toBe(3);
  });

  it("reuses released slots before growing", () => {
    const slots = createSlotAllocator();
    slots.allocate();
    const b = slots.allocate();
    slots.allocate();
    slots.release(b);
    expect(slots.allocate()).toBe(b);
    expect(slots.capacity).toBe(3);
  });

  it("capacity is monotonic and counts the high-water mark", () => {
    const slots = createSlotAllocator();
    for (let i = 0; i < 10; i += 1) slots.allocate();
    for (let i = 0; i < 10; i += 1) slots.release(i);
    expect(slots.capacity).toBe(10);
    for (let i = 0; i < 10; i += 1) slots.allocate();
    expect(slots.capacity).toBe(10);
  });

  it("throws on double release", () => {
    const slots = createSlotAllocator();
    const a = slots.allocate();
    slots.release(a);
    expect(() => slots.release(a)).toThrow(/released|live/i);
  });

  it("throws on releasing a never-allocated slot", () => {
    const slots = createSlotAllocator();
    expect(() => slots.release(5)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/row-model test -- slot-allocator`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Per-MODEL slot allocator: every row gets a small dense integer for its
 * lifetime, assigned at ingest and released only on permanent removal.
 * Mutable by design — this is instance state, not revision state; the
 * revision-scoped structures (`slot-vector`, `membership-bitset`) are what
 * keep old snapshots valid when a released slot is reused.
 *
 * Capacity is the high-water mark and never shrinks, so slot-indexed
 * structures never renumber. Release is fail-loud (double release would hand
 * one slot to two live rows, which corrupts every slot-indexed structure
 * from that commit on).
 */

export interface SlotAllocator {
  readonly capacity: number;
  allocate(): number;
  release(slot: number): void;
}

export function createSlotAllocator(): SlotAllocator {
  const free: number[] = [];
  let next = 0;
  let live = new Uint8Array(1024);
  const ensure = (slot: number) => {
    if (slot < live.length) return;
    const grown = new Uint8Array(Math.max(live.length * 2, slot + 1));
    grown.set(live);
    live = grown;
  };
  return {
    get capacity() {
      return next;
    },
    allocate() {
      const slot = free.length > 0 ? free.pop()! : next++;
      ensure(slot);
      live[slot] = 1;
      return slot;
    },
    release(slot) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= next) {
        throw new RangeError(`Slot ${slot} was never allocated.`);
      }
      if (live[slot] !== 1) {
        throw new RangeError(`Slot ${slot} is not live (double release).`);
      }
      live[slot] = 0;
      free.push(slot);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pretable/row-model test -- slot-allocator`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/row-model/src/slot-allocator.ts packages/row-model/src/__tests__/slot-allocator.test.ts
git commit -m "feat(row-model): per-model slot allocator"
```

---

### Task 3: `slot-vector.ts`

**Files:**
- Create: `packages/row-model/src/slot-vector.ts`
- Test: `packages/row-model/src/__tests__/slot-vector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  SLOT_VECTOR_CHUNK,
  emptySlotVector,
  forEachSlotEntry,
  slotVectorFromEntries,
  slotVectorGet,
  slotVectorWithAll,
} from "../slot-vector";

describe("slot vector", () => {
  it("stores entries at their slots, holes read undefined", () => {
    const vec = slotVectorFromEntries([[0, "a"], [2, "c"], [1500, "far"]], 2000);
    expect(slotVectorGet(vec, 0)).toBe("a");
    expect(slotVectorGet(vec, 1)).toBeUndefined();
    expect(slotVectorGet(vec, 2)).toBe("c");
    expect(slotVectorGet(vec, 1500)).toBe("far");
    expect(slotVectorGet(vec, 1999)).toBeUndefined();
  });

  it("withAll writes and clears land; result reports chunks copied", () => {
    const base = slotVectorFromEntries([[0, "a"], [1, "b"]], 10);
    const { next, chunksTouched } = slotVectorWithAll(
      base,
      [[0, "A"], [1, undefined], [5, "f"]],
      10,
    );
    expect(slotVectorGet(next, 0)).toBe("A");
    expect(slotVectorGet(next, 1)).toBeUndefined();
    expect(slotVectorGet(next, 5)).toBe("f");
    expect(chunksTouched).toBe(1); // all three slots share chunk 0
  });

  it("old snapshots survive later writes, including slot overwrite (COW pin)", () => {
    const v0 = slotVectorFromEntries([[5, "old-5"], [1030, "old-1030"]], 2048);
    const { next: v1 } = slotVectorWithAll(
      v0,
      [[5, "new-5"], [1030, undefined]],
      2048,
    );
    // v1 sees the writes...
    expect(slotVectorGet(v1, 5)).toBe("new-5");
    expect(slotVectorGet(v1, 1030)).toBeUndefined();
    // ...and v0 is byte-identical to before: the snapshot-validity invariant
    // that makes slot REUSE safe for held revisions.
    expect(slotVectorGet(v0, 5)).toBe("old-5");
    expect(slotVectorGet(v0, 1030)).toBe("old-1030");
  });

  it("a commit touching k slots in one chunk copies exactly one chunk", () => {
    const entries: [number, string][] = [];
    for (let s = 0; s < 4096; s += 1) entries.push([s, `v${s}`]);
    const base = slotVectorFromEntries(entries, 4096);
    const writes: [number, string][] = [];
    for (let s = 100; s < 150; s += 1) writes.push([s, `w${s}`]);
    const { next, chunksTouched } = slotVectorWithAll(base, writes, 4096);
    expect(chunksTouched).toBe(1);
    // untouched chunks are carried by reference, not copied
    expect(next.chunks[1]).toBe(base.chunks[1]);
    expect(next.chunks[0]).not.toBe(base.chunks[0]);
  });

  it("withAll can grow capacity for slots beyond the old table", () => {
    const base = slotVectorFromEntries([[0, "a"]], 1);
    const { next } = slotVectorWithAll(base, [[5000, "far"]], 5001);
    expect(slotVectorGet(next, 5000)).toBe("far");
    expect(slotVectorGet(next, 0)).toBe("a");
    expect(slotVectorGet(base, 5000)).toBeUndefined();
  });

  it("forEachSlotEntry skips holes and visits every live entry once", () => {
    const vec = slotVectorFromEntries([[3, "c"], [SLOT_VECTOR_CHUNK + 1, "x"]], 3000);
    const seen: Array<[number, string]> = [];
    forEachSlotEntry(vec, (value, slot) => seen.push([slot, value]));
    expect(seen).toEqual([[3, "c"], [SLOT_VECTOR_CHUNK + 1, "x"]]);
  });

  it("emptySlotVector reads undefined everywhere", () => {
    expect(slotVectorGet(emptySlotVector<string>(), 0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/row-model test -- slot-vector`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Immutable chunked slot-indexed vector: a chunk table over
 * `SLOT_VECTOR_CHUNK`-element chunks, copy-on-write per commit. A commit
 * touching k slots copies the table plus each touched chunk once — this is
 * what keeps old snapshots valid under slot reuse: every revision holds its
 * own table, so revision N still binds slot s to whatever row owned s at
 * revision N no matter what later commits do (M0 priced maintenance at
 * ~33–98µs per 100-write commit).
 *
 * Holes (`undefined`) are free slots. Iteration hole-skips, which is why no
 * separate "live" bitset exists (recorded plan deviation from the spec).
 */

export const SLOT_VECTOR_CHUNK = 1024;

export interface SlotVector<T> {
  /** Sparse table: a missing/undefined chunk reads as all holes. */
  readonly chunks: ReadonlyArray<ReadonlyArray<T | undefined> | undefined>;
}

const EMPTY: SlotVector<never> = Object.freeze({ chunks: Object.freeze([]) });

export function emptySlotVector<T>(): SlotVector<T> {
  return EMPTY;
}

export function slotVectorFromEntries<T>(
  entries: Iterable<readonly [number, T]>,
  capacity: number,
): SlotVector<T> {
  const chunks: Array<Array<T | undefined> | undefined> = new Array(
    Math.ceil(capacity / SLOT_VECTOR_CHUNK),
  );
  for (const [slot, value] of entries) {
    const index = (slot / SLOT_VECTOR_CHUNK) | 0;
    let chunk = chunks[index];
    if (chunk === undefined) {
      chunk = new Array<T | undefined>(SLOT_VECTOR_CHUNK);
      chunks[index] = chunk;
    }
    chunk[slot % SLOT_VECTOR_CHUNK] = value;
  }
  return { chunks };
}

export function slotVectorGet<T>(
  vector: SlotVector<T>,
  slot: number,
): T | undefined {
  const chunk = vector.chunks[(slot / SLOT_VECTOR_CHUNK) | 0];
  return chunk === undefined ? undefined : chunk[slot % SLOT_VECTOR_CHUNK];
}

/**
 * One commit's writes (`undefined` value = clear the slot), COW: table copied
 * once, each touched chunk copied once. `capacity` may exceed the old
 * table's reach (allocator growth).
 */
export function slotVectorWithAll<T>(
  vector: SlotVector<T>,
  writes: ReadonlyArray<readonly [number, T | undefined]>,
  capacity: number,
): { readonly next: SlotVector<T>; readonly chunksTouched: number } {
  const tableSize = Math.max(
    vector.chunks.length,
    Math.ceil(capacity / SLOT_VECTOR_CHUNK),
  );
  const chunks: Array<Array<T | undefined> | ReadonlyArray<T | undefined> | undefined> =
    new Array(tableSize);
  for (let i = 0; i < vector.chunks.length; i += 1) chunks[i] = vector.chunks[i];
  const copied = new Set<number>();
  for (const [slot, value] of writes) {
    const index = (slot / SLOT_VECTOR_CHUNK) | 0;
    if (!copied.has(index)) {
      const existing = chunks[index];
      chunks[index] =
        existing === undefined
          ? new Array<T | undefined>(SLOT_VECTOR_CHUNK)
          : existing.slice();
      copied.add(index);
    }
    (chunks[index] as Array<T | undefined>)[slot % SLOT_VECTOR_CHUNK] = value;
  }
  return { next: { chunks }, chunksTouched: copied.size };
}

/** Hole-skipping walk in slot order. */
export function forEachSlotEntry<T>(
  vector: SlotVector<T>,
  callback: (value: T, slot: number) => void,
): void {
  for (let index = 0; index < vector.chunks.length; index += 1) {
    const chunk = vector.chunks[index];
    if (chunk === undefined) continue;
    const base = index * SLOT_VECTOR_CHUNK;
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const value = chunk[offset];
      if (value !== undefined) callback(value, base + offset);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pretable/row-model test -- slot-vector`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/row-model/src/slot-vector.ts packages/row-model/src/__tests__/slot-vector.test.ts
git commit -m "feat(row-model): chunked copy-on-write slot vector"
```

---

### Task 4: Stamp `slot` on `RowRecord`; thread the allocator through record creation

**Files:**
- Modify: `packages/row-model/src/internal-types.ts` (RowRecord, ~line 22)
- Modify: `packages/row-model/src/row-store.ts` (`buildRowStore`, `BuildRowStoreInput`; `rebuildRowStoreForQuery` needs NO change — its `{ ...previous, metadata }` spread carries `slot`)
- Modify: `packages/row-model/src/transaction-draft.ts` (`prepareRecord` ~line 290; `applyFlatTransactionDraft` ~line 753; `replaceFlatRowsDraft` ~line 1247)
- Modify: `packages/row-model/src/create-local-row-model.ts` (create the allocator, pass it down)
- Test: `packages/row-model/src/__tests__/slot-lifecycle.test.ts` (new)

**The lifecycle rules (put this decision logic exactly where each case lives):**

| Event | Slot action |
|---|---|
| New row ingested (initial build, set-rows add, transaction add) | `slots.allocate()`, stamped on the frozen record |
| Row updated (transaction update, set-rows carry, metadata re-evaluation) | carry `previous.slot` |
| Row permanently removed (transaction remove, set-rows drop) | `slots.release(previous.slot)` — AFTER the draft is known effective (see abandon rule) |
| Draft abandoned (`effective: false` return, or the `catch`→`remap` path) | release every slot the draft allocated; release NO removed slot |

**Abandon rule rationale (comment it):** a draft allocates slots while preparing records, but `applyFlatTransactionDraft` can still return ineffective or throw after that; leaked allocations would pin free-list slots forever. Track `allocatedSlots: number[]` in the draft; on the two failure paths release them; on the success path release `removedSlots` instead.

- [ ] **Step 1: Write the failing test**

The row-model package's test suite constructs models via `createLocalRowModel` (see any existing test in `packages/row-model/src/__tests__/` for the fixture idiom — reuse the simplest existing fixture columns/rows pattern; do not invent a new fixture style). The assertions below reach the committed root via the model's internals: check how existing tests access roots — if none do, export a test-only accessor from the module under `/** @internal test-only */` or assert through `getState().snapshot` plus instrumentation counters, whichever existing tests already use. The behaviors to pin:

```ts
// slot-lifecycle.test.ts — behavior pins (adapt fixture idiom from existing tests):
// 1. "slots are dense from zero at initial build": model with rows A,B,C →
//    records carry slots {0,1,2} (order = source order).
// 2. "update carries the slot": transaction updating B → B's new record has
//    B's old slot; A and C untouched (same record identity).
// 3. "remove releases; a later add reuses": transaction removing B, then a
//    separate transaction adding D → D's record carries B's former slot, and
//    allocator capacity stays 3.
// 4. "set-rows replacement carries intersecting ids": setRows([B', E]) after
//    {A,B,C} → B' keeps B's slot; E gets a released slot (0 or 2), capacity
//    stays 3.
// 5. "abandoned draft leaks nothing": a transaction that is entirely
//    ineffective (e.g. removing a nonexistent id) followed by an add — the
//    add's slot shows no gap (capacity grew by exactly the rows actually
//    added since build).
```

Write them as real vitest tests with the fixture idiom you found. Every pin must be able to fail: e.g. for pin 3, verify it fails if you temporarily make release a no-op (mutation check — actually run it once, then restore).

- [ ] **Step 2: Run to verify the suite fails to compile / assert**

Run: `pnpm --filter @pretable/row-model test -- slot-lifecycle`
Expected: FAIL — `slot` does not exist on RowRecord yet.

- [ ] **Step 3: Implement**

3a. `internal-types.ts` — add to `RowRecord`:

```ts
  /**
   * Dense integer handle, assigned at ingest, stable for the row's lifetime
   * (updates carry it; only permanent removal releases it). Slot-indexed
   * structures (`recordsBySlot`, `visibleSlots`) are the array-resident fast
   * path that replaces string-keyed lookups on O(n) walks.
   */
  readonly slot: number;
```

3b. `row-store.ts` — `BuildRowStoreInput` gains `readonly slots: SlotAllocator;`. In `buildRowStore`'s record loop: `const slot = previous !== undefined ? previous.slot : input.slots.allocate();` and add `slot` to the frozen record literal. After the loop, when `input.previous !== undefined`, release dropped ids:

```ts
  if (input.previous !== undefined) {
    for (const [rowId, record] of input.previous.entries()) {
      if (!seen.has(rowId)) input.slots.release(record.slot);
    }
  }
```

(`seen` is the existing duplicate-id Set — it already holds exactly the new id set.)

3c. `transaction-draft.ts` — `prepareRecord` gains a `slot: number` parameter and stamps it in the frozen record. Call sites: adds allocate (`input.slots.allocate()`, recorded in `allocatedSlots`), updates pass `input.root.rows.get(rowId)!.slot` (the previous record is already fetched adjacent to every prepare call — reuse it, do not add a second `get`). `applyFlatTransactionDraft` and `replaceFlatRowsDraft` inputs gain `readonly slots: SlotAllocator`. Apply the lifecycle table: success path releases removed slots just before the `effective: true` return; the `effective: false` return (~line 982) and the `catch (error) { return remap(error); }` tail release `allocatedSlots`.

3d. `create-local-row-model.ts` — `const slots = createSlotAllocator();` beside the other instance state; pass to `buildRowStore` (initial + any other call) and into every draft-input literal (the compiler finds them once the input types require it).

3e. `rebuildRowStoreForQuery` in `row-store.ts`: verify the `{ ...previous, metadata }` spread now carries `slot` (it does — no code change; leave a one-line comment noting slot carries by spread).

- [ ] **Step 4: Run the full package suite**

Run: `pnpm --filter @pretable/row-model test`
Expected: PASS — including all 515 pre-existing tests (slot threading must not disturb any behavior) and the new lifecycle pins. Also run `pnpm --filter @pretable/row-model typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A packages/row-model/src
git commit -m "feat(row-model): stamp lifetime slots on row records"
```

---

### Task 5: `RevisionRoot.recordsBySlot` — required field, all sites

**Files:**
- Modify: `packages/row-model/src/internal-types.ts` (RevisionRoot)
- Modify: `packages/row-model/src/row-store.ts`, `transaction-draft.ts`, `create-local-row-model.ts`, `filter-rebuild.ts`, `sort-rebuild.ts`, `cooperative-transition.ts`
- Test: `packages/row-model/src/__tests__/records-by-slot.test.ts` (new)

- [ ] **Step 1: Add the field and let the compiler enumerate sites**

`RevisionRoot` gains:

```ts
  /**
   * Slot-indexed view of `rows` — same records, array-resident. Per-revision
   * immutable (chunked COW), which is what keeps THIS root's bindings valid
   * when the allocator later reuses a slot. Invariant, test-pinned:
   * slotVectorGet(recordsBySlot, record.slot) === record for every record in
   * `rows`, at every committed root.
   */
  readonly recordsBySlot: SlotVector<RowRecord<TRow, TRowId, TColumns>>;
  /**
   * The slot-space size this root's slot-indexed structures were built for
   * (the allocator's capacity at commit time). A root must be
   * SELF-DESCRIBING: readers size bitsets and walks from this field, never
   * from the live allocator — reading the allocator would let later growth
   * leak into a held snapshot's domain.
   */
  readonly slotCapacity: number;
```

`slotCapacity` per site: wherever the table below says "carried", carry it; drafted/built sites stamp `input.slots.capacity` (or the threaded capacity value, for the cooperative transition) at commit time.

Run `pnpm --filter @pretable/row-model typecheck` — the errors are the site list. Decision table:

| Site | `recordsBySlot` |
|---|---|
| `create-local-row-model.ts:609` (initial) | from `buildRowStore` result (see 5a) |
| `create-local-row-model.ts` expansion/spread sites (~944, ~1400) | carried by `...previousRoot` — no edit |
| `create-local-row-model.ts` drafted sites (~1073, ~1137) | from the draft result (see 5b) |
| `filter-rebuild.ts:188` | `captured.recordsBySlot` (rows carried by identity) |
| `sort-rebuild.ts:115` | `captured.recordsBySlot` (rows carried by identity) |
| `cooperative-transition.ts:710` (`finish`) | from the transition state (see 5c) |

5a. `BuiltRowStore` gains `readonly recordsBySlot: SlotVector<...>`; `buildRowStore` computes it after the loop:

```ts
    recordsBySlot: slotVectorFromEntries(
      records.map((record) => [record.slot, record] as const),
      input.slots.capacity,
    ),
```

5b. `TransactionDraftResult` and `RowsReplacementDraftResult` gain the field. In `applyFlatTransactionDraft`, build the write list on the success path — removals clear, prepared records write:

```ts
    const slotWrites: Array<readonly [number, RowRecord<TRow, TRowId, TColumns> | undefined]> = [
      ...removedRecords.map((record) => [record.slot, undefined] as const),
      ...prepared.map((record) => [record.slot, record] as const),
    ];
    const { next: recordsBySlot, chunksTouched } = slotVectorWithAll(
      input.root.recordsBySlot,
      slotWrites,
      input.slots.capacity,
    );
```

(`removedRecords` = the records behind `effectiveRemoves`, already fetched for `groupedRemovals` — hoist ONE array instead of fetching twice.) Add `chunksTouched` to instrumentation: `input.instrumentation.work.slotChunksTouched += chunksTouched` (add the counter to `LocalRowModelInstrumentation.work` in `diagnostics.ts`, initialized 0, alongside its neighbors). `replaceFlatRowsDraft`: same pattern over its own removed/added/carried records; if it internally rebuilds wholesale, `slotVectorFromEntries` over the final records is acceptable there (set-rows is O(n) already).

5c. `cooperative-transition.ts`: `rebuildRowStoreForQuery`'s `Pick<...>` return gains `recordsBySlot` built with `slotVectorFromEntries` over its `records` (capacity: pass `slots.capacity` in — thread the allocator reference or just `capacity: number` through the existing options of the transition; prefer passing the allocator's capacity value at capture time, since the transition must NOT observe later growth). `finish()` reads it off the retained state.

- [ ] **Step 2: Write the invariant test**

`records-by-slot.test.ts` — one scripted sequence covering: initial build → update transaction → remove+add transaction (slot reuse) → set-rows replacement → filter-only setQuery → sort-only setQuery. After EVERY committed revision assert, for every record in the root's `rows`: `slotVectorGet(root.recordsBySlot, record.slot) === record` (identity, not equality), and count(records) === count(live entries via `forEachSlotEntry`). Plus the held-snapshot pin: capture the root BEFORE the remove+add, run the remove+add (slot reused), assert the CAPTURED root still resolves the old record at that slot. Use the same root-access idiom as Task 4.

- [ ] **Step 3: Run**

`pnpm --filter @pretable/row-model test` and `typecheck` — all green, zero remaining compile errors (that's the proof all sites are handled).

- [ ] **Step 4: Commit**

```bash
git add -A packages/row-model/src
git commit -m "feat(row-model): per-revision recordsBySlot slot vector"
```

---

### Task 6: `RevisionRoot.visibleSlots` — required field, flat-real / grouped-empty

**Files:**
- Modify: `packages/row-model/src/internal-types.ts`, plus the same six files as Task 5
- Modify: `packages/row-model/src/visible-index.ts` (helper)
- Test: `packages/row-model/src/__tests__/visible-slots.test.ts` (new)

- [ ] **Step 1: Add the field and the helper**

`RevisionRoot` gains:

```ts
  /**
   * Flat roots: one bit per slot, set iff the row is a member of
   * `visible.rows` — the same structural verdict `filter-membership`
   * resolves, indexed for O(1)/word-scan access. Grouped roots carry
   * `EMPTY_MEMBERSHIP` (their membership lives in the group index) and every
   * reader must treat it per that module's contract. Never mutated after the
   * root commits.
   */
  readonly visibleSlots: MembershipBitset;
```

`visible-index.ts` gains:

```ts
/** Membership bitset of a FLAT visible tree: one pass, entry.record.slot. */
export function membershipFromFlatTree<...>(
  rows: VisibleIndexRoot<...>["rows"],
  capacity: number,
): MembershipBitset {
  const bits = createMembership(capacity);
  for (const entry of rows.range(0, rows.size)) {
    setMembershipBit(bits, entry.record.slot);
  }
  return bits;
}
```

Decision table (same compiler-driven enumeration):

| Site | `visibleSlots` |
|---|---|
| initial (609) | grouped query → `EMPTY_MEMBERSHIP`; flat → `membershipFromFlatTree(visibleTree, slots.capacity)` |
| spread sites | carried automatically — CHECK each: the two expansion sites only re-attach group indexes over the same flat tree/groups, membership unchanged → correct to carry |
| drafted sites | from the draft result (Step 2) |
| `filter-rebuild.ts` | Task 7 rewrites this producer — for THIS task make it compile honestly: zero-flip arm carries `captured.visibleSlots`; non-zero arm `membershipFromFlatTree(newTree, capacity)` (temporary; Task 7 replaces it with the verdict-pass bitset) |
| `sort-rebuild.ts` | `captured.visibleSlots` — a sort-only change keeps the member SET identical |
| cooperative `finish` | grouped → `EMPTY_MEMBERSHIP`; flat → `membershipFromFlatTree(state.flatRows, capacity)` |

- [ ] **Step 2: Draft maintenance in `applyFlatTransactionDraft`**

On the success path, flat roots (`previousGroups === undefined`):

```ts
    const visibleSlots = cloneMembership(input.root.visibleSlots, input.slots.capacity);
    for (const record of removedRecords) clearMembershipBit(visibleSlots, record.slot);
    for (const record of prepared) {
      if (passesNext(record)) setMembershipBit(visibleSlots, record.slot);
      else clearMembershipBit(visibleSlots, record.slot);
    }
```

Grouped roots: `const visibleSlots = EMPTY_MEMBERSHIP;`. `replaceFlatRowsDraft`: flat → `membershipFromFlatTree` over its final flat tree (O(n), and set-rows is O(n) already); grouped → sentinel.

- [ ] **Step 3: Write the oracle test**

`visible-slots.test.ts`: (1) equivalence oracle — after each step of a scripted sequence (build with a filter active → transaction flipping some rows across the filter boundary → remove a visible row → filter-only setQuery), assert for a FLAT root that `testMembershipBit(root.visibleSlots, record.slot) === (root.visible.rows.get(record.rowId) !== undefined)` for EVERY record; (2) grouped roots carry the `EMPTY_MEMBERSHIP` sentinel by identity; (3) mutation-hardening: run the oracle once with `clearMembershipBit` in the removal loop commented out and confirm it FAILS, then restore (do this as a one-time verification, note it in the task report — do not leave a permanently-mutated test).

- [ ] **Step 4: Run**

`pnpm --filter @pretable/row-model test` and `typecheck` — green.

- [ ] **Step 5: Commit**

```bash
git add -A packages/row-model/src
git commit -m "feat(row-model): per-revision visibleSlots membership bitset"
```

---

### Task 7: Rewrite the filter-only rebuild on slots + bitsets

**Files:**
- Modify: `packages/row-model/src/filter-rebuild.ts` (the walk, ~lines 78–110, and the visibleSlots wiring from Task 6)
- Test: existing `filter-*` suites must pass unchanged; add one order-independence pin

- [ ] **Step 1: Replace the walk**

The current walk iterates `captured.sourceOrder.range(...)` and pays `captured.rows.get(rowId)` (HAMT, 18.5ms at 50k) plus `rowPassesFilter(captured, rowId)` (`visible.rows.get`, 11.9ms). Replace with a hole-skipping slot walk that computes the new bitset as it goes:

```ts
  const nextVisibleSlots = createMembership(capacity); // capacity: see note
  const flippedIn: OrderedRowEntry<TRow, TRowId, TColumns>[] = [];
  const flippedOut = new Set<TRowId>();
  // Slot order, not source order — sound because nothing downstream reads
  // this walk's order: flippedIn is comparator-sorted below, flippedOut is a
  // set, and the merge consumes the OLD TREE's walk. recordsBySlot replaces
  // the rows-HAMT get; visibleSlots replaces the old-verdict membership get.
  forEachSlotEntry(captured.recordsBySlot, (previous) => {
    const passes = filterVerdict(nextPlan, previous as never);
    if (passes) setMembershipBit(nextVisibleSlots, previous.slot);
    if (passes === testMembershipBit(captured.visibleSlots, previous.slot)) return;
    if (passes) {
      const keys = sortKeysOf(nextPlan, previous as never) as readonly CompiledSortKey<TColumns>[];
      flippedIn.push(Object.freeze({ record: previous, keys }));
    } else {
      flippedOut.add(previous.rowId);
    }
  });
```

Capacity note: the rebuild has no allocator reference and must not read one (roots are self-describing — see `slotCapacity`, added in Task 5). Use `captured.slotCapacity` as `capacity` here; the new root carries the same value.

Zero-flip arm: `visibleSlots: captured.visibleSlots` (drop `nextVisibleSlots`). Non-zero arm: `visibleSlots: nextVisibleSlots`, replacing Task 6's temporary `membershipFromFlatTree` call. Everything else — flip sort, merge, `orderIsProven`, `derivedById`, journal reason, instrumentation — is UNCHANGED.

- [ ] **Step 2: Order-independence pin**

Add to the existing filter fast-path suite: a model whose transaction history makes slot order ≠ source order ≠ visible order (e.g. build A,B,C,D; remove B; add E — E reuses B's slot), then a filter-only setQuery flipping E and A. Assert the visible sequence equals what the public API contract requires (compare against a freshly-built model with the same final rows and query — same visible order). This is the pin that fails if anyone later makes the walk order-sensitive.

- [ ] **Step 3: Run the full package suite + the repo's react suite**

`pnpm --filter @pretable/row-model test` (all 515+ green) and `pnpm --filter @pretable/react test` (the 1246-test suite exercises setQuery end to end; local flake rule — a timed-out test re-runs once before it counts).

- [ ] **Step 4: Commit**

```bash
git add -A packages/row-model/src
git commit -m "perf(row-model): filter-only rebuild walks slots and diffs membership bitsets"
```

---

### Task 8: Node A/B + browser bench measurement

**Files:**
- Create: results section appended to `docs/superpowers/specs/2026-08-24-dense-handle-m0-results.md` (new `## M1+M2 measured` section) — or a sibling `...-m1-m2-results.md` if the section grows past a screen

- [ ] **Step 1: Rebuild and A/B in the browser bench**

Protocol (violations produced three wrong conclusions in the prior arc — follow exactly):
1. `lsof -i :4173` — if held by another process, STOP and report; never kill the holder (parallel session).
2. Baseline side = this branch BEFORE Task 1 (`git log` — the commit before the first M1 commit; use a throwaway worktree at that commit if the machine is loaded, interleaving paired runs). Variant side = HEAD. ONE variable: the M1+M2 commits.
3. Per side: `pnpm --filter @pretable/app-bench build` (rebuilds dependency dists via prepare:deps), then `pnpm --filter @pretable/app-bench preview:bench` (background), then:
   `node scripts/bench-matrix.mjs --adapters=pretable,tanstack --scenarios=S2 --scale=target --scripts=filter-metadata,filter-text --repeats=3`
   (Check `shared/bench-adapter-families.js` for the exact TanStack adapter id before running; `--scale=target` is the 50k tier — confirm against existing `status/*-s2-target-*` summary filenames. Also run `--scale=dev` for the 3k tier.)
4. Read the summary JSONs the run writes under `status/` — field names as in the existing `chromium-pretable-default-s2-target-filter-*.summary.json` files (settle, `post_interaction_long_tasks_ms`, interaction latency). Redirect any gate/script output to files and check exit codes — no `grep|head` pipelines.
5. Fitness: TanStack same-run numbers must sit in the historical band (compare to the baseline side's TanStack numbers — that IS the band); if they moved, the regime changed — rerun, don't conclude.

- [ ] **Step 2: Write the results**

Table: baseline-side vs variant-side for 50k settle (both filter scripts), 3k settle, block/long-tasks, interaction latency, TanStack controls. Name the delta against the branch's pre-M1 numbers (158.3/157.5ms @50k, 34.5/33.6ms @3k) and against the est. −30ms. State plainly if the gain is smaller than estimated and where the time went (trace only if needed: `node scripts/analyze-cdp.mjs --window=interaction <trace>` — traces skew absolutes ~2×, shares only).

- [ ] **Step 3: Full gates**

`pnpm build && pnpm api` (expect ZERO `.api.md` drift — everything here is internal; any drift is a defect, stop and fix), `pnpm lint`, full `pnpm test` at repo root (react vitest flake rule: 1–2 random timeouts per full run locally — re-run before believing).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/
git commit -m "docs: M1+M2 measured results (slots + membership bitsets)"
```
