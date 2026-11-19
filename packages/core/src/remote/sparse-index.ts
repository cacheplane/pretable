/** Internal topology only: payload eviction never removes these descriptors. */
export interface SparseGroup {
  readonly id: string;
  readonly parent: string | null;
  readonly ordinal: number;
  readonly childCount: number;
}
interface Branch {
  count: number;
  extent: number;
  expanded: {
    ordinal: number;
    id: string;
    start: number;
    end: number;
    extraBefore: number;
  }[];
}
function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Expected a nonnegative safe integer");
  return value;
}
/** Implicit sibling intervals plus bounded resolved group descriptors and expansion intent. */
export class SparseIndex {
  private groups = new Map<string, SparseGroup>();
  private expanded = new Set<string>();
  private branches = new Map<string | null, Branch>();
  private readonly limits: {
    maxNodes: number;
    maxDepth: number;
    maxExpanded: number;
  };
  constructor(
    private readonly rootCount: number,
    limits: Partial<{
      maxNodes: number;
      maxDepth: number;
      maxExpanded: number;
    }> = {},
  ) {
    count(rootCount);
    this.limits = {
      maxNodes: 8192,
      maxDepth: 32,
      maxExpanded: 2048,
      ...limits,
    };
    Object.values(this.limits).forEach(count);
    if (this.limits.maxNodes < 1)
      throw new RangeError("Root requires one topology node");
    this.branches = this.build(this.groups, this.expanded);
  }
  get rowCount(): number {
    return this.branches.get(null)!.extent;
  }
  get allocatedNodes(): number {
    return this.groups.size + 1;
  }
  /** Cumulative descriptor/ancestor visits, including refused preparations. */
  private work = 0;
  get preparationWork(): number {
    return this.work;
  }
  resolve(group: SparseGroup): void {
    this.resolveBatch([group]);
  }
  /** One candidate build for ingress/publication, never N complete tree builds. */
  resolveBatch(
    groups: Iterable<SparseGroup>,
    expanded: Iterable<string> = this.expanded,
  ): void {
    const next = new Map(this.groups);
    for (const group of groups) {
      count(group.ordinal);
      count(group.childCount);
      if (!group.id) throw new Error("Group requires identity");
      const current = next.get(group.id);
      if (
        current &&
        (current.parent !== group.parent ||
          current.ordinal !== group.ordinal ||
          current.childCount !== group.childCount)
      )
        throw new Error("Contradictory descriptor within result session");
      next.set(group.id, { ...group });
      if (next.size + 1 > this.limits.maxNodes)
        throw new RangeError("Topology cap");
    }
    const expansion = new Set(expanded);
    if (expansion.size > this.limits.maxExpanded)
      throw new RangeError("Expansion cap");
    const branches = this.build(next, expansion);
    this.groups = next;
    this.expanded = expansion;
    this.branches = branches;
  }
  setExpanded(id: string, value: boolean): void {
    const next = new Set(this.expanded);
    if (value) next.add(id);
    else next.delete(id);
    if (next.size > this.limits.maxExpanded)
      throw new RangeError("Expansion cap");
    const branches = this.build(this.groups, next);
    this.expanded = next;
    this.branches = branches;
  }
  private build(
    groups: Map<string, SparseGroup>,
    expanded: Set<string>,
  ): Map<string | null, Branch> {
    const children = new Map<string | null, SparseGroup[]>();
    for (const group of groups.values()) {
      this.work++;
      let parent = group.parent;
      let depth = 1;
      const seen = new Set([group.id]);
      while (parent !== null) {
        this.work++;
        if (seen.has(parent)) throw new Error("Topology cycle");
        seen.add(parent);
        const ancestor = groups.get(parent);
        if (!ancestor) throw new Error("Resolve ancestor descriptor first");
        parent = ancestor.parent;
        depth++;
      }
      if (depth > this.limits.maxDepth) throw new RangeError("Depth cap");
      const siblings = children.get(group.parent) ?? [];
      siblings.push(group);
      children.set(group.parent, siblings);
    }
    const result = new Map<string | null, Branch>();
    const visit = (id: string | null, size: number): Branch => {
      const branch: Branch = { count: size, extent: size, expanded: [] };
      const siblings = (children.get(id) ?? []).sort(
        (a, b) => a.ordinal - b.ordinal,
      );
      let previous = -1;
      for (const group of siblings) {
        if (group.ordinal >= size || group.ordinal === previous)
          throw new RangeError("Invalid sibling ordinal");
        previous = group.ordinal;
        const subtree = visit(group.id, group.childCount);
        if (expanded.has(group.id)) {
          const extraBefore = branch.extent - size;
          const start = count(group.ordinal + extraBefore + 1);
          const end = count(start + subtree.extent);
          branch.expanded.push({
            ordinal: group.ordinal,
            id: group.id,
            start,
            end,
            extraBefore,
          });
          branch.extent = count(branch.extent + subtree.extent);
        }
      }
      result.set(id, branch);
      return branch;
    };
    visit(null, this.rootCount);
    return result;
  }
  at(rank: number): { parent: string | null; ordinal: number } | undefined {
    const span = this.spanAt(rank);
    return span ? { parent: span.parent, ordinal: span.ordinal } : undefined;
  }
  /** Exclusive display end of this contiguous sibling run. A child expansion
   * always ends the run, so range planning can skip blocks without losing it. */
  spanAt(
    rank: number,
  ): { parent: string | null; ordinal: number; end: number } | undefined {
    if (!Number.isSafeInteger(rank) || rank < 0 || rank >= this.rowCount)
      return undefined;
    let parent: string | null = null;
    let base = 0;
    for (;;) {
      const branch: Branch = this.branches.get(parent)!;
      let lo = 0,
        hi = branch.expanded.length;
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (branch.expanded[mid]!.start <= rank) lo = mid + 1;
        else hi = mid;
      }
      const entry: Branch["expanded"][number] | undefined =
        branch.expanded[lo - 1];
      if (entry && rank < entry.end) {
        parent = entry.id;
        rank -= entry.start;
        base += entry.start;
        continue;
      }
      return {
        parent,
        end: base + (branch.expanded[lo]?.start ?? branch.extent),
        ordinal:
          rank - (entry ? entry.extraBefore + entry.end - entry.start : 0),
      };
    }
  }
  rank(parent: string | null, ordinal: number): number | undefined {
    const branch = this.branches.get(parent);
    if (
      !branch ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= branch.count
    )
      return undefined;
    let lo = 0,
      hi = branch.expanded.length;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (branch.expanded[mid]!.ordinal < ordinal) lo = mid + 1;
      else hi = mid;
    }
    const entry: Branch["expanded"][number] | undefined =
      branch.expanded[lo - 1];
    const local =
      ordinal + (entry ? entry.extraBefore + entry.end - entry.start : 0);
    if (parent === null) return local;
    if (!this.expanded.has(parent)) return undefined;
    const group = this.groups.get(parent)!;
    const ancestor = this.rank(group.parent, group.ordinal);
    return ancestor === undefined ? undefined : ancestor + 1 + local;
  }
}
