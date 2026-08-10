import type {
  CreateRowHeightIndexOptions,
  RowHeightAnchor,
  RowHeightEntry,
  RowHeightIndex,
  RowHeightOperation,
} from "./types";

interface Work {
  nodesCreated: number;
  entriesVisited: number;
}

interface HeightValue<TKey> {
  readonly ref: TKey;
  readonly identity: string;
  readonly estimatedHeight: number | undefined;
  readonly height: number;
  readonly measured: boolean;
}

interface SequenceNode<TKey> {
  readonly value: HeightValue<TKey>;
  readonly left: SequenceNode<TKey> | null;
  readonly right: SequenceNode<TKey> | null;
  readonly height: number;
  readonly count: number;
  readonly pixels: number;
}

interface KeyMapNode<TValue> {
  readonly key: string;
  readonly value: TValue;
  readonly left: KeyMapNode<TValue> | null;
  readonly right: KeyMapNode<TValue> | null;
  readonly height: number;
}

interface RemovedSequenceValue<TKey> {
  readonly root: SequenceNode<TKey> | null;
  readonly value: HeightValue<TKey>;
}

interface ExtractedSequenceMinimum<TKey> {
  readonly root: SequenceNode<TKey> | null;
  readonly minimum: HeightValue<TKey>;
}

interface ExtractedMapMinimum<TValue> {
  readonly root: KeyMapNode<TValue> | null;
  readonly minimum: KeyMapNode<TValue>;
}

/** Direct test seam; intentionally not exported from the layout-core barrel. */
export interface RowHeightIndexDiagnostics {
  readonly nodesCreated: number;
  readonly entriesVisited: number;
  readonly treeDepth: number;
}

function nodeHeight(node: { readonly height: number } | null): number {
  return node?.height ?? 0;
}

function nodeCount<TKey>(node: SequenceNode<TKey> | null): number {
  return node?.count ?? 0;
}

function nodePixels<TKey>(node: SequenceNode<TKey> | null): number {
  return node?.pixels ?? 0;
}

function sequenceNode<TKey>(
  value: HeightValue<TKey>,
  left: SequenceNode<TKey> | null,
  right: SequenceNode<TKey> | null,
  work: Work,
): SequenceNode<TKey> {
  work.nodesCreated += 1;
  return {
    value,
    left,
    right,
    height: 1 + Math.max(nodeHeight(left), nodeHeight(right)),
    count: nodeCount(left) + 1 + nodeCount(right),
    pixels: nodePixels(left) + value.height + nodePixels(right),
  };
}

function rebalanceSequence<TKey>(
  value: HeightValue<TKey>,
  left: SequenceNode<TKey> | null,
  right: SequenceNode<TKey> | null,
  work: Work,
): SequenceNode<TKey> {
  if (nodeHeight(left) > nodeHeight(right) + 1) {
    const pivot = left!;
    if (nodeHeight(pivot.left) >= nodeHeight(pivot.right)) {
      return sequenceNode(
        pivot.value,
        pivot.left,
        sequenceNode(value, pivot.right, right, work),
        work,
      );
    }
    const middle = pivot.right!;
    return sequenceNode(
      middle.value,
      sequenceNode(pivot.value, pivot.left, middle.left, work),
      sequenceNode(value, middle.right, right, work),
      work,
    );
  }
  if (nodeHeight(right) > nodeHeight(left) + 1) {
    const pivot = right!;
    if (nodeHeight(pivot.right) >= nodeHeight(pivot.left)) {
      return sequenceNode(
        pivot.value,
        sequenceNode(value, left, pivot.left, work),
        pivot.right,
        work,
      );
    }
    const middle = pivot.left!;
    return sequenceNode(
      middle.value,
      sequenceNode(value, left, middle.left, work),
      sequenceNode(pivot.value, middle.right, pivot.right, work),
      work,
    );
  }
  return sequenceNode(value, left, right, work);
}

