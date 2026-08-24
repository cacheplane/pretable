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
): { readonly next: SlotVector<T>; readonly chunksCopied: number } {
  const tableSize = Math.max(
    vector.chunks.length,
    Math.ceil(capacity / SLOT_VECTOR_CHUNK),
  );
  const chunks: Array<
    Array<T | undefined> | ReadonlyArray<T | undefined> | undefined
  > = new Array(tableSize);
  for (let i = 0; i < vector.chunks.length; i += 1)
    chunks[i] = vector.chunks[i];
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
  return { next: { chunks }, chunksCopied: copied.size };
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
