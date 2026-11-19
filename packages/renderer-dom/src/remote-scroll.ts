import { finitePositive, safeExtent } from "./remote-dimensions";
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

/** Host event seam. Repaint after every handled intent, even when DOM scrollTop
 * rounds unchanged. Prevent native scrolling only when true is returned. Record
 * the OBSERVED position immediately after a programmatic DOM write. Native thumb
 * events then use fromDOM. Touch momentum, if supplied by the host, uses moveBy;
 * this class does not invent platform inertial physics or consume pinch zoom.
 */
export class RemoteScrollInput {
  private observed: number | undefined;
  private touchY: number | undefined;
  constructor(
    readonly mapping: RemoteScrollMapping,
    private readonly lineHeight: () => number,
  ) {}
  recordDOM(observed: number): void {
    this.observed = observed;
  }
  fromDOM(top: number): boolean {
    if (top === this.observed) return false;
    this.observed = top;
    this.mapping.fromDOM(top);
    return true;
  }
  wheel(event: {
    deltaY: number;
    deltaMode: number;
    ctrlKey?: boolean;
  }): boolean {
    if (event.ctrlKey || !Number.isFinite(event.deltaY)) return false;
    const unit =
      event.deltaMode === 0
        ? 1
        : event.deltaMode === 1
          ? this.lineHeight()
          : event.deltaMode === 2
            ? this.mapping.viewportHeight
            : undefined;
    if (unit === undefined || !Number.isFinite(unit) || unit <= 0) return false;
    this.mapping.moveBy(event.deltaY * unit);
    return true;
  }
  key(key: string): boolean {
    if (key === "Home") this.mapping.seek(0);
    else if (key === "End") this.mapping.seek(Infinity);
    else if (key === "PageDown")
      this.mapping.moveBy(this.mapping.viewportHeight);
    else if (key === "PageUp")
      this.mapping.moveBy(-this.mapping.viewportHeight);
    else if (key === "ArrowDown") this.mapping.moveBy(this.lineHeight());
    else if (key === "ArrowUp") this.mapping.moveBy(-this.lineHeight());
    else return false;
    return true;
  }
  touchStart(y: number): void {
    this.touchY = Number.isFinite(y) ? y : undefined;
  }
  touchMove(y: number): boolean {
    if (this.touchY === undefined || !Number.isFinite(y)) return false;
    this.mapping.moveBy(this.touchY - y);
    this.touchY = y;
    return true;
  }
  touchEnd(): void {
    this.touchY = undefined;
  }
}