function insertSequence<TKey>(
  root: SequenceNode<TKey> | null,
  index: number,
  value: HeightValue<TKey>,
  work: Work,
): SequenceNode<TKey> {
  if (root === null) return sequenceNode(value, null, null, work);
  const leftCount = nodeCount(root.left);
  if (index <= leftCount) {
    return rebalanceSequence(
      root.value,
      insertSequence(root.left, index, value, work),
      root.right,
      work,
    );
  }
  return rebalanceSequence(
    root.value,
    root.left,
    insertSequence(root.right, index - leftCount - 1, value, work),
    work,
  );
}

function extractSequenceMinimum<TKey>(
  root: SequenceNode<TKey>,
  work: Work,
): ExtractedSequenceMinimum<TKey> {
  if (root.left === null) return { root: root.right, minimum: root.value };
  const extracted = extractSequenceMinimum(root.left, work);
  return {
    minimum: extracted.minimum,
    root: rebalanceSequence(root.value, extracted.root, root.right, work),
  };
}

function removeSequence<TKey>(
  root: SequenceNode<TKey>,
  index: number,
  work: Work,
): RemovedSequenceValue<TKey> {
  const leftCount = nodeCount(root.left);
  if (index < leftCount) {
    const removed = removeSequence(root.left!, index, work);
    return {
      value: removed.value,
      root: rebalanceSequence(root.value, removed.root, root.right, work),
    };
  }
  if (index > leftCount) {
    const removed = removeSequence(root.right!, index - leftCount - 1, work);
    return {
      value: removed.value,
      root: rebalanceSequence(root.value, root.left, removed.root, work),
    };
  }
  if (root.left === null) return { root: root.right, value: root.value };
  if (root.right === null) return { root: root.left, value: root.value };
  const extracted = extractSequenceMinimum(root.right, work);
  return {
    value: root.value,
    root: rebalanceSequence(extracted.minimum, root.left, extracted.root, work),
  };
}

function updateSequence<TKey>(
  root: SequenceNode<TKey>,
  index: number,
  value: HeightValue<TKey>,
  work: Work,
): SequenceNode<TKey> {
  const leftCount = nodeCount(root.left);
  if (index < leftCount) {
    return rebalanceSequence(
      root.value,
      updateSequence(root.left!, index, value, work),
      root.right,
      work,
    );
  }
  if (index > leftCount) {
    return rebalanceSequence(
      root.value,
      root.left,
      updateSequence(root.right!, index - leftCount - 1, value, work),
      work,
    );
  }
  return sequenceNode(value, root.left, root.right, work);
}

function sequenceAt<TKey>(
  root: SequenceNode<TKey> | null,
  index: number,
): HeightValue<TKey> | undefined {
  let current = root;
  let rank = index;
  while (current !== null) {
    const leftCount = nodeCount(current.left);
    if (rank < leftCount) current = current.left;
    else if (rank > leftCount) {
      rank -= leftCount + 1;
      current = current.right;
    } else return current.value;
  }
  return undefined;
}

function buildSequence<TKey>(
  values: readonly HeightValue<TKey>[],
  start: number,
  end: number,
  work: Work,
): SequenceNode<TKey> | null {
  if (start >= end) return null;
  const middle = Math.floor((start + end) / 2);
  return sequenceNode(
    values[middle]!,
    buildSequence(values, start, middle, work),
    buildSequence(values, middle + 1, end, work),
    work,
  );
}

function mapNode<TValue>(
  key: string,
  value: TValue,
  left: KeyMapNode<TValue> | null,
  right: KeyMapNode<TValue> | null,
  work: Work,
): KeyMapNode<TValue> {
  work.nodesCreated += 1;
  return {
    key,
    value,
    left,
    right,
    height: 1 + Math.max(nodeHeight(left), nodeHeight(right)),
  };
}

