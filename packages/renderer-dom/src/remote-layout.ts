/** Remote-only prototypes. No changes to the manual-window coordinate contract. */
function finitePositive(value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError("Expected positive finite dimension");
}
function safeExtent(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new RangeError("Unsafe extent");
}
export interface RemoteAnchor {
  readonly id: string;
  readonly offset: number;
}
/** Structurally implements layout-core RowMetricsReader without enumerating unseen rows. */
export class RemoteMetrics {
  private measurements = new Map<string, number>();
  private corrections: { rank: number; height: number; before: number }[] = [];
  private total = 0;
  constructor(
    public rowCount: number,
    private readonly estimate: number,
    private readonly cap: number,
    private rankOf: (id: string) => number | undefined,
  ) {
    finitePositive(estimate);
    if (!Number.isSafeInteger(cap) || cap < 0)
      throw new RangeError("Invalid measurement cap");
    this.sync(rowCount, rankOf);
  }
  get measurementCount(): number {
    return this.measurements.size;
  }
  sync(rowCount: number, rankOf: (id: string) => number | undefined): void {
    if (!Number.isSafeInteger(rowCount) || rowCount < 0)
      throw new RangeError("Invalid row count");
    const next = this.rebuild(rowCount, rankOf, this.measurements);
    this.rowCount = rowCount;
    this.rankOf = rankOf;
    this.corrections = next.corrections;
    this.total = next.total;
  }
  private rebuild(
    rowCount: number,
    rankOf: (id: string) => number | undefined,
    measurements: Map<string, number>,
  ) {
    safeExtent(rowCount * this.estimate);
    const corrections: { rank: number; height: number; before: number }[] = [];
    for (const [id, height] of measurements) {
      const rank = rankOf(id);
      if (rank === undefined) continue;
      if (!Number.isSafeInteger(rank) || rank < 0 || rank >= rowCount)
        throw new RangeError("Invalid measured rank");
      corrections.push({ rank, height, before: 0 });
    }
    corrections.sort((a, b) => a.rank - b.rank);
    let delta = 0,
      previous = -1;
    for (const entry of corrections) {
      if (entry.rank === previous) throw new Error("Duplicate measured rank");
      previous = entry.rank;
      entry.before = delta;
      delta += entry.height - this.estimate;
    }
    const total = rowCount * this.estimate + delta;
    safeExtent(total);
    return { corrections, total };
  }
  measure(id: string, height: number): void {
    this.measureBatch([{ id, height }]);
  }
  /** One bounded rebuild per publication; callers batch viewport measurements. */
  measureBatch(entries: readonly { id: string; height: number }[]): void {
    const next = new Map(this.measurements);
    for (const { id, height } of entries) {
      finitePositive(height);
      next.delete(id);
      next.set(id, height);
      while (next.size > this.cap) next.delete(next.keys().next().value!);
    }
    const built = this.rebuild(this.rowCount, this.rankOf, next);
    this.measurements = next;
    this.corrections = built.corrections;
    this.total = built.total;
  }
  invalidateMeasurements(): void {
    this.measurements.clear();
    this.corrections = [];
    this.total = this.rowCount * this.estimate;
  }
  private before(index: number): number {
    let lo = 0,
      hi = this.corrections.length;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (this.corrections[mid]!.rank < index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  getHeight(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.rowCount)
      return 0;
    const entry = this.corrections[this.before(index)];
    return entry?.rank === index ? entry.height : this.estimate;
  }
  getOffsetForIndex(index: number): number {
    if (Number.isNaN(index) || index <= 0 || !this.rowCount) return 0;
    if (index >= this.rowCount) return this.total;
    index = Math.floor(index);
    const previous = this.corrections[this.before(index) - 1];
    return (
      index * this.estimate +
      (previous ? previous.before + previous.height - this.estimate : 0)
    );
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
/**
 * Proportional thumb travel, unscaled viewport rows. Wheel/keyboard intent must
 * call moveBy and prevent native scrolling; native thumb scroll calls fromDOM.
 * Programmatic scroll echoes must be ignored by the integrating adapter.
 */
export class RemoteScrollMapping {
  readonly domHeight: number;
  readonly domRange: number;
  readonly logicalRange: number;
  logicalScrollTop = 0;
  constructor(
    readonly totalHeight: number,
    readonly viewportHeight: number,
    ceiling: number,
  ) {
    safeExtent(totalHeight);
    finitePositive(viewportHeight);
    finitePositive(ceiling);
    if (ceiling <= viewportHeight)
      throw new RangeError("Ceiling must exceed viewport");
    this.domHeight = Math.min(totalHeight, ceiling);
    this.domRange = Math.max(0, this.domHeight - viewportHeight);
    this.logicalRange = Math.max(0, totalHeight - viewportHeight);
  }
  get domScrollTop(): number {
    return this.logicalRange
      ? (this.logicalScrollTop / this.logicalRange) * this.domRange
      : 0;
  }
  seek(top: number): void {
    if (Number.isNaN(top)) throw new RangeError("Invalid position");
    this.logicalScrollTop = Math.max(0, Math.min(this.logicalRange, top));
  }
  fromDOM(top: number): void {
    this.seek(this.domRange ? (top / this.domRange) * this.logicalRange : 0);
  }
  moveBy(pixels: number): void {
    this.seek(this.logicalScrollTop + pixels);
  }
  toDOMRowTop(
    logicalTop: number,
    observedDOMScrollTop = this.domScrollTop,
  ): number {
    return observedDOMScrollTop + (logicalTop - this.logicalScrollTop);
  }
  hitTest(viewportY: number): number {
    return this.logicalScrollTop + viewportY;
  }
  reveal(top: number, height: number): void {
    if (top < this.logicalScrollTop) this.seek(top);
    else if (top + height > this.logicalScrollTop + this.viewportHeight)
      this.seek(top + height - this.viewportHeight);
  }
  telemetry(): { scrollTop: number; totalHeight: number } {
    return { scrollTop: this.logicalScrollTop, totalHeight: this.totalHeight };
  }
}
