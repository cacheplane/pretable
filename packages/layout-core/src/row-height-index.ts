import type {
  CreateRowHeightIndexOptions,
  RowHeightAnchor,
  RowHeightEntry,
  RowHeightIndex,
  RowHeightOperation,
  RowHeightReplacementAdvanceOptions,
  RowHeightReplacementBuilder,
  RowHeightReplacementProgress,
  RowHeightReplacementSource,
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
  readonly entry: HashEntry<TValue>;
  readonly count: 1;
}

interface CollisionNode<TValue> {
  readonly entry: HashEntry<TValue>;
  readonly left: CollisionNode<TValue> | null;
  readonly right: CollisionNode<TValue> | null;
  readonly height: number;
  readonly count: number;
}

interface HashCollision<TValue> {
  readonly kind: "collision";
  readonly hash: number;
  readonly root: CollisionNode<TValue>;
  readonly count: number;
}

interface HashBranch<TValue> {
  readonly kind: "branch";
  readonly bitmap: number;
  readonly children: readonly HashNode<TValue>[];
  readonly count: number;
}

type HashTerminal<TValue> = HashLeaf<TValue> | HashCollision<TValue>;
type HashNode<TValue> = HashTerminal<TValue> | HashBranch<TValue>;

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
  /** Cached measurement entries reused while ingesting bulk replacement. */
  readonly measurementEntriesScanned: number;
  /** Rows in the prior visible sequence examined by bulk replacement. */
  readonly previousEntriesScanned: number;
  /** Comparator calls from sorting; bulk replacement deliberately performs none. */
  readonly sortComparisons: number;
  readonly visibleMeasurementCount: number;
  readonly tombstoneCount: number;
  readonly measurementCacheCount: number;
}

type ReplacementLifecycleCode =
  "not-ready" | "cancelled" | "failed" | "finished" | "done";

export class RowHeightReplacementLifecycleError extends Error {
  readonly code: ReplacementLifecycleCode;

  constructor(code: ReplacementLifecycleCode, message: string) {
    super(message);
    this.name = "RowHeightReplacementLifecycleError";
    this.code = code;
  }
}

/** Direct test seam; intentionally not exported from the layout-core barrel. */
export interface RowHeightReplacementBuilderDiagnostics {
  readonly status: "pending" | "done" | "cancelled" | "failed" | "finished";
  readonly phase: RowHeightReplacementProgress["phase"];
  readonly retainedBaseRootCount: number;
  readonly retainedSourceCount: number;
  readonly candidateArrayEntryCount: number;
  readonly candidateStackEntryCount: number;
  readonly candidateRootCount: number;
  readonly identitySetEntryCount: number;
  readonly maxSliceUnits: number;
  readonly maxSliceDuration: number;
  readonly sliceCount: number;
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly phaseUnits: Readonly<
    Record<RowHeightReplacementProgress["phase"], number>
  >;
  readonly nodesCreated: number;
  readonly identityLookups: number;
  readonly identityComparisons: number;
}

interface ReplacementBase<TKey> {
  readonly index: PersistentRowHeightIndex<TKey>;
  readonly defaultHeight: number;
  readonly getKey: (key: TKey) => string | number;
  readonly root: SequenceNode<TKey> | null;
  readonly visibleKeys: HashNode<true> | null;
  readonly measurements: HashNode<number> | null;
  readonly tombstones: HashNode<number> | null;
  readonly tombstoneOrder: KeyMapNode<string> | null;
  readonly nextTicket: number;
  readonly maxRetainedMeasurements: number;
}

interface TraversalFrame<TNode> {
  readonly node: TNode;
  state: 0 | 1 | 2;
}

interface SequenceBuildFrame<TKey> {
  readonly start: number;
  readonly end: number;
  readonly middle: number;
  state: 0 | 1 | 2;
  left: SequenceNode<TKey> | null;
  right: SequenceNode<TKey> | null;
}

