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
