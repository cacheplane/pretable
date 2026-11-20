import { canonicalRemoteRoute } from "./query";
import type { PretableRemoteNode, PretableRemoteRange } from "./types";

type Identity = {
  readonly kind: "group" | "leaf";
  readonly id: string | number;
};
/** Compare validated identities without allocating canonical strings per lookup.
 * Namespaces, numeric/string keys and negative zero remain distinct. */
function compare(a: Identity, b: Identity): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (typeof a.id !== typeof b.id) return typeof a.id < typeof b.id ? -1 : 1;
  if (a.id === b.id) {
    if (Object.is(a.id, b.id)) return 0;
    return Object.is(a.id, -0) ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}
/** One compact offset index per retained immutable range, released with it.
 * Overlaps and duplicate IDs never create a lifetime row journal. */
export class RangeEvidence<TRow extends object> {
  private blocks = new Map<
    string,
    {
      range: PretableRemoteRange<TRow>;
      route: string;
      offsets: Uint32Array;
    }
  >();
  set(key: string, range: PretableRemoteRange<TRow>) {
    const offsets = Uint32Array.from(range.entries, (_, ordinal) => ordinal);
    offsets.sort((a, b) => compare(range.entries[a]!, range.entries[b]!));
    this.blocks.set(key, {
      range,
      route: canonicalRemoteRoute(range.route),
      offsets,
    });
  }
  delete(key: string) {
    this.blocks.delete(key);
  }
  clear() {
    this.blocks.clear();
  }
  find(
    identity: Identity,
  ):
    | { route: string; ordinal: number; node: PretableRemoteNode<TRow> }
    | undefined {
    for (const { range, route, offsets } of this.blocks.values()) {
      let lo = 0,
        hi = offsets.length;
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (compare(range.entries[offsets[mid]!]!, identity) < 0) lo = mid + 1;
        else hi = mid;
      }
      const offset = offsets[lo];
      if (
        offset !== undefined &&
        compare(range.entries[offset]!, identity) === 0
      )
        return {
          route,
          ordinal: range.start + offset,
          node: range.entries[offset]!,
        };
    }
  }
  at(route: string, ordinal: number): PretableRemoteNode<TRow> | undefined {
    for (const block of this.blocks.values()) {
      const offset = ordinal - block.range.start;
      if (
        block.route === route &&
        offset >= 0 &&
        offset < block.range.entries.length
      )
        return block.range.entries[offset];
    }
  }
  count(route: string): number | undefined {
    for (const block of this.blocks.values())
      if (block.route === route) return block.range.siblingCount;
    const node = this.find({ kind: "group", id: `group:${route}` })?.node;
    return node?.kind === "group" ? node.childCount : undefined;
  }
}
