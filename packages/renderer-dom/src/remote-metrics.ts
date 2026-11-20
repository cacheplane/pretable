import type { RowMetricsReader } from "@pretable-internal/layout-core";
import { finitePositive, safeExtent } from "./remote-dimensions";
export interface RemoteAnchor {
  readonly id: string;
  readonly offset: number;
}
/** Persistent AVL prefix sums: each viewport measurement changes O(log M) nodes. */
interface Correction {
  readonly rank: number;
  readonly delta: number;
  readonly left?: Correction;
  readonly right?: Correction;
  readonly depth: number;
  readonly sum: number;
}
const depth = (node: Correction | undefined) => node?.depth ?? 0;
function correction(
  rank: number,
  delta: number,
  left?: Correction,
  right?: Correction,
): Correction {
  return {
    rank,
    delta,
    left,
    right,
    depth: 1 + Math.max(depth(left), depth(right)),
    sum: delta + (left?.sum ?? 0) + (right?.sum ?? 0),
  };
}
function rotateLeft(node: Correction): Correction {
  const right = node.right!;
  return correction(
    right.rank,
    right.delta,
    correction(node.rank, node.delta, node.left, right.left),
    right.right,
  );
}
function rotateRight(node: Correction): Correction {
  const left = node.left!;
  return correction(
    left.rank,
    left.delta,
    left.left,
    correction(node.rank, node.delta, left.right, node.right),
  );
}
function balance(node: Correction): Correction {
  if (depth(node.left) - depth(node.right) > 1) {
    if (depth(node.left!.right) > depth(node.left!.left))
      node = correction(
        node.rank,
        node.delta,
        rotateLeft(node.left!),
        node.right,
      );
    return rotateRight(node);
  }
  if (depth(node.right) - depth(node.left) > 1) {
    if (depth(node.right!.left) > depth(node.right!.right))
      node = correction(
        node.rank,
        node.delta,
        node.left,
        rotateRight(node.right!),
      );
    return rotateLeft(node);
  }
  return node;
}
function update(
  node: Correction | undefined,
  rank: number,
  delta: number | undefined,
): Correction | undefined {
  if (!node) return delta === undefined ? undefined : correction(rank, delta);
  if (rank < node.rank)
    return balance(
      correction(
        node.rank,
        node.delta,
        update(node.left, rank, delta),
        node.right,
      ),
    );
  if (rank > node.rank)
    return balance(
      correction(
        node.rank,
        node.delta,
        node.left,
        update(node.right, rank, delta),
      ),
    );
  if (delta !== undefined)
    return correction(rank, delta, node.left, node.right);
  if (!node.left) return node.right;
  if (!node.right) return node.left;
  let next = node.right;
  while (next.left) next = next.left;
  return balance(
    correction(
      next.rank,
      next.delta,
      node.left,
      update(node.right, next.rank, undefined),
    ),
  );
}
function at(
  node: Correction | undefined,
  rank: number,
): Correction | undefined {
  while (node) {
    if (node.rank === rank) return node;
    node = rank < node.rank ? node.left : node.right;
  }
  return undefined;
}
function prefix(node: Correction | undefined, rank: number): number {
  let sum = 0;
  while (node) {
    if (rank <= node.rank) node = node.left;
    else {
      sum += (node.left?.sum ?? 0) + node.delta;
      node = node.right;
    }
  }
  return sum;
}
interface Measurement {
  readonly height: number;
  readonly rank: number | undefined;
}
/** The cache owner reserves before allocation. commit applies retained charges and
 * releases transient reservation atomically; cancel releases only the reservation.
 * Callbacks must not notify/reenter mutations. A rejected transaction retains all
 * previous measurements. IDs and prefix nodes are included in these estimates.
 */
