import type { RowMetricsIndex } from "./types";

export function createRowMetricsIndex(
  estimatedHeights: readonly number[],
): RowMetricsIndex {
  return new PrefixSumsRowMetricsIndex(estimatedHeights);
}

class PrefixSumsRowMetricsIndex implements RowMetricsIndex {
  readonly rowCount: number;
  readonly #heights: number[];
  readonly #starts: number[];
  #totalHeight: number;

  constructor(estimatedHeights: readonly number[]) {
    this.rowCount = estimatedHeights.length;
    this.#heights = estimatedHeights.map((height) => normalizeHeight(height));
    this.#starts = [0];

    for (const height of this.#heights) {
      this.#starts.push((this.#starts.at(-1) ?? 0) + height);
    }

    this.#totalHeight = this.#starts.at(-1) ?? 0;
  }

  getHeight(index: number): number {
    return this.#heights[index] ?? 0;
  }

  getOffsetForIndex(index: number): number {
    if (index <= 0) {
      return 0;
    }

    if (index >= this.rowCount) {
      return this.#totalHeight;
    }

    return this.#starts[index] ?? this.#totalHeight;
  }

  getIndexForOffset(offset: number): number {
    if (this.rowCount === 0 || offset <= 0) {
      return 0;
    }

    if (offset >= this.#totalHeight) {
      return this.rowCount;
    }

    let low = 0;
    let high = this.rowCount - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const start = this.#starts[middle] ?? 0;
      const end = this.#starts[middle + 1] ?? this.#totalHeight;

      if (offset < start) {
        high = middle - 1;
        continue;
      }

      if (offset >= end) {
        low = middle + 1;
        continue;
      }

      return middle;
    }

    return Math.min(this.rowCount, low);
  }

  getTotalHeight(): number {
    return this.#totalHeight;
  }

  updateHeight(index: number, height: number): void {
    const nextHeight = normalizeHeight(height);
    const previousHeight = this.#heights[index];

    if (previousHeight === undefined) {
      throw new RangeError(`Row index ${index} is out of bounds.`);
    }

    const delta = nextHeight - previousHeight;

    if (delta === 0) {
      return;
    }

    this.#heights[index] = nextHeight;

    for (let startIndex = index + 1; startIndex < this.#starts.length; startIndex += 1) {
      this.#starts[startIndex] = (this.#starts[startIndex] ?? 0) + delta;
    }

    this.#totalHeight += delta;
  }
}

function normalizeHeight(height: number): number {
  return Math.max(1, Math.round(height));
}