interface RetentionBuildFrame {
  readonly start: number;
  readonly end: number;
  readonly middle: number;
  state: 0 | 1 | 2;
  left: KeyMapNode<string> | null;
  right: KeyMapNode<string> | null;
}

interface RetainedMeasurement {
  readonly identity: string;
  readonly ticket: number;
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
  entry: HashEntry<TValue>,
  work: Work,
): HashLeaf<TValue> {
  work.nodesCreated += 1;
  return { kind: "leaf", hash, entry, count: 1 };
}

function collisionCount<TValue>(root: CollisionNode<TValue> | null): number {
  return root?.count ?? 0;
}

function collisionNode<TValue>(
  entry: HashEntry<TValue>,
  left: CollisionNode<TValue> | null,
  right: CollisionNode<TValue> | null,
  work: Work,
): CollisionNode<TValue> {
  work.nodesCreated += 1;
  return {
    entry,
    left,
    right,
    height: 1 + Math.max(nodeHeight(left), nodeHeight(right)),
    count: collisionCount(left) + 1 + collisionCount(right),
  };
}

function rebalanceCollision<TValue>(
  entry: HashEntry<TValue>,
  left: CollisionNode<TValue> | null,
  right: CollisionNode<TValue> | null,
  work: Work,
): CollisionNode<TValue> {
  if (nodeHeight(left) > nodeHeight(right) + 1) {
    const pivot = left!;
    if (nodeHeight(pivot.left) >= nodeHeight(pivot.right)) {
      return collisionNode(
        pivot.entry,
        pivot.left,
        collisionNode(entry, pivot.right, right, work),
        work,
      );
    }
    const middle = pivot.right!;
    return collisionNode(
      middle.entry,
      collisionNode(pivot.entry, pivot.left, middle.left, work),
      collisionNode(entry, middle.right, right, work),
      work,
    );
  }
  if (nodeHeight(right) > nodeHeight(left) + 1) {
    const pivot = right!;
    if (nodeHeight(pivot.right) >= nodeHeight(pivot.left)) {
      return collisionNode(
        pivot.entry,
        collisionNode(entry, left, pivot.left, work),
        pivot.right,
        work,
      );
    }
    const middle = pivot.left!;
    return collisionNode(
      middle.entry,
      collisionNode(entry, left, middle.left, work),
      collisionNode(pivot.entry, middle.right, pivot.right, work),
      work,
    );
  }
  return collisionNode(entry, left, right, work);
}

