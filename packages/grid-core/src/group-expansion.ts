/**
 * Bounding the per-group expand/collapse override set.
 *
 * Expansion state is a set of *group ids* whose expanded state differs from
 * `groupsDefaultExpanded`. Keying on a path-derived id rather than on a node is
 * what lets a group survive emptying and returning mid-stream — ag-grid's
 * expansion lives on a `RowNode` that `removeEmptyGroups` destroys, so theirs
 * does not. The price is that the set has no natural shrink point: under a
 * stream whose grouping keys churn, ids for groups that never come back would
 * accumulate for the lifetime of the grid.
 *
 * The policy here is a **bounded LRU over decisions**: the set remembers the N
 * most recently *decided* groups. "Decided" means a `setGroupExpanded` /
 * `toggleGroup` call landed on that id — deliberately not "most recently seen
 * in a flattening", because pruning to the current flattening is exactly the
 * ag-grid bug this design set out to avoid. A group can vanish from the data
 * for any number of derives and still come back with its state intact; only
 * *newer decisions about other groups* can push it out.
 *
 * @internal
 */

/**
 * How many per-group expansion decisions are remembered by default.
 *
 * Sized so it cannot bite hand-driven use (10 000 toggles is hours of clicking)
 * while still capping worst-case retention at roughly a megabyte of ids. Bulk
 * intent has an unbounded path that costs nothing: `expandAll` / `collapseAll`
 * flip the default and clear the set, so "collapse all 10 million groups" is
 * one operation with zero entries.
 *
 * @internal
 */
export const DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT = 10_000;

/**
 * Normalize the configured limit. `Infinity` is honored (opt out of the cap);
 * anything else non-finite, or not a number, falls back to the default; finite
 * values clamp to at least 1 so that recording a decision always keeps it.
 *
 * @internal
 */
export function resolveGroupExpansionOverrideLimit(
  configured: number | undefined,
): number {
  if (configured === undefined) return DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT;
  if (configured === Number.POSITIVE_INFINITY) return configured;
  if (!Number.isFinite(configured)) {
    return DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT;
  }

  return Math.max(1, Math.floor(configured));
}

/**
 * Record an override for `groupId`, returning a new set — engine state is
 * replaced rather than mutated so its identity works as a derive cache key.
 *
 * A `Set` iterates in insertion order, so the oldest decision is always
 * `values().next()`. Deleting before adding keeps that invariant unconditional
 * by moving an already-present id to the newest position — the engine's change
 * guard means `setGroupExpanded` never actually re-adds a present id, but the
 * helper should not depend on its caller for its ordering guarantee. Eviction
 * loops rather than shifting once, so an over-full set converges in one call.
 *
 * @internal
 */
export function addGroupExpansionOverride(
  current: ReadonlySet<string>,
  groupId: string,
  limit: number,
): ReadonlySet<string> {
  const next = new Set(current);

  next.delete(groupId);
  next.add(groupId);

  while (next.size > limit) {
    const oldest = next.values().next().value as string;
    next.delete(oldest);
  }

  return next;
}
