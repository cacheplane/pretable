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

export function clearMembershipBit(bits: MembershipBitset, slot: number): void {
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