function rebalanceMap<TValue>(
  key: string,
  value: TValue,
  left: KeyMapNode<TValue> | null,
  right: KeyMapNode<TValue> | null,
  work: Work,
): KeyMapNode<TValue> {
  if (nodeHeight(left) > nodeHeight(right) + 1) {
    const pivot = left!;
    if (nodeHeight(pivot.left) >= nodeHeight(pivot.right)) {
      return mapNode(
        pivot.key,
        pivot.value,
        pivot.left,
        mapNode(key, value, pivot.right, right, work),
        work,
      );
    }
    const middle = pivot.right!;
    return mapNode(
      middle.key,
      middle.value,
      mapNode(pivot.key, pivot.value, pivot.left, middle.left, work),
      mapNode(key, value, middle.right, right, work),
      work,
    );
  }
  if (nodeHeight(right) > nodeHeight(left) + 1) {
    const pivot = right!;
    if (nodeHeight(pivot.right) >= nodeHeight(pivot.left)) {
      return mapNode(
        pivot.key,
        pivot.value,
        mapNode(key, value, left, pivot.left, work),
        pivot.right,
        work,
      );
    }
    const middle = pivot.left!;
    return mapNode(
      middle.key,
      middle.value,
      mapNode(key, value, left, middle.left, work),
      mapNode(pivot.key, pivot.value, middle.right, pivot.right, work),
      work,
    );
  }
  return mapNode(key, value, left, right, work);
}

function mapGet<TValue>(
  root: KeyMapNode<TValue> | null,
  key: string,
): TValue | undefined {
  let current = root;
  while (current !== null) {
    if (key < current.key) current = current.left;
    else if (key > current.key) current = current.right;
    else return current.value;
  }
  return undefined;
}

function mapSet<TValue>(
  root: KeyMapNode<TValue> | null,
  key: string,
  value: TValue,
  work: Work,
): KeyMapNode<TValue> {
  if (root === null) return mapNode(key, value, null, null, work);
  if (key < root.key) {
    return rebalanceMap(
      root.key,
      root.value,
      mapSet(root.left, key, value, work),
      root.right,
      work,
    );
  }
  if (key > root.key) {
    return rebalanceMap(
      root.key,
      root.value,
      root.left,
      mapSet(root.right, key, value, work),
      work,
    );
  }
  if (Object.is(root.value, value)) return root;
  return mapNode(key, value, root.left, root.right, work);
}

function extractMapMinimum<TValue>(
  root: KeyMapNode<TValue>,
  work: Work,
): ExtractedMapMinimum<TValue> {
  if (root.left === null) return { root: root.right, minimum: root };
  const extracted = extractMapMinimum(root.left, work);
  return {
    minimum: extracted.minimum,
    root: rebalanceMap(root.key, root.value, extracted.root, root.right, work),
  };
}

function mapDelete<TValue>(
  root: KeyMapNode<TValue> | null,
  key: string,
  work: Work,
): KeyMapNode<TValue> | null {
  if (root === null) return null;
  if (key < root.key) {
    const left = mapDelete(root.left, key, work);
    if (left === root.left) return root;
    return rebalanceMap(root.key, root.value, left, root.right, work);
  }
  if (key > root.key) {
    const right = mapDelete(root.right, key, work);
    if (right === root.right) return root;
    return rebalanceMap(root.key, root.value, root.left, right, work);
  }
  if (root.left === null) return root.right;
  if (root.right === null) return root.left;
  const extracted = extractMapMinimum(root.right, work);
  return rebalanceMap(
    extracted.minimum.key,
    extracted.minimum.value,
    root.left,
    extracted.root,
    work,
  );
}

function buildMap<TValue>(
  entries: readonly (readonly [string, TValue])[],
  start: number,
  end: number,
  work: Work,
): KeyMapNode<TValue> | null {
  if (start >= end) return null;
  const middle = Math.floor((start + end) / 2);
  const [key, value] = entries[middle]!;
  return mapNode(
    key,
    value,
    buildMap(entries, start, middle, work),
    buildMap(entries, middle + 1, end, work),
    work,
  );
}

function normalizeHeight(height: number, label: string): number {
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
  return height;
}

