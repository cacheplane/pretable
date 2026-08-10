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
  identityLookups: number;
  identityComparisons: number;
  measurementEntriesScanned: number;
  previousEntriesScanned: number;
  sortComparisons: number;
}

function createWork(entriesVisited = 0): Work {
  return {
    nodesCreated: 0,
    entriesVisited,
    identityLookups: 0,
    identityComparisons: 0,
    measurementEntriesScanned: 0,
    previousEntriesScanned: 0,
    sortComparisons: 0,
  };
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

interface HashEntry<TValue> {
  readonly key: string;
  readonly value: TValue;
}

interface HashLeaf<TValue> {
  readonly kind: "leaf";
  readonly hash: number;
  readonly entries: readonly HashEntry<TValue>[];
  readonly count: number;
}

interface HashBranch<TValue> {
  readonly kind: "branch";
  readonly bitmap: number;
  readonly children: readonly HashNode<TValue>[];
  readonly count: number;
}

type HashNode<TValue> = HashLeaf<TValue> | HashBranch<TValue>;

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

const DEFAULT_MAX_RETAINED_MEASUREMENTS = 100_000;
const TICKET_KEY_WIDTH = String(Number.MAX_SAFE_INTEGER).length;

/** Direct test seam; intentionally not exported from the layout-core barrel. */
export interface RowHeightIndexDiagnostics {
  /** Persistent sequence, HAMT, and retention-order nodes allocated by the call. */
  readonly nodesCreated: number;
  /** Input rows or operations consumed by the call. */
  readonly entriesVisited: number;
  readonly treeDepth: number;
  /** Explicit persistent-HAMT and ephemeral Map/Set membership operations. */
  readonly identityLookups: number;
  /** Exact encoded-key equality checks inside HAMT collision leaves. */
  readonly identityComparisons: number;
  /** Cached measurement entries materialized by bulk replacement. */
  readonly measurementEntriesScanned: number;
  /** Rows in the prior visible sequence examined by bulk replacement. */
  readonly previousEntriesScanned: number;
  /** Comparator calls from sorting; bulk replacement deliberately performs none. */
  readonly sortComparisons: number;
  readonly visibleMeasurementCount: number;
  readonly tombstoneCount: number;
  readonly measurementCacheCount: number;
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

function forEachSequenceValue<TKey>(
  root: SequenceNode<TKey> | null,
  visit: (value: HeightValue<TKey>) => void,
): void {
  if (root === null) return;
  forEachSequenceValue(root.left, visit);
  visit(root.value);
  forEachSequenceValue(root.right, visit);
}

function hashIdentity(identity: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashCount<TValue>(root: HashNode<TValue> | null): number {
  return root?.count ?? 0;
}

function popCount(value: number): number {
  let remaining = value >>> 0;
  remaining -= (remaining >>> 1) & 0x55555555;
  remaining = (remaining & 0x33333333) + ((remaining >>> 2) & 0x33333333);
  return (((remaining + (remaining >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hashFragment(hash: number, shift: number): number {
  return (hash >>> shift) & 31;
}

function hashBit(fragment: number): number {
  return (1 << fragment) >>> 0;
}

function hashPosition(bitmap: number, bit: number): number {
  return popCount((bitmap & (bit - 1)) >>> 0);
}

function hashLeaf<TValue>(
  hash: number,
  entries: readonly HashEntry<TValue>[],
  work: Work,
): HashLeaf<TValue> {
  work.nodesCreated += 1;
  return { kind: "leaf", hash, entries, count: entries.length };
}

function hashBranch<TValue>(
  bitmap: number,
  children: readonly HashNode<TValue>[],
  work: Work,
): HashBranch<TValue> {
  work.nodesCreated += 1;
  return {
    kind: "branch",
    bitmap: bitmap >>> 0,
    children,
    count: children.reduce((count, child) => count + child.count, 0),
  };
}

function mergeHashLeaves<TValue>(
  left: HashLeaf<TValue>,
  right: HashLeaf<TValue>,
  shift: number,
  work: Work,
): HashNode<TValue> {
  const leftFragment = hashFragment(left.hash, shift);
  const rightFragment = hashFragment(right.hash, shift);
  if (leftFragment === rightFragment) {
    const child = mergeHashLeaves(left, right, shift + 5, work);
    return hashBranch(hashBit(leftFragment), [child], work);
  }
  const leftBit = hashBit(leftFragment);
  const rightBit = hashBit(rightFragment);
  return hashBranch(
    (leftBit | rightBit) >>> 0,
    leftFragment < rightFragment ? [left, right] : [right, left],
    work,
  );
}

function hashGetNode<TValue>(
  root: HashNode<TValue> | null,
  key: string,
  hash: number,
  shift: number,
  work: Work | undefined,
): TValue | undefined {
  if (root === null) return undefined;
  if (root.kind === "leaf") {
    if (root.hash !== hash) return undefined;
    for (const entry of root.entries) {
      if (work !== undefined) work.identityComparisons += 1;
      if (entry.key === key) return entry.value;
    }
    return undefined;
  }
  const bit = hashBit(hashFragment(hash, shift));
  if ((root.bitmap & bit) === 0) return undefined;
  return hashGetNode(
    root.children[hashPosition(root.bitmap, bit)]!,
    key,
    hash,
    shift + 5,
    work,
  );
}

function hashGet<TValue>(
  root: HashNode<TValue> | null,
  key: string,
  work?: Work,
): TValue | undefined {
  if (work !== undefined) work.identityLookups += 1;
  return hashGetNode(root, key, hashIdentity(key), 0, work);
}

function hashSetNode<TValue>(
  root: HashNode<TValue> | null,
  key: string,
  value: TValue,
  hash: number,
  shift: number,
  work: Work,
): HashNode<TValue> {
  if (root === null) return hashLeaf(hash, [{ key, value }], work);
  if (root.kind === "leaf") {
    if (root.hash !== hash) {
      return mergeHashLeaves(
        root,
        hashLeaf(hash, [{ key, value }], work),
        shift,
        work,
      );
    }
    const index = root.entries.findIndex((entry) => {
      work.identityComparisons += 1;
      return entry.key === key;
    });
    if (index < 0) {
      return hashLeaf(hash, [...root.entries, { key, value }], work);
    }
    if (Object.is(root.entries[index]!.value, value)) return root;
    const entries = [...root.entries];
    entries[index] = { key, value };
    return hashLeaf(hash, entries, work);
  }
  const bit = hashBit(hashFragment(hash, shift));
  const position = hashPosition(root.bitmap, bit);
  if ((root.bitmap & bit) === 0) {
    const children = [...root.children];
    children.splice(position, 0, hashLeaf(hash, [{ key, value }], work));
    return hashBranch((root.bitmap | bit) >>> 0, children, work);
  }
  const child = hashSetNode(
    root.children[position]!,
    key,
    value,
    hash,
    shift + 5,
    work,
  );
  if (child === root.children[position]) return root;
  const children = [...root.children];
  children[position] = child;
  return hashBranch(root.bitmap, children, work);
}

function hashSet<TValue>(
  root: HashNode<TValue> | null,
  key: string,
  value: TValue,
  work: Work,
): HashNode<TValue> {
  work.identityLookups += 1;
  return hashSetNode(root, key, value, hashIdentity(key), 0, work);
}

function hashDeleteNode<TValue>(
  root: HashNode<TValue> | null,
  key: string,
  hash: number,
  shift: number,
  work: Work,
): HashNode<TValue> | null {
  if (root === null) return null;
  if (root.kind === "leaf") {
    if (root.hash !== hash) return root;
    const index = root.entries.findIndex((entry) => {
      work.identityComparisons += 1;
      return entry.key === key;
    });
    if (index < 0) return root;
    if (root.entries.length === 1) return null;
    return hashLeaf(
      hash,
      root.entries.filter((_, entryIndex) => entryIndex !== index),
      work,
    );
  }
  const bit = hashBit(hashFragment(hash, shift));
  if ((root.bitmap & bit) === 0) return root;
  const position = hashPosition(root.bitmap, bit);
  const child = hashDeleteNode(
    root.children[position]!,
    key,
    hash,
    shift + 5,
    work,
  );
  if (child === root.children[position]) return root;
  if (child === null) {
    if (root.children.length === 1) return null;
    const children = root.children.filter(
      (_, childIndex) => childIndex !== position,
    );
    if (children.length === 1 && children[0]?.kind === "leaf") {
      return children[0];
    }
    return hashBranch((root.bitmap & ~bit) >>> 0, children, work);
  }
  const children = [...root.children];
  children[position] = child;
  return hashBranch(root.bitmap, children, work);
}

function hashDelete<TValue>(
  root: HashNode<TValue> | null,
  key: string,
  work: Work,
): HashNode<TValue> | null {
  work.identityLookups += 1;
  return hashDeleteNode(root, key, hashIdentity(key), 0, work);
}

function forEachHashEntry<TValue>(
  root: HashNode<TValue> | null,
  visit: (entry: HashEntry<TValue>) => void,
): void {
  if (root === null) return;
  if (root.kind === "leaf") {
    for (const entry of root.entries) visit(entry);
    return;
  }
  for (const child of root.children) forEachHashEntry(child, visit);
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

function minimumMapEntry<TValue>(
  root: KeyMapNode<TValue> | null,
): KeyMapNode<TValue> | undefined {
  let current = root;
  while (current?.left !== null && current?.left !== undefined) {
    current = current.left;
  }
  return current ?? undefined;
}

function forEachMapEntry<TValue>(
  root: KeyMapNode<TValue> | null,
  visit: (key: string, value: TValue) => void,
): void {
  if (root === null) return;
  forEachMapEntry(root.left, visit);
  visit(root.key, root.value);
  forEachMapEntry(root.right, visit);
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

function ticketKey(ticket: number): string {
  return String(ticket).padStart(TICKET_KEY_WIDTH, "0");
}

function takeNextTicket(ticket: number): number {
  if (
    !Number.isSafeInteger(ticket) ||
    ticket < 0 ||
    ticket >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      "Removed-measurement retention ticket space is exhausted.",
    );
  }
  return ticket + 1;
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
  readonly #visibleKeys: HashNode<true> | null;
  readonly #measurements: HashNode<number> | null;
  readonly #tombstones: HashNode<number> | null;
  readonly #tombstoneOrder: KeyMapNode<string> | null;
  readonly #nextTicket: number;
  readonly #maxRetainedMeasurements: number;
  readonly diagnostics: RowHeightIndexDiagnostics;

  constructor(options: {
    readonly defaultHeight: number;
    readonly getKey: (key: TKey) => string | number;
    readonly root: SequenceNode<TKey> | null;
    readonly visibleKeys: HashNode<true> | null;
    readonly measurements: HashNode<number> | null;
    readonly tombstones: HashNode<number> | null;
    readonly tombstoneOrder: KeyMapNode<string> | null;
    readonly nextTicket: number;
    readonly maxRetainedMeasurements: number;
    readonly work: Work;
  }) {
    this.#defaultHeight = options.defaultHeight;
    this.#getKey = options.getKey;
    this.#root = options.root;
    this.#visibleKeys = options.visibleKeys;
    this.#measurements = options.measurements;
    this.#tombstones = options.tombstones;
    this.#tombstoneOrder = options.tombstoneOrder;
    this.#nextTicket = options.nextTicket;
    this.#maxRetainedMeasurements = options.maxRetainedMeasurements;
    this.diagnostics = Object.freeze({
      nodesCreated: options.work.nodesCreated,
      entriesVisited: options.work.entriesVisited,
      treeDepth: nodeHeight(options.root),
      identityLookups: options.work.identityLookups,
      identityComparisons: options.work.identityComparisons,
      measurementEntriesScanned: options.work.measurementEntriesScanned,
      previousEntriesScanned: options.work.previousEntriesScanned,
      sortComparisons: options.work.sortComparisons,
      visibleMeasurementCount:
        hashCount(options.measurements) - hashCount(options.tombstones),
      tombstoneCount: hashCount(options.tombstones),
      measurementCacheCount: hashCount(options.measurements),
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
    return hashGet(this.#measurements, this.#identity(ref)) !== undefined;
  }

  measure(index: number, ref: TKey, height: number): RowHeightIndex<TKey> {
    assertExistingIndex(index, this.rowCount, "Row measurement index");
    const normalized = normalizeHeight(height, "Measured row height");
    const identity = this.#identity(ref);
    const current = sequenceAt(this.#root, index)!;
    this.#assertIdentity(current, identity);
    if (current.measured && current.height === normalized) return this;
    const work = createWork(1);
    const measurements = hashSet(
      this.#measurements,
      identity,
      normalized,
      work,
    );
    const root = updateSequence(
      this.#root!,
      index,
      { ...current, height: normalized, measured: true },
      work,
    );
    return this.#next(
      root,
      this.#visibleKeys,
      measurements,
      this.#tombstones,
      this.#tombstoneOrder,
      this.#nextTicket,
      work,
    );
  }

  apply(operations: readonly RowHeightOperation<TKey>[]): RowHeightIndex<TKey> {
    if (operations.length === 0) return this;
    let root = this.#root;
    let visibleKeys = this.#visibleKeys;
    let measurements = this.#measurements;
    let tombstones = this.#tombstones;
    let tombstoneOrder = this.#tombstoneOrder;
    let nextTicket = this.#nextTicket;
    const work = createWork();

    for (const operation of operations) {
      work.entriesVisited += 1;
      if (operation.kind === "insert") {
        assertInsertIndex(operation.index, nodeCount(root));
        const identity = this.#identity(operation.ref);
        if (hashGet(visibleKeys, identity, work) !== undefined) {
          throw new Error(`Duplicate stable row-height key: ${identity}`);
        }
        const estimatedHeight = this.#estimated(operation.estimatedHeight);
        const measuredHeight = hashGet(measurements, identity, work);
        const retainedTicket = hashGet(tombstones, identity, work);
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
        visibleKeys = hashSet(visibleKeys, identity, true, work);
        if (retainedTicket !== undefined) {
          tombstones = hashDelete(tombstones, identity, work);
          tombstoneOrder = mapDelete(
            tombstoneOrder,
            ticketKey(retainedTicket),
            work,
          );
        }
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
        visibleKeys = hashDelete(visibleKeys, identity, work);
        if (current.measured) {
          if (this.#maxRetainedMeasurements === 0) {
            measurements = hashDelete(measurements, identity, work);
          } else {
            const ticket = nextTicket;
            nextTicket = takeNextTicket(nextTicket);
            tombstones = hashSet(tombstones, identity, ticket, work);
            tombstoneOrder = mapSet(
              tombstoneOrder,
              ticketKey(ticket),
              identity,
              work,
            );
            while (hashCount(tombstones) > this.#maxRetainedMeasurements) {
              const oldest: KeyMapNode<string> | undefined =
                minimumMapEntry(tombstoneOrder);
              if (oldest === undefined) {
                throw new Error(
                  "Removed-measurement retention is inconsistent.",
                );
              }
              tombstoneOrder = mapDelete(tombstoneOrder, oldest.key, work);
              tombstones = hashDelete(tombstones, oldest.value, work);
              measurements = hashDelete(measurements, oldest.value, work);
            }
          }
        }
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
        measurements = hashDelete(measurements, identity, work);
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
      measurements === this.#measurements &&
      tombstones === this.#tombstones &&
      tombstoneOrder === this.#tombstoneOrder &&
      nextTicket === this.#nextTicket
    ) {
      return this;
    }
    return this.#next(
      root,
      visibleKeys,
      measurements,
      tombstones,
      tombstoneOrder,
      nextTicket,
      work,
    );
  }

  replace(rows: readonly RowHeightEntry<TKey>[]): RowHeightIndex<TKey> {
    const work = createWork(rows.length);
    const measurementSnapshot = new Map<string, number>();
    forEachHashEntry(this.#measurements, (entry) => {
      work.measurementEntriesScanned += 1;
      measurementSnapshot.set(entry.key, entry.value);
    });
    const identities = new Set<string>();
    const values = rows.map((row) => {
      const identity = this.#identity(row.key);
      work.identityLookups += 1;
      if (identities.has(identity)) {
        throw new Error(`Duplicate stable row-height key: ${identity}`);
      }
      identities.add(identity);
      const estimatedHeight = this.#estimated(row.estimatedHeight);
      work.identityLookups += 1;
      const measuredHeight = measurementSnapshot.get(identity);
      return {
        ref: row.key,
        identity,
        estimatedHeight: row.estimatedHeight,
        height: measuredHeight ?? estimatedHeight,
        measured: measuredHeight !== undefined,
      } satisfies HeightValue<TKey>;
    });
    if (equalVisibleRows(this.#root, values)) return this;
    let visibleKeys: HashNode<true> | null = null;
    for (const value of values) {
      visibleKeys = hashSet(visibleKeys, value.identity, true, work);
    }

    let measurements = this.#measurements;
    let nextTicket = this.#nextTicket;

    const retainedTombstones: Array<{
      readonly identity: string;
      readonly ticket: number;
    }> = [];
    forEachMapEntry(this.#tombstoneOrder, (key, identity) => {
      work.identityLookups += 1;
      if (!identities.has(identity)) {
        retainedTombstones.push({ identity, ticket: Number(key) });
      }
    });

    forEachSequenceValue(this.#root, (value) => {
      work.previousEntriesScanned += 1;
      if (!value.measured) return;
      work.identityLookups += 1;
      if (identities.has(value.identity)) return;
      if (this.#maxRetainedMeasurements === 0) {
        measurements = hashDelete(measurements, value.identity, work);
        return;
      }
      const ticket = nextTicket;
      nextTicket = takeNextTicket(nextTicket);
      retainedTombstones.push({ identity: value.identity, ticket });
    });

    const evictedCount = Math.max(
      0,
      retainedTombstones.length - this.#maxRetainedMeasurements,
    );
    for (let index = 0; index < evictedCount; index += 1) {
      measurements = hashDelete(
        measurements,
        retainedTombstones[index]!.identity,
        work,
      );
    }
    const keptTombstones = retainedTombstones.slice(evictedCount);
    let tombstones: HashNode<number> | null = null;
    const orderEntries: Array<readonly [string, string]> = [];
    for (const retained of keptTombstones) {
      tombstones = hashSet(
        tombstones,
        retained.identity,
        retained.ticket,
        work,
      );
      orderEntries.push([ticketKey(retained.ticket), retained.identity]);
    }
    const tombstoneOrder = buildMap(orderEntries, 0, orderEntries.length, work);

    const root = buildSequence(values, 0, values.length, work);
    return this.#next(
      root,
      visibleKeys,
      measurements,
      tombstones,
      tombstoneOrder,
      nextTicket,
      work,
    );
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
    visibleKeys: HashNode<true> | null,
    measurements: HashNode<number> | null,
    tombstones: HashNode<number> | null,
    tombstoneOrder: KeyMapNode<string> | null,
    nextTicket: number,
    work: Work,
  ): PersistentRowHeightIndex<TKey> {
    return new PersistentRowHeightIndex({
      defaultHeight: this.#defaultHeight,
      getKey: this.#getKey,
      root,
      visibleKeys,
      measurements,
      tombstones,
      tombstoneOrder,
      nextTicket,
      maxRetainedMeasurements: this.#maxRetainedMeasurements,
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
  const maxRetainedMeasurements =
    options.maxRetainedMeasurements ?? DEFAULT_MAX_RETAINED_MEASUREMENTS;
  if (
    !Number.isSafeInteger(maxRetainedMeasurements) ||
    maxRetainedMeasurements < 0
  ) {
    throw new RangeError(
      "maxRetainedMeasurements must be a non-negative safe integer.",
    );
  }
  const empty = new PersistentRowHeightIndex<TKey>({
    defaultHeight,
    getKey: options.getKey,
    root: null,
    visibleKeys: null,
    measurements: null,
    tombstones: null,
    tombstoneOrder: null,
    nextTicket: 0,
    maxRetainedMeasurements,
    work: createWork(),
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