export interface RemoteMeasurementBudget {
  prepare(
    changes: readonly { id: string; bytes: number }[],
    removed: readonly string[] | "all",
    transientBytes: number,
  ): { commit(): boolean; cancel(): void } | undefined;
}
export interface RemoteMetricsPreparation {
  read(): RowMetricsReader | undefined;
  advance(maxUnits: number): boolean;
  commit(): boolean;
  cancel(): void;
}
/** Structurally implements RowMetricsReader without enumerating unseen rows. */
export class RemoteMetrics {
  private measurements = new Map<string, Measurement>();
  private root: Correction | undefined;
  private total = 0;
  private version = 0;
  private busy = false;
  constructor(
    public rowCount: number,
    private readonly estimate: number,
    private readonly cap: number,
    private rankOf: (id: string) => number | undefined,
    private readonly budget?: RemoteMeasurementBudget,
  ) {
    finitePositive(estimate);
    if (!Number.isSafeInteger(cap) || cap < 0)
      throw new RangeError("Invalid measurement cap");
    if (!Number.isSafeInteger(rowCount) || rowCount < 0)
      throw new RangeError("Invalid row count");
    safeExtent(rowCount * estimate);
    this.total = rowCount * estimate;
  }
  get measurementCount(): number {
    return this.measurements.size;
  }
  private resolve(
    id: string,
    rowCount = this.rowCount,
    rankOf = this.rankOf,
  ): number | undefined {
    const rank = rankOf(id);
    if (
      rank !== undefined &&
      (!Number.isSafeInteger(rank) || rank < 0 || rank >= rowCount)
    )
      throw new RangeError("Invalid measured rank");
    return rank;
  }
  private exclusive<T>(work: () => T): T {
    if (this.busy) throw new Error("Reentrant remote metrics mutation");
    this.busy = true;
    try {
      return work();
    } finally {
      this.busy = false;
    }
  }
  prepareSync(
    rowCount: number,
    rankOf: (id: string) => number | undefined,
    retainMeasurements = true,
  ): RemoteMetricsPreparation {
    if (!Number.isSafeInteger(rowCount) || rowCount < 0)
      throw new RangeError("Invalid row count");
    safeExtent(rowCount * this.estimate);
    const version = this.version;
    const lease = this.exclusive(() =>
      this.budget?.prepare(
        [],
        retainMeasurements ? [] : "all",
        retainMeasurements ? this.measurements.size * 256 : 0,
      ),
    );
    const denied = !!this.budget && !lease;
    let closed = false,
      done = false;
    let root: Correction | undefined;
    const measurements = new Map<string, Measurement>();
    const iterator = (
      retainMeasurements ? this.measurements : new Map<string, Measurement>()
    ).entries();
    const cancel = () => {
      if (!closed) {
        closed = true;
        lease?.cancel();
        measurements.clear();
        root = undefined;
      }
    };
    return {
      read: () => {
        if (!done || closed || version !== this.version) return undefined;
        const candidate = new RemoteMetrics(rowCount, this.estimate, 0, rankOf);
        candidate.root = root;
        candidate.total = rowCount * this.estimate + (root?.sum ?? 0);
        safeExtent(candidate.total);
        return Object.freeze(candidate);
      },
      advance: (maxUnits) =>
        this.exclusive(() => {
          if (!Number.isSafeInteger(maxUnits) || maxUnits < 1)
            throw new RangeError("Invalid preparation slice");
          if (closed || denied || version !== this.version) {
            cancel();
            return true;
          }
          try {
            for (let unit = 0; unit < maxUnits; unit++) {
              const entry = iterator.next();
              if (entry.done) {
                done = true;
                return true;
              }
              const [id, value] = entry.value;
              const rank = this.resolve(id, rowCount, rankOf);
              if (rank !== undefined) {
                if (at(root, rank)) {
                  cancel();
                  throw new Error("Duplicate measured rank");
                }
                root = update(root, rank, value.height - this.estimate);
              }
              measurements.set(id, { height: value.height, rank });
            }
            return false;
          } catch (error) {
            cancel();
            throw error;
          }
        }),
      commit: () =>
        this.exclusive(() => {
          if (closed || denied || !done || version !== this.version) {
            cancel();
            return false;
          }
          try {
            const total = rowCount * this.estimate + (root?.sum ?? 0);
            safeExtent(total);
            if (lease && !lease.commit()) {
              cancel();
              return false;
            }
            this.rowCount = rowCount;
            this.rankOf = rankOf;
            this.measurements = measurements;
            this.root = root;
            this.total = total;
            this.version++;
            closed = true;
            return true;
          } catch (error) {
            cancel();
            throw error;
          }
        }),
      cancel: () => this.exclusive(cancel),
    };
  }
  /** Convenience for small projections; renderer integrations use bounded prepareSync. */
  sync(rowCount: number, rankOf: (id: string) => number | undefined): void {
    const pending = this.prepareSync(rowCount, rankOf);
    try {
      while (!pending.advance(256)) {
        /* synchronous convenience */
      }
      if (!pending.commit())
        throw new Error("Remote metrics preparation refused or superseded");
    } catch (error) {
      pending.cancel();
      throw error;
    }
  }
  measure(id: string, height: number): boolean {
    return this.measureBatch([{ id, height }]);
  }
  /** Stage only changed paths; validation never mutates the published prefix tree. */
  measureBatch(entries: readonly { id: string; height: number }[]): boolean {
    return this.exclusive(() => {
      const changes = new Map<string, Measurement>();
      for (const { id, height } of entries) {
        finitePositive(height);
        changes.delete(id);
        changes.set(id, { height, rank: this.resolve(id) });
      }
      const removed = new Set<string>();
      let size = this.measurements.size;
      for (const id of changes.keys()) if (!this.measurements.has(id)) size++;
      for (const id of this.measurements.keys()) {
        if (size <= this.cap) break;
        if (!changes.has(id)) {
          removed.add(id);
          size--;
        }
      }
      for (const id of changes.keys()) {
        if (size <= this.cap) break;
        changes.delete(id);
        if (this.measurements.has(id)) removed.add(id);
        size--;
      }
      return this.applyMeasurements(changes, removed);
    });
  }
  private applyMeasurements(
    changes: Map<string, Measurement>,
    removed: Set<string>,
  ): boolean {
    const charge = [...changes].map(([id]) => ({
      id,
      bytes: 192 + id.length * 2,
    }));
    const transientBytes =
      (changes.size + removed.size) * (1 + depth(this.root)) * 128;
    const lease = this.budget?.prepare(charge, [...removed], transientBytes);
    if (this.budget && !lease) return false;
    let committed = false;
    try {
      let root = this.root;
      for (const id of [...removed, ...changes.keys()]) {
        const previous = this.measurements.get(id);
        if (previous?.rank !== undefined)
          root = update(root, previous.rank, undefined);
      }
      for (const value of changes.values())
        if (value.rank !== undefined) {
          if (at(root, value.rank)) throw new Error("Duplicate measured rank");
          root = update(root, value.rank, value.height - this.estimate);
        }
      const total = this.rowCount * this.estimate + (root?.sum ?? 0);
      safeExtent(total);
      if (lease && !lease.commit()) return false;
      for (const id of removed) this.measurements.delete(id);
      for (const [id, value] of changes) {
        this.measurements.delete(id);
        this.measurements.set(id, value);
      }
      this.root = root;
      this.total = total;
      this.version++;
      committed = true;
      return true;
    } finally {
      if (!committed) lease?.cancel();
    }
  }
  evictMeasurements(ids: readonly string[]): boolean {
    return this.exclusive(() =>
      this.applyMeasurements(
        new Map(),
        new Set(ids.filter((id) => this.measurements.has(id))),
      ),
    );
  }
  invalidateMeasurements(): boolean {
    return this.exclusive(() => {
      const lease = this.budget?.prepare([], "all", 0);
      if (this.budget && !lease) return false;
      let committed = false;
      try {
        if (lease && !lease.commit()) return false;
        this.measurements = new Map();
        this.root = undefined;
        this.total = this.rowCount * this.estimate;
        this.version++;
        committed = true;
        return true;
      } finally {
        if (!committed) lease?.cancel();
      }
    });
  }
  getHeight(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.rowCount)
      return 0;
    return this.estimate + (at(this.root, index)?.delta ?? 0);
  }
  getOffsetForIndex(index: number): number {
    if (Number.isNaN(index) || index <= 0 || !this.rowCount) return 0;
    if (index >= this.rowCount) return this.total;
    index = Math.floor(index);
    return index * this.estimate + prefix(this.root, index);
  }
  getIndexForOffset(offset: number): number {
    if (Number.isNaN(offset) || offset <= 0 || !this.rowCount) return 0;
    if (offset >= this.total) return this.rowCount;
    let lo = 0,
      hi = this.rowCount;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (this.getOffsetForIndex(mid) <= offset) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }
  getTotalHeight(): number {
    return this.total;
  }
  captureAnchor(id: string, scrollTop: number): RemoteAnchor | undefined {
    const rank = this.rankOf(id);
    return rank === undefined
      ? undefined
      : { id, offset: scrollTop - this.getOffsetForIndex(rank) };
  }
  restoreAnchor(anchor: RemoteAnchor): number | undefined {
    const rank = this.rankOf(anchor.id);
    return rank === undefined
      ? undefined
      : this.getOffsetForIndex(rank) + anchor.offset;
  }
}