function encodeStableKey(key: string | number): string {
  if (typeof key === "string") return `s:${key.length}:${key}`;
  if (typeof key !== "number") {
    throw new TypeError("A row-height stable key must be a string or number.");
  }
  if (Number.isNaN(key)) return "n:NaN";
  if (key === 0) return "n:0";
  return `n:${String(key)}`;
}

function assertExistingIndex(
  index: number,
  count: number,
  label: string,
): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${label} ${index} is out of bounds.`);
  }
}

function assertInsertIndex(index: number, count: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > count) {
    throw new RangeError(`Row insertion index ${index} is out of bounds.`);
  }
}

function equalVisibleRows<TKey>(
  root: SequenceNode<TKey> | null,
  rows: readonly HeightValue<TKey>[],
): boolean {
  let index = 0;
  const visit = (node: SequenceNode<TKey> | null): boolean => {
    if (node === null) return true;
    if (!visit(node.left)) return false;
    const row = rows[index++];
    if (
      row === undefined ||
      row.identity !== node.value.identity ||
      row.estimatedHeight !== node.value.estimatedHeight
    ) {
      return false;
    }
    return visit(node.right);
  };
  return visit(root) && index === rows.length;
}

class PersistentRowHeightIndex<TKey> implements RowHeightIndex<TKey> {
  readonly #defaultHeight: number;
  readonly #getKey: (key: TKey) => string | number;
  readonly #root: SequenceNode<TKey> | null;
  readonly #visibleKeys: KeyMapNode<true> | null;
  readonly #measurements: KeyMapNode<number> | null;
  readonly diagnostics: RowHeightIndexDiagnostics;

  constructor(options: {
    readonly defaultHeight: number;
    readonly getKey: (key: TKey) => string | number;
    readonly root: SequenceNode<TKey> | null;
    readonly visibleKeys: KeyMapNode<true> | null;
    readonly measurements: KeyMapNode<number> | null;
    readonly work: Work;
  }) {
    this.#defaultHeight = options.defaultHeight;
    this.#getKey = options.getKey;
    this.#root = options.root;
    this.#visibleKeys = options.visibleKeys;
    this.#measurements = options.measurements;
    this.diagnostics = Object.freeze({
      nodesCreated: options.work.nodesCreated,
      entriesVisited: options.work.entriesVisited,
      treeDepth: nodeHeight(options.root),
    });
  }

  get rowCount(): number {
    return nodeCount(this.#root);
  }

  getHeight(index: number): number {
    if (!Number.isSafeInteger(index)) return 0;
    return sequenceAt(this.#root, index)?.height ?? 0;
  }

  getOffsetForIndex(index: number): number {
    if (Number.isNaN(index) || index <= 0 || this.#root === null) return 0;
    if (index === Number.POSITIVE_INFINITY || index >= this.rowCount) {
      return this.getTotalHeight();
    }
    let target = Math.floor(index);
    let current: SequenceNode<TKey> | null = this.#root;
    let offset = 0;
    while (current !== null) {
      const leftCount = nodeCount(current.left);
      if (target <= leftCount) current = current.left;
      else {
        offset += nodePixels(current.left);
        if (target === leftCount + 1) return offset + current.value.height;
        offset += current.value.height;
        target -= leftCount + 1;
        current = current.right;
      }
    }
    return offset;
  }

  getIndexForOffset(offset: number): number {
    if (Number.isNaN(offset) || offset <= 0 || this.#root === null) return 0;
    if (offset >= this.getTotalHeight()) return this.rowCount;
    let current: SequenceNode<TKey> | null = this.#root;
    let remaining = offset;
    let rank = 0;
    while (current !== null) {
      const leftPixels = nodePixels(current.left);
      if (remaining < leftPixels) {
        current = current.left;
        continue;
      }
      remaining -= leftPixels;
      const leftCount = nodeCount(current.left);
      if (remaining < current.value.height) return rank + leftCount;
      remaining -= current.value.height;
      rank += leftCount + 1;
      current = current.right;
    }
    return rank;
  }

  getTotalHeight(): number {
    return nodePixels(this.#root);
  }

  keyAt(index: number): TKey | undefined {
    if (!Number.isSafeInteger(index)) return undefined;
    return sequenceAt(this.#root, index)?.ref;
  }

  hasMeasurement(ref: TKey): boolean {
    return mapGet(this.#measurements, this.#identity(ref)) !== undefined;
  }

  measure(index: number, ref: TKey, height: number): RowHeightIndex<TKey> {
    assertExistingIndex(index, this.rowCount, "Row measurement index");
    const normalized = normalizeHeight(height, "Measured row height");
    const identity = this.#identity(ref);
    const current = sequenceAt(this.#root, index)!;
    this.#assertIdentity(current, identity);
    if (current.measured && current.height === normalized) return this;
    const work: Work = { nodesCreated: 0, entriesVisited: 1 };
    const measurements = mapSet(this.#measurements, identity, normalized, work);
    const root = updateSequence(
      this.#root!,
      index,
      { ...current, height: normalized, measured: true },
      work,
    );
    return this.#next(root, this.#visibleKeys, measurements, work);
  }

  apply(operations: readonly RowHeightOperation<TKey>[]): RowHeightIndex<TKey> {
    if (operations.length === 0) return this;
    let root = this.#root;
    let visibleKeys = this.#visibleKeys;
    let measurements = this.#measurements;
    const work: Work = { nodesCreated: 0, entriesVisited: 0 };

    for (const operation of operations) {
      work.entriesVisited += 1;
      if (operation.kind === "insert") {
        assertInsertIndex(operation.index, nodeCount(root));
        const identity = this.#identity(operation.ref);
        if (mapGet(visibleKeys, identity) !== undefined) {
          throw new Error(`Duplicate stable row-height key: ${identity}`);
        }
        const estimatedHeight = this.#estimated(operation.estimatedHeight);
        const measuredHeight = mapGet(measurements, identity);
        root = insertSequence(
          root,
          operation.index,
          {
            ref: operation.ref,
            identity,
            estimatedHeight: operation.estimatedHeight,
            height: measuredHeight ?? estimatedHeight,
            measured: measuredHeight !== undefined,
          },
          work,
        );
        visibleKeys = mapSet(visibleKeys, identity, true, work);
        continue;
      }

      const sourceIndex =
        operation.kind === "remove" || operation.kind === "move"
          ? operation.previousIndex
          : operation.index;
      assertExistingIndex(sourceIndex, nodeCount(root), "Row operation index");
      const identity = this.#identity(operation.ref);
      const current = sequenceAt(root, sourceIndex)!;
      this.#assertIdentity(current, identity);

      if (operation.kind === "remove") {
        root = removeSequence(root!, sourceIndex, work).root;
        visibleKeys = mapDelete(visibleKeys, identity, work);
      } else if (operation.kind === "move") {
        assertExistingIndex(
          operation.index,
          nodeCount(root),
          "Row move destination index",
        );
        if (operation.index === operation.previousIndex) continue;
        const removed = removeSequence(root!, operation.previousIndex, work);
        root = insertSequence(
          removed.root,
          operation.index,
          removed.value,
          work,
        );
      } else {
        const estimatedHeight = this.#estimated(operation.estimatedHeight);
        if (
          !current.measured &&
          current.estimatedHeight === operation.estimatedHeight
        ) {
          continue;
        }
        measurements = mapDelete(measurements, identity, work);
        root = updateSequence(
          root!,
          operation.index,
          {
            ...current,
            estimatedHeight: operation.estimatedHeight,
            height: estimatedHeight,
            measured: false,
          },
          work,
        );
      }
    }

    if (
      root === this.#root &&
      visibleKeys === this.#visibleKeys &&
      measurements === this.#measurements
    ) {
      return this;
    }
    return this.#next(root, visibleKeys, measurements, work);
  }

  replace(rows: readonly RowHeightEntry<TKey>[]): RowHeightIndex<TKey> {
    const work: Work = { nodesCreated: 0, entriesVisited: rows.length };
    const values = rows.map((row) => {
      const identity = this.#identity(row.key);
      const estimatedHeight = this.#estimated(row.estimatedHeight);
      const measuredHeight = mapGet(this.#measurements, identity);
      return {
        ref: row.key,
        identity,
        estimatedHeight: row.estimatedHeight,
        height: measuredHeight ?? estimatedHeight,
        measured: measuredHeight !== undefined,
      } satisfies HeightValue<TKey>;
    });
    if (equalVisibleRows(this.#root, values)) return this;
    const identities = values
      .map((value) => value.identity)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (let index = 1; index < identities.length; index += 1) {
      if (identities[index - 1] === identities[index]) {
        throw new Error(
          `Duplicate stable row-height key: ${identities[index]}`,
        );
      }
    }
    const visibleKeys = buildMap(
      identities.map((identity) => [identity, true] as const),
      0,
      identities.length,
      work,
    );
    const root = buildSequence(values, 0, values.length, work);
    return this.#next(root, visibleKeys, this.#measurements, work);
  }

  captureAnchor(
    index: number,
    scrollTop: number,
  ): RowHeightAnchor<TKey> | undefined {
    if (!Number.isSafeInteger(index)) return undefined;
    const value = sequenceAt(this.#root, index);
    if (value === undefined) return undefined;
    if (!Number.isFinite(scrollTop)) {
      throw new RangeError("Anchor scrollTop must be finite.");
    }
    return Object.freeze({
      ref: value.ref,
      offset: scrollTop - this.getOffsetForIndex(index),
    });
  }

  restoreAnchor(anchor: RowHeightAnchor<TKey>, index: number): number {
    assertExistingIndex(index, this.rowCount, "Anchor row index");
    if (!Number.isFinite(anchor.offset)) {
      throw new RangeError("Anchor offset must be finite.");
    }
    const value = sequenceAt(this.#root, index)!;
    if (value.identity !== this.#identity(anchor.ref)) {
      throw new Error(
        "The anchor key does not match the row at the new index.",
      );
    }
    return this.getOffsetForIndex(index) + anchor.offset;
  }

  #identity(ref: TKey): string {
    return encodeStableKey(this.#getKey(ref));
  }

  #estimated(height: number | undefined): number {
    return height === undefined
      ? this.#defaultHeight
      : normalizeHeight(height, "Estimated row height");
  }

  #assertIdentity(current: HeightValue<TKey>, identity: string): void {
    if (current.identity !== identity) {
      throw new Error(
        "The row-height operation key does not match the row at its index.",
      );
    }
  }

  #next(
    root: SequenceNode<TKey> | null,
    visibleKeys: KeyMapNode<true> | null,
    measurements: KeyMapNode<number> | null,
    work: Work,
  ): PersistentRowHeightIndex<TKey> {
    return new PersistentRowHeightIndex({
      defaultHeight: this.#defaultHeight,
      getKey: this.#getKey,
      root,
      visibleKeys,
      measurements,
      work,
    });
  }
}

export function createRowHeightIndex<TKey>(
  options: CreateRowHeightIndexOptions<TKey>,
): RowHeightIndex<TKey> {
  const defaultHeight = normalizeHeight(
    options.defaultHeight,
    "Default row height",
  );
  const empty = new PersistentRowHeightIndex<TKey>({
    defaultHeight,
    getKey: options.getKey,
    root: null,
    visibleKeys: null,
    measurements: null,
    work: { nodesCreated: 0, entriesVisited: 0 },
  });
  return options.rows === undefined || options.rows.length === 0
    ? empty
    : empty.replace(options.rows);
}

/** Direct test seam; intentionally not exported from the layout-core barrel. */
export function getRowHeightIndexDiagnosticsForTesting(
  index: RowHeightIndex<unknown>,
): RowHeightIndexDiagnostics {
  if (!(index instanceof PersistentRowHeightIndex)) {
    throw new TypeError("Diagnostics require a persistent row-height index.");
  }
  return index.diagnostics;
}
