/*
 * Mutable chunked columnar cell store — the backing representation of the
 * plan-shared columnar filter-value cache (Amendment J §§2–4). Same two-level
 * layout as `slot-vector` (a chunk table over `SLOT_VECTOR_CHUNK`-element
 * chunks, table extended on demand like the allocator grows), but MUTABLE in
 * place where `SlotVector` is copy-on-write.
 *
 * INVARIANT REGISTER — why in-place mutation is sound in a codebase of
 * immutable revisions:
 *
 * - CELLS ARE SCAN-NORMALIZED, NOT RAW. A cell holds the column TYPE's
 *   scan-oriented representation of the accessor value —
 *   `normalizeCellForScan` in `./compiled-query` (text lowercased, dates as
 *   UTC day-ms, enum/boolean coerced, numbers as-is) — so the bulk sweep's
 *   normalized predicates compare directly, with zero per-row
 *   re-normalization. Nothing may read a cell expecting the RAW accessor
 *   value; raw consumers (per-row `filterVerdict`, `evaluate`, `isEmpty`
 *   semantics) never touch this store.
 * - CACHE, NOT TRUTH. Cells are memoized (normalized) accessor reads keyed
 *   by (columnId, slot). The store is never read by snapshot reads, is not
 *   revision-scoped, and old committed roots never consult it — a root's
 *   verdict is its membership (`./filter-membership`), and a root's values
 *   are its rows. Losing every cell is a performance event, never a
 *   correctness event.
 * - ONE WRITER (Amendment J §3, revised). Only the bulk filter scan fills
 *   cells (write-through on holes, reading the committed records it is
 *   scanning). `evaluate` never writes — drafts evaluate rows BEFORE the
 *   draft is known effective, and two ingest paths hand `evaluate` a `-1`
 *   placeholder slot. Commit-side maintenance only CLEARS: a committed
 *   transaction clears its changed and removed rows' slots; set-rows resets
 *   wholesale. So every present cell reflects a row the CURRENT committed
 *   revision binds to that slot, which is the whole freshness invariant.
 * - HOLES are first-class. A missing cell answers by live accessor read
 *   (and the scan then fills it). Presence lives in a per-chunk bitset —
 *   NOT a sentinel stored in the value array — because accessors can
 *   legitimately return `undefined` as a cached VALUE, because a fresh
 *   `Uint32Array` is all-holes for free (a sentinel would need a fill pass
 *   per chunk), and because the bulk scan can consult presence word-wise.
 *   Single-cell reads surface a miss as the `COLUMNAR_HOLE` symbol, which
 *   no accessor can produce.
 * - MUTABLE-IN-PLACE is a recorded deviation from Amendment J §2's
 *   "chunked COW" wording: COW exists to keep old snapshots valid, and
 *   nothing snapshot-scoped ever reads this store, so per-commit chunk
 *   copies would buy nothing. The row model is single-threaded, so plans
 *   sharing one store never race.
 */

import { SLOT_VECTOR_CHUNK } from "./slot-vector";

const WORDS_PER_CHUNK = SLOT_VECTOR_CHUNK / 32;

/**
 * The miss signal for single-cell reads: returned where a cell is a hole,
 * distinct from a cached `undefined` value. Never storable — accessors
 * cannot mint this symbol.
 */
export const COLUMNAR_HOLE: unique symbol = Symbol("columnar-hole");

export type ColumnarHole = typeof COLUMNAR_HOLE;

interface ColumnarChunk {
  readonly values: unknown[];
  /** Presence bitset: bit set ⇔ the same-offset cell is present. */
  readonly present: Uint32Array;
}

/** One filter column's cells, indexed by dense-handle slot. */
export interface MutableColumnarVector {
  /** Sparse table: a missing/undefined chunk reads as all holes. */
  readonly chunks: (ColumnarChunk | undefined)[];
}

export function createColumnarVector(): MutableColumnarVector {
  return { chunks: [] };
}

/**
 * Slots are dense handles and never negative; `-1` exists elsewhere as an
 * "unallocated yet" placeholder (`CompiledRowInput.slot` on the deferred
 * ingest paths) and must never reach this store — fail loud if it does.
 */
function assertRealSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new RangeError(`Columnar cells require a real slot; got ${slot}.`);
  }
}

export function columnarGetCell(
  vector: MutableColumnarVector,
  slot: number,
): unknown | ColumnarHole {
  assertRealSlot(slot);
  const chunk = vector.chunks[(slot / SLOT_VECTOR_CHUNK) | 0];
  if (chunk === undefined) return COLUMNAR_HOLE;
  const offset = slot % SLOT_VECTOR_CHUNK;
  return (chunk.present[offset >>> 5]! & (1 << (offset & 31))) === 0
    ? COLUMNAR_HOLE
    : chunk.values[offset];
}

/**
 * Assert-free read for the bulk sweep's hot loop ONLY. The sweep's slots
 * come from `forEachSlotEntry`'s walk (`chunkIndex * SLOT_VECTOR_CHUNK +
 * offset`), nonnegative integers by construction, so the `-1`-placeholder
 * guard `columnarGetCell` runs per cell would check an invariant the walk
 * already proves. Every other caller uses `columnarGetCell`.
 */
export function columnarGetCellTrusted(
  vector: MutableColumnarVector,
  slot: number,
): unknown | ColumnarHole {
  const chunk = vector.chunks[(slot / SLOT_VECTOR_CHUNK) | 0];
  if (chunk === undefined) return COLUMNAR_HOLE;
  const offset = slot % SLOT_VECTOR_CHUNK;
  return (chunk.present[offset >>> 5]! & (1 << (offset & 31))) === 0
    ? COLUMNAR_HOLE
    : chunk.values[offset];
}

export function columnarSetCell(
  vector: MutableColumnarVector,
  slot: number,
  value: unknown,
): void {
  assertRealSlot(slot);
  const index = (slot / SLOT_VECTOR_CHUNK) | 0;
  let chunk = vector.chunks[index];
  if (chunk === undefined) {
    chunk = {
      values: new Array<unknown>(SLOT_VECTOR_CHUNK),
      present: new Uint32Array(WORDS_PER_CHUNK),
    };
    vector.chunks[index] = chunk;
  }
  const offset = slot % SLOT_VECTOR_CHUNK;
  chunk.values[offset] = value;
  chunk.present[offset >>> 5]! |= 1 << (offset & 31);
}

export function columnarClearCell(
  vector: MutableColumnarVector,
  slot: number,
): void {
  assertRealSlot(slot);
  const chunk = vector.chunks[(slot / SLOT_VECTOR_CHUNK) | 0];
  if (chunk === undefined) return;
  const offset = slot % SLOT_VECTOR_CHUNK;
  // The value write is not redundant with the bit clear: it releases the
  // cached reference so a cleared cell cannot pin a retired row's value.
  chunk.values[offset] = undefined;
  chunk.present[offset >>> 5]! &= ~(1 << (offset & 31));
}