function compareIdentity(left: string, right: string, work: Work): number {
  work.identityComparisons += 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function collisionGet<TValue>(
  root: CollisionNode<TValue> | null,
  key: string,
  work: Work | undefined,
): TValue | undefined {
  let current = root;
  while (current !== null) {
    const comparison =
      work === undefined
        ? key < current.entry.key
          ? -1
          : key > current.entry.key
            ? 1
            : 0
        : compareIdentity(key, current.entry.key, work);
    if (comparison < 0) current = current.left;
    else if (comparison > 0) current = current.right;
    else return current.entry.value;
  }
  return undefined;
}

function collisionSet<TValue>(
  root: CollisionNode<TValue> | null,
  entry: HashEntry<TValue>,
  work: Work,
): CollisionNode<TValue> {
  if (root === null) return collisionNode(entry, null, null, work);
  const comparison = compareIdentity(entry.key, root.entry.key, work);
  if (comparison < 0) {
    return rebalanceCollision(
      root.entry,
      collisionSet(root.left, entry, work),
      root.right,
      work,
    );
  }
  if (comparison > 0) {
    return rebalanceCollision(
      root.entry,
      root.left,
      collisionSet(root.right, entry, work),
      work,
    );
  }
  if (Object.is(root.entry.value, entry.value)) return root;
  return collisionNode(entry, root.left, root.right, work);
}

function extractCollisionMinimum<TValue>(
  root: CollisionNode<TValue>,
  work: Work,
): {
  readonly root: CollisionNode<TValue> | null;
  readonly minimum: HashEntry<TValue>;
} {
  if (root.left === null) return { root: root.right, minimum: root.entry };
  const extracted = extractCollisionMinimum(root.left, work);
  return {
    minimum: extracted.minimum,
    root: rebalanceCollision(root.entry, extracted.root, root.right, work),
  };
}

function collisionDelete<TValue>(
  root: CollisionNode<TValue> | null,
  key: string,
  work: Work,
): CollisionNode<TValue> | null {
  if (root === null) return null;
  const comparison = compareIdentity(key, root.entry.key, work);
  if (comparison < 0) {
    const left = collisionDelete(root.left, key, work);
    if (left === root.left) return root;
    return rebalanceCollision(root.entry, left, root.right, work);
  }
  if (comparison > 0) {
    const right = collisionDelete(root.right, key, work);
    if (right === root.right) return root;
    return rebalanceCollision(root.entry, root.left, right, work);
  }
  if (root.left === null) return root.right;
  if (root.right === null) return root.left;
  const extracted = extractCollisionMinimum(root.right, work);
  return rebalanceCollision(extracted.minimum, root.left, extracted.root, work);
}

function minimumCollisionEntry<TValue>(
  root: CollisionNode<TValue>,
): HashEntry<TValue> {
  let current = root;
  while (current.left !== null) current = current.left;
  return current.entry;
}

function hashCollision<TValue>(
  hash: number,
  root: CollisionNode<TValue>,
  work: Work,
): HashCollision<TValue> {
  work.nodesCreated += 1;
  return { kind: "collision", hash, root, count: root.count };
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

function mergeHashTerminals<TValue>(
  left: HashTerminal<TValue>,
  right: HashTerminal<TValue>,
  shift: number,
  work: Work,
): HashNode<TValue> {
  const leftFragment = hashFragment(left.hash, shift);
  const rightFragment = hashFragment(right.hash, shift);
  if (leftFragment === rightFragment) {
    const child = mergeHashTerminals(left, right, shift + 5, work);
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
  if (root.kind !== "branch") {
    if (root.hash !== hash) return undefined;
    if (root.kind === "leaf") {
      if (work !== undefined) work.identityComparisons += 1;
      return root.entry.key === key ? root.entry.value : undefined;
    }
    return collisionGet(root.root, key, work);
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
  if (root === null) return hashLeaf(hash, { key, value }, work);
  if (root.kind !== "branch") {
    if (root.hash !== hash) {
      return mergeHashTerminals(
        root,
        hashLeaf(hash, { key, value }, work),
        shift,
        work,
      );
    }
    if (root.kind === "leaf") {
      work.identityComparisons += 1;
      if (root.entry.key === key) {
        return Object.is(root.entry.value, value)
          ? root
          : hashLeaf(hash, { key, value }, work);
      }
      let collisionRoot = collisionSet(null, root.entry, work);
      collisionRoot = collisionSet(collisionRoot, { key, value }, work);
      return hashCollision(hash, collisionRoot, work);
    }
    const collisionRoot = collisionSet(root.root, { key, value }, work);
    return collisionRoot === root.root
      ? root
      : hashCollision(hash, collisionRoot, work);
  }
  const bit = hashBit(hashFragment(hash, shift));
  const position = hashPosition(root.bitmap, bit);
  if ((root.bitmap & bit) === 0) {
    const children = [...root.children];
    children.splice(position, 0, hashLeaf(hash, { key, value }, work));
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
  if (root.kind !== "branch") {
    if (root.hash !== hash) return root;
    if (root.kind === "leaf") {
      work.identityComparisons += 1;
      return root.entry.key === key ? null : root;
    }
    const collisionRoot = collisionDelete(root.root, key, work);
    if (collisionRoot === root.root) return root;
    if (collisionRoot === null) return null;
    if (collisionRoot.count === 1) {
      return hashLeaf(hash, minimumCollisionEntry(collisionRoot), work);
    }
    return hashCollision(hash, collisionRoot, work);
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
    if (children.length === 1 && children[0]?.kind !== "branch") {
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

function minimumMapEntry<TValue>(
  root: KeyMapNode<TValue> | null,
): KeyMapNode<TValue> | undefined {
  let current = root;
  while (current?.left !== null && current?.left !== undefined) {
    current = current.left;
  }
  return current ?? undefined;
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
    const builder = this.beginReplacement({
      rowCount: rows.length,
      entryAt: (index) => rows[index]!,
    });
    while (!builder.done) builder.advance({ maxUnits: 256 });
    return builder.finish();
  }

  beginReplacement(
    source: RowHeightReplacementSource<TKey>,
  ): RowHeightReplacementBuilder<TKey> {
    if (!Number.isSafeInteger(source.rowCount) || source.rowCount < 0) {
      throw new RangeError(
        "Replacement source rowCount must be a non-negative safe integer.",
      );
    }
    if (typeof source.entryAt !== "function") {
      throw new TypeError("Replacement source entryAt must be a function.");
    }
    return new PersistentRowHeightReplacementBuilder({
      base: {
        index: this,
        defaultHeight: this.#defaultHeight,
        getKey: this.#getKey,
        root: this.#root,
        visibleKeys: this.#visibleKeys,
        measurements: this.#measurements,
        tombstones: this.#tombstones,
        tombstoneOrder: this.#tombstoneOrder,
        nextTicket: this.#nextTicket,
        maxRetainedMeasurements: this.#maxRetainedMeasurements,
      },
      source,
    });
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

class PersistentRowHeightReplacementBuilder<
  TKey,
> implements RowHeightReplacementBuilder<TKey> {
  #status: RowHeightReplacementBuilderDiagnostics["status"] = "pending";
  #phase: RowHeightReplacementProgress["phase"] = "ingest";
  #base: ReplacementBase<TKey> | null;
  #source: RowHeightReplacementSource<TKey> | null;
  #values: HeightValue<TKey>[] | null = [];
  #identities: Set<string> | null = new Set();
  #retainedMeasurements: RetainedMeasurement[] | null = [];
  #retainedTraversal: TraversalFrame<KeyMapNode<string>>[] | null = [];
  #visibleTraversal: TraversalFrame<SequenceNode<TKey>>[] | null = [];
  #sequenceBuildStack: SequenceBuildFrame<TKey>[] | null = [];
  #retentionBuildStack: RetentionBuildFrame[] | null = [];
  #visibleKeys: HashNode<true> | null = null;
  #measurements: HashNode<number> | null;
  #tombstones: HashNode<number> | null = null;
  #tombstoneOrder: KeyMapNode<string> | null = null;
  #root: SequenceNode<TKey> | null = null;
  #nextTicket: number;
  #ingestIndex = 0;
  #retainedStart = 0;
  #evictionIndex = 0;
  #tombstoneBuildIndex = 0;
  #completedUnits = 0;
  #lastSliceUnits = 0;
  #sliceCount = 0;
  #maxSliceUnits = 0;
  #maxSliceDuration = 0;
  #noOp = false;
  #equalVisible = true;
  readonly #phaseUnits: Record<RowHeightReplacementProgress["phase"], number> =
    {
      ingest: 0,
      "scan-retained": 0,
      "scan-visible": 0,
      evict: 0,
      "build-tombstones": 0,
      "build-sequence": 0,
      "build-retention-order": 0,
      done: 0,
    };
  readonly #totalUnits: number;
  readonly #work = createWork();

  constructor(options: {
    readonly base: ReplacementBase<TKey>;
    readonly source: RowHeightReplacementSource<TKey>;
  }) {
    this.#base = options.base;
    this.#source = options.source;
    this.#measurements = options.base.measurements;
    this.#nextTicket = options.base.nextTicket;
    this.#totalUnits = Math.min(
      Number.MAX_SAFE_INTEGER,
      options.source.rowCount * 4 +
        nodeCount(options.base.root) * 8 +
        hashCount(options.base.tombstones) * 8 +
        8,
    );
  }

  get done(): boolean {
    return this.#status === "done" || this.#status === "finished";
  }

  get progress(): RowHeightReplacementProgress {
    return Object.freeze({
      phase: this.#phase,
      completedUnits: this.#completedUnits,
      totalUnits: Math.max(this.#totalUnits, this.#completedUnits),
      unitsThisSlice: this.#lastSliceUnits,
      sourceRowsIngested: this.#ingestIndex,
      previousRowsScanned: this.#work.previousEntriesScanned,
      done: this.done,
    });
  }

  get diagnostics(): RowHeightReplacementBuilderDiagnostics {
    const candidateRoots = [
      this.#root,
      this.#visibleKeys,
      this.#measurements,
      this.#tombstones,
      this.#tombstoneOrder,
    ].filter((root) => root !== null).length;
    return Object.freeze({
      status: this.#status,
      phase: this.#phase,
      retainedBaseRootCount: this.#base === null ? 0 : 1,
      retainedSourceCount: this.#source === null ? 0 : 1,
      candidateArrayEntryCount:
        (this.#values?.length ?? 0) + (this.#retainedMeasurements?.length ?? 0),
      candidateStackEntryCount:
        (this.#retainedTraversal?.length ?? 0) +
        (this.#visibleTraversal?.length ?? 0) +
        (this.#sequenceBuildStack?.length ?? 0) +
        (this.#retentionBuildStack?.length ?? 0),
      candidateRootCount: candidateRoots,
      identitySetEntryCount: this.#identities?.size ?? 0,
      maxSliceUnits: this.#maxSliceUnits,
      maxSliceDuration: this.#maxSliceDuration,
      sliceCount: this.#sliceCount,
      completedUnits: this.#completedUnits,
      totalUnits: Math.max(this.#totalUnits, this.#completedUnits),
      phaseUnits: Object.freeze({ ...this.#phaseUnits }),
      nodesCreated: this.#work.nodesCreated,
      identityLookups: this.#work.identityLookups,
      identityComparisons: this.#work.identityComparisons,
    });
  }

  advance(
    options: RowHeightReplacementAdvanceOptions,
  ): RowHeightReplacementProgress {
    this.#assertPending();
    if (!Number.isSafeInteger(options.maxUnits) || options.maxUnits <= 0) {
      throw new RangeError(
        "Replacement maxUnits must be a positive safe integer.",
      );
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new TypeError("Replacement now must be a function.");
    }
    if (options.deadline !== undefined) {
      if (!Number.isFinite(options.deadline)) {
        throw new RangeError("Replacement deadline must be finite.");
      }
      if (options.now === undefined) {
        throw new TypeError(
          "Replacement now is required when deadline is supplied.",
        );
      }
    }
    const maxUnits = Math.min(256, Math.floor(options.maxUnits));
    let units = 0;
    let startedAt: number | undefined;
    let observedAt: number | undefined;

    try {
      if (options.now !== undefined) {
        startedAt = options.now();
        if (!Number.isFinite(startedAt)) {
          throw new RangeError(
            "Replacement clock must return a finite number.",
          );
        }
        observedAt = startedAt;
      }
      while (units < maxUnits && this.#status === "pending") {
        const phase = this.#phase;
        this.#step();
        this.#phaseUnits[phase] += 1;
        units += 1;
        this.#completedUnits += 1;
        if (options.now !== undefined) {
          observedAt = options.now();
          if (!Number.isFinite(observedAt)) {
            throw new RangeError(
              "Replacement clock must return a finite number.",
            );
          }
          if (
            options.deadline !== undefined &&
            observedAt >= options.deadline
          ) {
            break;
          }
        }
      }
    } catch (error) {
      this.#status = "failed";
      this.#release();
      throw error;
    }

    this.#lastSliceUnits = units;
    this.#sliceCount += 1;
    this.#maxSliceUnits = Math.max(this.#maxSliceUnits, units);
    if (startedAt !== undefined && observedAt !== undefined) {
      this.#maxSliceDuration = Math.max(
        this.#maxSliceDuration,
        Math.max(0, observedAt - startedAt),
      );
    }
    return this.progress;
  }

  finish(): RowHeightIndex<TKey> {
    if (this.#status !== "done") {
      if (this.#status === "pending") {
        throw new RowHeightReplacementLifecycleError(
          "not-ready",
          "Replacement is not complete.",
        );
      }
      throw this.#lifecycleError(this.#status);
    }
    const base = this.#base!;
    const result = this.#noOp
      ? base.index
      : new PersistentRowHeightIndex({
          defaultHeight: base.defaultHeight,
          getKey: base.getKey,
          root: this.#root,
          visibleKeys: this.#visibleKeys,
          measurements: this.#measurements,
          tombstones: this.#tombstones,
          tombstoneOrder: this.#tombstoneOrder,
          nextTicket: this.#nextTicket,
          maxRetainedMeasurements: base.maxRetainedMeasurements,
          work: this.#work,
        });
    this.#status = "finished";
    this.#release();
    return result;
  }

  cancel(): void {
    if (this.#status === "cancelled") return;
    if (this.#status === "pending" || this.#status === "done") {
      this.#status = "cancelled";
      this.#release();
    }
  }

  #assertPending(): void {
    if (this.#status === "pending") return;
    throw this.#lifecycleError(this.#status);
  }

  #lifecycleError(
    status: RowHeightReplacementBuilderDiagnostics["status"],
  ): RowHeightReplacementLifecycleError {
    const code: ReplacementLifecycleCode =
      status === "pending" ? "not-ready" : status;
    return new RowHeightReplacementLifecycleError(
      code,
      `Replacement builder is ${status}.`,
    );
  }

  #step(): void {
    switch (this.#phase) {
      case "ingest":
        this.#stepIngest();
        return;
      case "scan-retained":
        this.#stepRetainedTraversal();
        return;
      case "scan-visible":
        this.#stepVisibleTraversal();
        return;
      case "evict":
        this.#stepEviction();
        return;
      case "build-tombstones":
        this.#stepTombstoneBuild();
        return;
      case "build-sequence":
        this.#stepSequenceBuild();
        return;
      case "build-retention-order":
        this.#stepRetentionBuild();
        return;
      case "done":
        throw new RowHeightReplacementLifecycleError(
          "done",
          "Replacement builder is done.",
        );
    }
  }

  #stepIngest(): void {
    const source = this.#source!;
    const base = this.#base!;
    const values = this.#values!;
    const identities = this.#identities!;
    if (this.#ingestIndex < source.rowCount) {
      const row = source.entryAt(this.#ingestIndex);
      const identity = encodeStableKey(base.getKey(row.key));
      this.#work.entriesVisited += 1;
      this.#work.identityLookups += 1;
      if (identities.has(identity)) {
        throw new Error(`Duplicate stable row-height key: ${identity}`);
      }
      identities.add(identity);
      const estimatedHeight =
        row.estimatedHeight === undefined
          ? base.defaultHeight
          : normalizeHeight(row.estimatedHeight, "Estimated row height");
      const measuredHeight = hashGet(this.#measurements, identity, this.#work);
      if (measuredHeight !== undefined) {
        this.#work.measurementEntriesScanned += 1;
      }
      this.#visibleKeys = hashSet(
        this.#visibleKeys,
        identity,
        true,
        this.#work,
      );
      values.push({
        ref: row.key,
        identity,
        estimatedHeight: row.estimatedHeight,
        height: measuredHeight ?? estimatedHeight,
        measured: measuredHeight !== undefined,
      });
      this.#ingestIndex += 1;
      return;
    }

    this.#source = null;
    this.#phase = "scan-retained";
    if (base.tombstoneOrder !== null) {
      this.#retainedTraversal!.push({
        node: base.tombstoneOrder,
        state: 0,
      });
    }
  }

  #stepRetainedTraversal(): void {
    const stack = this.#retainedTraversal!;
    const frame = stack.at(-1);
    if (frame === undefined) {
      this.#phase = "scan-visible";
      const root = this.#base!.root;
      if (root !== null) this.#visibleTraversal!.push({ node: root, state: 0 });
      return;
    }
    if (frame.state === 0) {
      frame.state = 1;
      if (frame.node.left !== null) {
        stack.push({ node: frame.node.left, state: 0 });
      }
      return;
    }
    if (frame.state === 1) {
      frame.state = 2;
      this.#work.identityLookups += 1;
      if (!this.#identities!.has(frame.node.value)) {
        this.#retainedMeasurements!.push({
          identity: frame.node.value,
          ticket: Number(frame.node.key),
        });
      }
      return;
    }
    stack.pop();
    if (frame.node.right !== null) {
      stack.push({ node: frame.node.right, state: 0 });
    }
  }

  #stepVisibleTraversal(): void {
    const stack = this.#visibleTraversal!;
    const frame = stack.at(-1);
    if (frame === undefined) {
      if (
        this.#equalVisible &&
        this.#work.previousEntriesScanned === this.#values!.length
      ) {
        this.#noOp = true;
        this.#phase = "done";
        this.#status = "done";
        return;
      }
      this.#phase = "evict";
      this.#retainedStart = Math.max(
        0,
        this.#retainedMeasurements!.length -
          this.#base!.maxRetainedMeasurements,
      );
      return;
    }
    if (frame.state === 0) {
      frame.state = 1;
      if (frame.node.left !== null) {
        stack.push({ node: frame.node.left, state: 0 });
      }
      return;
    }
    if (frame.state === 1) {
      frame.state = 2;
      const value = frame.node.value;
      const candidate = this.#values![this.#work.previousEntriesScanned];
      if (
        candidate === undefined ||
        candidate.identity !== value.identity ||
        candidate.estimatedHeight !== value.estimatedHeight
      ) {
        this.#equalVisible = false;
      }
      this.#work.previousEntriesScanned += 1;
      if (value.measured) {
        this.#work.identityLookups += 1;
        if (!this.#identities!.has(value.identity)) {
          if (this.#base!.maxRetainedMeasurements === 0) {
            this.#measurements = hashDelete(
              this.#measurements,
              value.identity,
              this.#work,
            );
          } else {
            const ticket = this.#nextTicket;
            this.#nextTicket = takeNextTicket(this.#nextTicket);
            this.#retainedMeasurements!.push({
              identity: value.identity,
              ticket,
            });
          }
        }
      }
      return;
    }
    stack.pop();
    if (frame.node.right !== null) {
      stack.push({ node: frame.node.right, state: 0 });
    }
  }

  #stepEviction(): void {
    if (this.#evictionIndex < this.#retainedStart) {
      const evicted = this.#retainedMeasurements![this.#evictionIndex]!;
      this.#measurements = hashDelete(
        this.#measurements,
        evicted.identity,
        this.#work,
      );
      this.#evictionIndex += 1;
      return;
    }
    this.#phase = "build-tombstones";
    this.#tombstoneBuildIndex = this.#retainedStart;
  }

  #stepTombstoneBuild(): void {
    const retained = this.#retainedMeasurements!;
    if (this.#tombstoneBuildIndex < retained.length) {
      const value = retained[this.#tombstoneBuildIndex]!;
      this.#tombstones = hashSet(
        this.#tombstones,
        value.identity,
        value.ticket,
        this.#work,
      );
      this.#tombstoneBuildIndex += 1;
      return;
    }
    this.#phase = "build-sequence";
    if (this.#values!.length > 0) {
      this.#sequenceBuildStack!.push(
        this.#newSequenceBuildFrame(0, this.#values!.length),
      );
    }
  }

  #stepSequenceBuild(): void {
    const stack = this.#sequenceBuildStack!;
    const frame = stack.at(-1);
    if (frame === undefined) {
      this.#phase = "build-retention-order";
      if (this.#retainedStart < this.#retainedMeasurements!.length) {
        this.#retentionBuildStack!.push(
          this.#newRetentionBuildFrame(
            this.#retainedStart,
            this.#retainedMeasurements!.length,
          ),
        );
      }
      return;
    }
    if (frame.state === 0) {
      frame.state = 1;
      if (frame.start < frame.middle) {
        stack.push(this.#newSequenceBuildFrame(frame.start, frame.middle));
      }
      return;
    }
    if (frame.state === 1) {
      frame.state = 2;
      if (frame.middle + 1 < frame.end) {
        stack.push(this.#newSequenceBuildFrame(frame.middle + 1, frame.end));
      }
      return;
    }
    const node = sequenceNode(
      this.#values![frame.middle]!,
      frame.left,
      frame.right,
      this.#work,
    );
    stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) this.#root = node;
    else if (parent.state === 1) parent.left = node;
    else parent.right = node;
  }

  #stepRetentionBuild(): void {
    const stack = this.#retentionBuildStack!;
    const frame = stack.at(-1);
    if (frame === undefined) {
      this.#phase = "done";
      this.#status = "done";
      return;
    }
    if (frame.state === 0) {
      frame.state = 1;
      if (frame.start < frame.middle) {
        stack.push(this.#newRetentionBuildFrame(frame.start, frame.middle));
      }
      return;
    }
    if (frame.state === 1) {
      frame.state = 2;
      if (frame.middle + 1 < frame.end) {
        stack.push(this.#newRetentionBuildFrame(frame.middle + 1, frame.end));
      }
      return;
    }
    const retained = this.#retainedMeasurements![frame.middle]!;
    const node = mapNode(
      ticketKey(retained.ticket),
      retained.identity,
      frame.left,
      frame.right,
      this.#work,
    );
    stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) this.#tombstoneOrder = node;
    else if (parent.state === 1) parent.left = node;
    else parent.right = node;
  }

  #newSequenceBuildFrame(start: number, end: number): SequenceBuildFrame<TKey> {
    return {
      start,
      end,
      middle: Math.floor((start + end) / 2),
      state: 0,
      left: null,
      right: null,
    };
  }

  #newRetentionBuildFrame(start: number, end: number): RetentionBuildFrame {
    return {
      start,
      end,
      middle: Math.floor((start + end) / 2),
      state: 0,
      left: null,
      right: null,
    };
  }

  #release(): void {
    this.#base = null;
    this.#source = null;
    this.#values = null;
    this.#identities = null;
    this.#retainedMeasurements = null;
    this.#retainedTraversal = null;
    this.#visibleTraversal = null;
    this.#sequenceBuildStack = null;
    this.#retentionBuildStack = null;
    this.#visibleKeys = null;
    this.#measurements = null;
    this.#tombstones = null;
    this.#tombstoneOrder = null;
    this.#root = null;
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

/** Direct test seam; intentionally not exported from the layout-core barrel. */
export function getRowHeightReplacementBuilderDiagnosticsForTesting(
  builder: unknown,
): RowHeightReplacementBuilderDiagnostics {
  if (!(builder instanceof PersistentRowHeightReplacementBuilder)) {
    throw new TypeError(
      "Diagnostics require a persistent row-height replacement builder.",
    );
  }
  return builder.diagnostics;
}
