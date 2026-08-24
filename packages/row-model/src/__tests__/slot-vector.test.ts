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
    const vec = slotVectorFromEntries(
      [
        [0, "a"],
        [2, "c"],
        [1500, "far"],
      ],
      2000,
    );
    expect(slotVectorGet(vec, 0)).toBe("a");
    expect(slotVectorGet(vec, 1)).toBeUndefined();
    expect(slotVectorGet(vec, 2)).toBe("c");
    expect(slotVectorGet(vec, 1500)).toBe("far");
    expect(slotVectorGet(vec, 1999)).toBeUndefined();
  });

  it("withAll writes and clears land; result reports chunks copied", () => {
    const base = slotVectorFromEntries(
      [
        [0, "a"],
        [1, "b"],
      ],
      10,
    );
    const { next, chunksCopied } = slotVectorWithAll(
      base,
      [
        [0, "A"],
        [1, undefined],
        [5, "f"],
      ],
      10,
    );
    expect(slotVectorGet(next, 0)).toBe("A");
    expect(slotVectorGet(next, 1)).toBeUndefined();
    expect(slotVectorGet(next, 5)).toBe("f");
    expect(chunksCopied).toBe(1); // all three slots share chunk 0
  });

  it("old snapshots survive later writes, including slot overwrite (COW pin)", () => {
    const v0 = slotVectorFromEntries(
      [
        [5, "old-5"],
        [1030, "old-1030"],
      ],
      2048,
    );
    const { next: v1 } = slotVectorWithAll(
      v0,
      [
        [5, "new-5"],
        [1030, undefined],
      ],
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
    const { next, chunksCopied } = slotVectorWithAll(base, writes, 4096);
    expect(chunksCopied).toBe(1);
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
    const vec = slotVectorFromEntries(
      [
        [3, "c"],
        [SLOT_VECTOR_CHUNK + 1, "x"],
      ],
      3000,
    );
    const seen: Array<[number, string]> = [];
    forEachSlotEntry(vec, (value, slot) => seen.push([slot, value]));
    expect(seen).toEqual([
      [3, "c"],
      [SLOT_VECTOR_CHUNK + 1, "x"],
    ]);
  });

  it("emptySlotVector reads undefined everywhere", () => {
    expect(slotVectorGet(emptySlotVector<string>(), 0)).toBeUndefined();
  });
});
