/**
 * Membership bitset: one bit per dense key (row-model SLOT). Duplicated from
 * `@pretable-internal/row-model`'s `membership-bitset.ts` BY DESIGN —
 * layout-core stays dependency-free (it cannot import row-model), so this
 * ~40-line primitive is hand-copied rather than shared. Keep the two files
 * in sync by hand; if one changes shape, mirror the change in the other.
 *
 * See `docs/superpowers/specs/2026-08-24-dense-handle-amendment-i-layout-seam.md`
 * for the dense lane this backs.
 */

export type DenseMembership = Uint32Array;

export function createDenseMembership(capacity: number): DenseMembership {
  return new Uint32Array((capacity + 31) >>> 5);
}

/** Clone, growing to `capacity` when it exceeds the source's words. */
export function cloneDenseMembership(
  bits: DenseMembership,
  capacity: number,
): DenseMembership {
  const words = Math.max(bits.length, (capacity + 31) >>> 5);
  const next = new Uint32Array(words);
  next.set(bits);
  return next;
}

export function setDenseBit(bits: DenseMembership, slot: number): void {
  bits[slot >>> 5]! |= 1 << (slot & 31);
}

export function clearDenseBit(bits: DenseMembership, slot: number): void {
  bits[slot >>> 5]! &= ~(1 << (slot & 31));
}

/** Out-of-range slots read as false. */
export function testDenseBit(bits: DenseMembership, slot: number): boolean {
  const word = bits[slot >>> 5];
  return word === undefined ? false : ((word >>> (slot & 31)) & 1) === 1;
}
