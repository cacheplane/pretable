import { createPersistentMap, type PersistentMap } from "./persistent-map";
import { instrumentPersistentMap } from "./persistent-map";
import type { TransientMap } from "./transient";
import type { LocalRowModelInstrumentation } from "../diagnostics";

const attachInstrumentation = Symbol("attachOrderInstrumentation");
const createDeferredMeasureDraft = Symbol("createDeferredMeasureDraft");
const buildFromSortedEntries = Symbol("buildFromSortedEntries");

export type OrderStatisticTreeId = string | number;

/**
 * Defines an immutable cached measure over entries in comparator order.
 * `empty` must be a two-sided identity, `combine` must be associative, and
 * both callbacks must be pure and stable for the lifetime of the tree.
 */
export interface OrderStatisticTreeMeasure<TEntry, TMeasure> {
  readonly empty: TMeasure;
  readonly fromEntry: (entry: TEntry) => TMeasure;
  readonly combine: (left: TMeasure, right: TMeasure) => TMeasure;
}

/**
 * Entries and all fields observed by these callbacks must remain immutable
 * after insertion. `getId` must return a stable ID. `compare` must be a pure,
 * stable strict weak order; equal comparator values are totalized by ID.
 */
export interface OrderStatisticTreeOptions<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> {
  readonly getId: (entry: TEntry) => TId;
  readonly compare: (left: TEntry, right: TEntry) => number;
  readonly measure: OrderStatisticTreeMeasure<TEntry, TMeasure>;
}

/**
 * A derivation of the bulk build's id→entry map from an existing tree's map:
 * delete `removedIds`, set `addedEntries`, keep everything else. k edits on a
 * transient instead of n inserts into a fresh one.
 *
 * PRECONDITION, unverifiable in O(k) and therefore the caller's to hold: every
 * entry that is neither removed nor added must appear in `sorted` as the SAME
 * OBJECT the base tree holds for it. A caller that reallocates surviving
 * entries must not use this — the map would keep the old objects while the
 * tree holds the new ones.
 */
export interface BulkBuildDerivedById<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> {
  readonly base: OrderStatisticTree<TId, TEntry, TMeasure>;
  readonly removedIds: Iterable<TId>;
  readonly addedEntries: readonly TEntry[];
}

/**
 * Package-internal claims a bulk-build caller can offer in place of work the
 * builder would otherwise do. Never reachable from the package index, and
 * never to be offered on the strength of "the input looks sorted" — each
 * field is an unchecked assertion about how the caller built its input.
 */
export interface BulkBuildProof<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> {
  /**
   * Skips the n−1 strict-order verification. Only for callers whose input is
   * strictly increasing under this tree's total order by construction.
   */
  readonly orderIsProven?: boolean;
  /** Derives the id→entry map instead of refilling it. */
  readonly derivedById?: BulkBuildDerivedById<TId, TEntry, TMeasure>;
}

interface OrderStatisticTreeReads<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> {
  readonly size: number;
  readonly measure: TMeasure;
  get(id: TId): TEntry | undefined;
  entryAt(index: number): TEntry | undefined;
  rankOf(id: TId): number | undefined;
  range(start: number, end: number): readonly TEntry[];
  entries(): IterableIterator<TEntry>;
}

export interface OrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> extends OrderStatisticTreeReads<TId, TEntry, TMeasure> {
  /**
   * Inserts or replaces by stable ID. Passing the identical entry reference is
   * a no-op because entries are required to remain immutable after insertion.
   */
  insertOrReplace(entry: TEntry): OrderStatisticTree<TId, TEntry, TMeasure>;
  remove(id: TId): OrderStatisticTree<TId, TEntry, TMeasure>;
  asTransient(): TransientOrderStatisticTree<TId, TEntry, TMeasure>;
}

export interface TransientOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> extends OrderStatisticTreeReads<TId, TEntry, TMeasure> {
  insertOrReplace(entry: TEntry): this;
  remove(id: TId): this;
  freeze(): OrderStatisticTree<TId, TEntry, TMeasure>;
}

export interface DeferredMeasureTransientOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> extends TransientOrderStatisticTree<TId, TEntry, TMeasure> {
  readonly pendingMeasureCount: number;
  /** Recomputes at most one traversal or measure unit. */
  sealMeasureStep(): boolean;
}

interface TreeContext<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  readonly getId: (entry: TEntry) => TId;
  readonly compare: (left: TEntry, right: TEntry) => number;
  readonly measure: OrderStatisticTreeMeasure<TEntry, TMeasure>;
  readonly instrumentation?: LocalRowModelInstrumentation;
}

class TreeEditToken {
  #editable = true;

  assertEditable(): void {
    if (!this.#editable) {
      throw new Error("Cannot mutate a frozen transient order-statistic tree.");
    }
  }

  freeze(): void {
    this.#editable = false;
  }
}

export class PoisonedTransientOrderStatisticTreeError extends Error {
  readonly code = "poisoned-transient-order-statistic-tree" as const;

  constructor(cause: unknown) {
    super(
      "Cannot use a transient order-statistic tree after a callback failure.",
      { cause },
    );
    this.name = "PoisonedTransientOrderStatisticTreeError";
  }
}

interface TreeNode<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  edit: TreeEditToken | null;
  readonly id: TId;
  entry: TEntry;
  ownMeasure: TMeasure;
  measure: TMeasure;
  count: number;
  height: number;
  left: TreeNode<TId, TEntry, TMeasure> | null;
  right: TreeNode<TId, TEntry, TMeasure> | null;
}

interface TreeChange<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  readonly node: TreeNode<TId, TEntry, TMeasure> | null;
  readonly changed: boolean;
}

interface ExtractedMinimum<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  readonly minimum: TreeNode<TId, TEntry, TMeasure>;
  readonly node: TreeNode<TId, TEntry, TMeasure> | null;
}

export interface OrderStatisticTreeNodeDiagnostic<
  TId extends OrderStatisticTreeId,
> {
  readonly id: TId;
  readonly count: number;
  readonly height: number;
  readonly balance: number;
  readonly left: OrderStatisticTreeNodeDiagnostic<TId> | null;
  readonly right: OrderStatisticTreeNodeDiagnostic<TId> | null;
}

export interface OrderStatisticTreeDiagnostics<
  TId extends OrderStatisticTreeId,
> {
  readonly count: number;
  readonly height: number;
  readonly balanced: boolean;
  readonly sharedNodeCount: number;
  readonly root: OrderStatisticTreeNodeDiagnostic<TId> | null;
}

const persistentRoots = new WeakMap<object, object | null>();

function sameId(
  left: OrderStatisticTreeId,
  right: OrderStatisticTreeId,
): boolean {
  return left === right || (left !== left && right !== right);
}

function compareIds(
  left: OrderStatisticTreeId,
  right: OrderStatisticTreeId,
): number {
  if (sameId(left, right)) return 0;
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;

  if (typeof left === "number" && typeof right === "number") {
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left < right ? -1 : 1;
  }

  return (left as string) < (right as string) ? -1 : 1;
}

function compareEntries<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  left: TEntry,
  leftId: TId,
  right: TEntry,
  rightId: TId,
  context: TreeContext<TId, TEntry, TMeasure>,
): number {
  const comparison = context.compare(left, right);
  if (comparison < 0) return -1;
  if (comparison > 0) return 1;
  return compareIds(leftId, rightId);
}

function nodeHeight(node: { readonly height: number } | null): number {
  return node?.height ?? 0;
}

function createNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  entry: TEntry,
  id: TId,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeNode<TId, TEntry, TMeasure> {
  const ownMeasure = context.measure.fromEntry(entry);
  return {
    edit,
    id,
    entry,
    ownMeasure,
    measure: ownMeasure,
    count: 1,
    height: 1,
    left: null,
    right: null,
  };
}

function editableNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
  instrumentation: LocalRowModelInstrumentation | undefined,
): TreeNode<TId, TEntry, TMeasure> {
  if (edit !== null && node.edit === edit) return node;
  if (instrumentation !== undefined) instrumentation.work.orderNodesCopied += 1;
  return { ...node, edit };
}

function refreshNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
): void {
  node.count = (node.left?.count ?? 0) + 1 + (node.right?.count ?? 0);
  node.height = 1 + Math.max(nodeHeight(node.left), nodeHeight(node.right));
  refreshNodeMeasure(node, context);
}

function refreshNodeMeasure<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
): void {
  const left = node.left?.measure ?? context.measure.empty;
  const right = node.right?.measure ?? context.measure.empty;
  node.measure = context.measure.combine(
    context.measure.combine(left, node.ownMeasure),
    right,
  );
}

function refreshDeferredNodeMeasure<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  node: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
): void {
  let measure = node.ownMeasure;
  if (node.left !== null) {
    measure = context.measure.combine(node.left.measure, measure);
  }
  if (node.right !== null) {
    measure = context.measure.combine(measure, node.right.measure);
  }
  node.measure = measure;
}

function refreshNodeStructure<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(node: TreeNode<TId, TEntry, TMeasure>): void {
  node.count = (node.left?.count ?? 0) + 1 + (node.right?.count ?? 0);
  node.height = 1 + Math.max(nodeHeight(node.left), nodeHeight(node.right));
}

function refreshForMode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  deferMeasure: boolean,
): void {
  if (deferMeasure) refreshNodeStructure(node);
  else refreshNode(node, context);
}

function balanceFactor<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
): number {
  return nodeHeight(node.left) - nodeHeight(node.right);
}

function rotateRight<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
  deferMeasure = false,
): TreeNode<TId, TEntry, TMeasure> {
  const lower = editableNode(root, edit, context.instrumentation);
  const pivot = editableNode(lower.left!, edit, context.instrumentation);
  lower.left = pivot.right;
  refreshForMode(lower, context, deferMeasure);
  pivot.right = lower;
  refreshForMode(pivot, context, deferMeasure);
  return pivot;
}

function rotateLeft<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
  deferMeasure = false,
): TreeNode<TId, TEntry, TMeasure> {
  const lower = editableNode(root, edit, context.instrumentation);
  const pivot = editableNode(lower.right!, edit, context.instrumentation);
  lower.right = pivot.left;
  refreshForMode(lower, context, deferMeasure);
  pivot.left = lower;
  refreshForMode(pivot, context, deferMeasure);
  return pivot;
}

function rebalance<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
  deferMeasure = false,
): TreeNode<TId, TEntry, TMeasure> {
  refreshForMode(root, context, deferMeasure);
  const balance = balanceFactor(root);
  if (balance > 1) {
    if (balanceFactor(root.left!) < 0) {
      root.left = rotateLeft(root.left!, context, edit, deferMeasure);
    }
    return rotateRight(root, context, edit, deferMeasure);
  }
  if (balance < -1) {
    if (balanceFactor(root.right!) > 0) {
      root.right = rotateRight(root.right!, context, edit, deferMeasure);
    }
    return rotateLeft(root, context, edit, deferMeasure);
  }
  return root;
}

function insertNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure> | null,
  inserted: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
  deferMeasure = false,
): TreeNode<TId, TEntry, TMeasure> {
  if (root === null) return inserted;
  const comparison = compareEntries(
    inserted.entry,
    inserted.id,
    root.entry,
    root.id,
    context,
  );
  if (comparison === 0) return root;

  const updated = editableNode(root, edit, context.instrumentation);
  if (comparison < 0) {
    updated.left = insertNode(
      updated.left,
      inserted,
      context,
      edit,
      deferMeasure,
    );
  } else {
    updated.right = insertNode(
      updated.right,
      inserted,
      context,
      edit,
      deferMeasure,
    );
  }
  return rebalance(updated, context, edit, deferMeasure);
}

function extractMinimum<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): ExtractedMinimum<TId, TEntry, TMeasure> {
  if (root.left === null) return { minimum: root, node: root.right };
  const extracted = extractMinimum(root.left, context, edit);
  const updated = editableNode(root, edit, context.instrumentation);
  updated.left = extracted.node;
  return {
    minimum: extracted.minimum,
    node: rebalance(updated, context, edit),
  };
}

function removeNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure> | null,
  removedEntry: TEntry,
  removedId: TId,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeChange<TId, TEntry, TMeasure> {
  if (root === null) return { node: null, changed: false };
  const comparison = compareEntries(
    removedEntry,
    removedId,
    root.entry,
    root.id,
    context,
  );
  if (comparison === 0) {
    if (root.left === null) return { node: root.right, changed: true };
    if (root.right === null) return { node: root.left, changed: true };
    const extracted = extractMinimum(root.right, context, edit);
    const replacement = editableNode(
      extracted.minimum,
      edit,
      context.instrumentation,
    );
    replacement.left = root.left;
    replacement.right = extracted.node;
    return {
      node: rebalance(replacement, context, edit),
      changed: true,
    };
  }

  if (comparison < 0) {
    const change = removeNode(
      root.left,
      removedEntry,
      removedId,
      context,
      edit,
    );
    if (!change.changed) return { node: root, changed: false };
    const updated = editableNode(root, edit, context.instrumentation);
    updated.left = change.node;
    return { node: rebalance(updated, context, edit), changed: true };
  }

  const change = removeNode(root.right, removedEntry, removedId, context, edit);
  if (!change.changed) return { node: root, changed: false };
  const updated = editableNode(root, edit, context.instrumentation);
  updated.right = change.node;
  return { node: rebalance(updated, context, edit), changed: true };
}

function entryAtNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure> | null,
  index: number,
): TEntry | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= (root?.count ?? 0)) {
    return undefined;
  }
  let node = root;
  let remaining = index;
  while (node !== null) {
    const leftCount = node.left?.count ?? 0;
    if (remaining < leftCount) node = node.left;
    else if (remaining === leftCount) return node.entry;
    else {
      remaining -= leftCount + 1;
      node = node.right;
    }
  }
  return undefined;
}

function rankOfNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure> | null,
  entry: TEntry,
  id: TId,
  context: TreeContext<TId, TEntry, TMeasure>,
): number | undefined {
  let node = root;
  let rank = 0;
  while (node !== null) {
    if (sameId(id, node.id)) return rank + (node.left?.count ?? 0);
    const comparison = compareEntries(entry, id, node.entry, node.id, context);
    if (comparison < 0) node = node.left;
    else if (comparison > 0) {
      rank += (node.left?.count ?? 0) + 1;
      node = node.right;
    } else return rank + (node.left?.count ?? 0);
  }
  return undefined;
}

function normalizedBound(bound: number, size: number): number {
  if (Number.isNaN(bound)) return 0;
  return Math.max(0, Math.min(size, Math.trunc(bound)));
}

function appendRange<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure> | null,
  offset: number,
  start: number,
  end: number,
  result: TEntry[],
): void {
  if (node === null || start >= end) return;
  const nodeRank = offset + (node.left?.count ?? 0);
  if (start < nodeRank) appendRange(node.left, offset, start, end, result);
  if (start <= nodeRank && nodeRank < end) result.push(node.entry);
  if (nodeRank + 1 < end) {
    appendRange(node.right, nodeRank + 1, start, end, result);
  }
}

function rangeFromNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure> | null,
  start: number,
  end: number,
): readonly TEntry[] {
  const size = root?.count ?? 0;
  const normalizedStart = normalizedBound(start, size);
  const normalizedEnd = normalizedBound(end, size);
  if (normalizedStart >= normalizedEnd) return [];
  const result: TEntry[] = [];
  appendRange(root, 0, normalizedStart, normalizedEnd, result);
  return result;
}

function* iterateEntries<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure> | null,
): IterableIterator<TEntry> {
  if (node === null) return;
  yield* iterateEntries(node.left);
  yield node.entry;
  yield* iterateEntries(node.right);
}

function* iterateTransientEntries<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  node: TreeNode<TId, TEntry, TMeasure> | null,
  assertHealthy: () => void,
): IterableIterator<TEntry> {
  assertHealthy();
  if (node === null) return;
  yield* iterateTransientEntries(node.left, assertHealthy);
  assertHealthy();
  yield node.entry;
  yield* iterateTransientEntries(node.right, assertHealthy);
}

class PersistentOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> implements OrderStatisticTree<TId, TEntry, TMeasure> {
  readonly #root: TreeNode<TId, TEntry, TMeasure> | null;
  readonly #byId: PersistentMap<TId, TEntry>;
  readonly #context: TreeContext<TId, TEntry, TMeasure>;

  constructor(
    root: TreeNode<TId, TEntry, TMeasure> | null,
    byId: PersistentMap<TId, TEntry>,
    context: TreeContext<TId, TEntry, TMeasure>,
  ) {
    this.#root = root;
    this.#byId = byId;
    this.#context = context;
    persistentRoots.set(this, root);
  }

  get size(): number {
    return this.#root?.count ?? 0;
  }

  get measure(): TMeasure {
    return this.#root?.measure ?? this.#context.measure.empty;
  }

  get(id: TId): TEntry | undefined {
    return this.#byId.get(id);
  }

  entryAt(index: number): TEntry | undefined {
    return entryAtNode(this.#root, index);
  }

  rankOf(id: TId): number | undefined {
    const entry = this.#byId.get(id);
    if (entry === undefined && !this.#byId.has(id)) return undefined;
    return rankOfNode(this.#root, entry!, id, this.#context);
  }

  range(start: number, end: number): readonly TEntry[] {
    return rangeFromNode(this.#root, start, end);
  }

  insertOrReplace(entry: TEntry): OrderStatisticTree<TId, TEntry, TMeasure> {
    const id = this.#context.getId(entry);
    const previous = this.#byId.get(id);
    const exists = previous !== undefined || this.#byId.has(id);
    if (exists && Object.is(previous, entry)) return this;

    let root = this.#root;
    if (exists) {
      const removal = removeNode(root, previous!, id, this.#context, null);
      if (!removal.changed) return this;
      root = removal.node;
    }
    root = insertNode(
      root,
      createNode(entry, id, this.#context, null),
      this.#context,
      null,
    );
    return new PersistentOrderStatisticTree(
      root,
      this.#byId.set(id, entry),
      this.#context,
    );
  }

  remove(id: TId): OrderStatisticTree<TId, TEntry, TMeasure> {
    const entry = this.#byId.get(id);
    if (entry === undefined && !this.#byId.has(id)) return this;
    const removal = removeNode(this.#root, entry!, id, this.#context, null);
    if (!removal.changed) return this;
    return new PersistentOrderStatisticTree(
      removal.node,
      this.#byId.delete(id),
      this.#context,
    );
  }

  asTransient(): TransientOrderStatisticTree<TId, TEntry, TMeasure> {
    return new TransientOrderStatisticTreeImpl(
      this.#root,
      this.#byId.asTransient(),
      this.#context,
      false,
    );
  }

  /**
   * The strict-order check is unconditional by default: a misordered build
   * silently corrupts every later rank and lookup, which is strictly worse
   * than the O(n) cost of checking. Duplicates compare 0 and are rejected by
   * the same check.
   *
   * `proof.orderIsProven` is the only opt-out, and it exists for the two
   * in-package callers whose input is strictly sorted BY CONSTRUCTION, not by
   * assumption:
   *
   * - `filter-rebuild` merges the captured visible tree's in-order walk (the
   *   tree's own order, minus a skipped subset — still strictly increasing)
   *   with a subset it just sorted under the identical composite comparator
   *   (`compareWithSortKeys` then id). A merge of two strictly-increasing
   *   sequences under one total order is strictly increasing, and the two
   *   sequences are disjoint by id (a flipped-in row was not visible).
   * - `sort-rebuild` hands over `Array.sort` output under that same composite
   *   comparator, id tiebreak included, so it is totally ordered and the ids
   *   are unique because they come from a HAMT keyed by id.
   *
   * Any caller that cannot make that argument from its own code — including
   * every external caller, which is why the option is package-internal — must
   * leave the check on. The escape hatch buys n−1 comparator calls per commit
   * and nothing else; it is not worth taking on a hunch.
   */
  [buildFromSortedEntries](
    sorted: readonly TEntry[],
    proof?: BulkBuildProof<TId, TEntry, TMeasure>,
  ): OrderStatisticTree<TId, TEntry, TMeasure> {
    const context = this.#context;
    const entryIds = sorted.map((entry) => context.getId(entry));
    if (proof?.orderIsProven === true) {
      if (context.instrumentation !== undefined) {
        context.instrumentation.work.bulkOrderVerificationsSkipped += 1;
      }
    } else {
      for (let index = 1; index < sorted.length; index += 1) {
        const comparison = compareEntries(
          sorted[index - 1]!,
          entryIds[index - 1]!,
          sorted[index]!,
          entryIds[index]!,
          context,
        );
        if (comparison >= 0) {
          throw new TypeError(
            "Bulk build input must be strictly sorted by the tree's total order.",
          );
        }
      }
    }

    const byId = this.#buildById(sorted, entryIds, proof?.derivedById);

    const build = (
      low: number,
      high: number,
    ): TreeNode<TId, TEntry, TMeasure> | null => {
      if (low > high) return null;
      const middle = (low + high) >> 1;
      const node = createNode<TId, TEntry, TMeasure>(
        sorted[middle] as TEntry,
        entryIds[middle]!,
        context,
        null,
      );
      node.left = build(low, middle - 1);
      node.right = build(middle + 1, high);
      if (node.left !== null || node.right !== null) {
        refreshNode(node, context);
      }
      return node;
    };

    return new PersistentOrderStatisticTree(
      build(0, sorted.length - 1),
      byId,
      context,
    );
  }

  [createDeferredMeasureDraft](): DeferredMeasureTransientOrderStatisticTree<
    TId,
    TEntry,
    TMeasure
  > {
    if (this.size !== 0) {
      throw new Error("Deferred measure drafts require an empty tree.");
    }
    return new TransientOrderStatisticTreeImpl(
      this.#root,
      this.#byId.asTransient(),
      this.#context,
      true,
    );
  }

  entries(): IterableIterator<TEntry> {
    return iterateEntries(this.#root);
  }

  /**
   * Refills the id→entry map from `sorted` (n inserts) unless the caller
   * supplied a derivation, in which case it edits the base tree's map in
   * place on a transient: k deletes plus k inserts, where k is the flip
   * count, not n.
   *
   * The derivation is a CLAIM, and only one half of it is verified. The
   * post-edit size check below is O(1) and catches the whole class of
   * "wrong edit set" slips (leavers left in, an added entry missing, a
   * duplicate id). What it cannot catch is a STALE survivor: derived mode
   * never touches an id that is neither removed nor added, so it keeps
   * whatever entry object the base map held for it. That is only correct
   * when the caller REUSES survivors' entry objects by identity, which is
   * exactly the precondition filter-rebuild's merge satisfies (a still-passing
   * row is unflipped, so its record and keys are both unchanged) and exactly
   * the one sort-rebuild does NOT: it allocates a fresh entry per row to
   * carry the new plan's keys, so its survivors are new objects and derived
   * mode would leave the map pointing at the previous plan's entries. That is
   * why sort-rebuild takes `orderIsProven` and nothing else.
   */
  #buildById(
    sorted: readonly TEntry[],
    entryIds: readonly TId[],
    derived: BulkBuildDerivedById<TId, TEntry, TMeasure> | undefined,
  ): PersistentMap<TId, TEntry> {
    const context = this.#context;
    if (derived === undefined) {
      const draft = createPersistentMap<TId, TEntry>().asTransient();
      for (let index = 0; index < sorted.length; index += 1) {
        draft.set(entryIds[index]!, sorted[index]!);
      }
      return draft.freeze();
    }
    const base = derived.base;
    if (!(base instanceof PersistentOrderStatisticTree)) {
      throw new TypeError(
        "Derived bulk-build maps require a base tree created by this module.",
      );
    }
    // The base map is taken as-is rather than re-instrumented: the refill it
    // replaces built into a FRESH, uninstrumented map, so re-instrumenting
    // here would start charging visible-index byId churn to
    // `hamtNodesCopied` — the counter the suite uses as the record-rebuild
    // proxy, which must stay zero across a filter commit. The derivation's
    // own cost is reported by `bulkByIdDerived` instead.
    const draft = (base.#byId as PersistentMap<TId, TEntry>).asTransient();
    for (const id of derived.removedIds) draft.delete(id);
    for (const entry of derived.addedEntries) {
      draft.set(context.getId(entry), entry);
    }
    const byId = draft.freeze();
    if (byId.size !== sorted.length) {
      throw new TypeError(
        "Derived bulk-build map size must equal the built entry count.",
      );
    }
    if (context.instrumentation !== undefined) {
      context.instrumentation.work.bulkByIdDerived += 1;
    }
    return byId;
  }

  [attachInstrumentation](
    instrumentation: LocalRowModelInstrumentation,
    beforeCombine?: () => void,
  ) {
    const measure =
      beforeCombine === undefined
        ? this.#context.measure
        : {
            ...this.#context.measure,
            combine: (left: TMeasure, right: TMeasure) => {
              beforeCombine();
              return this.#context.measure.combine(left, right);
            },
          };
    return new PersistentOrderStatisticTree(
      this.#root,
      instrumentPersistentMap(this.#byId, instrumentation),
      { ...this.#context, measure, instrumentation },
    );
  }
}

class TransientOrderStatisticTreeImpl<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> implements DeferredMeasureTransientOrderStatisticTree<TId, TEntry, TMeasure> {
  #root: TreeNode<TId, TEntry, TMeasure> | null;
  readonly #byId: TransientMap<TId, TEntry>;
  readonly #context: TreeContext<TId, TEntry, TMeasure>;
  readonly #edit = new TreeEditToken();
  readonly #deferredMeasure: boolean;
  #frozen: OrderStatisticTree<TId, TEntry, TMeasure> | undefined;
  #measureFrames:
    | Array<{
        readonly node: TreeNode<TId, TEntry, TMeasure>;
        readonly exit: boolean;
      }>
    | undefined;
  #pendingMeasureCount = 0;
  #poisoned = false;
  #poisonCause: unknown;

  constructor(
    root: TreeNode<TId, TEntry, TMeasure> | null,
    byId: TransientMap<TId, TEntry>,
    context: TreeContext<TId, TEntry, TMeasure>,
    deferredMeasure: boolean,
  ) {
    this.#root = root;
    this.#byId = byId;
    this.#context = context;
    this.#deferredMeasure = deferredMeasure;
  }

  #assertHealthy(): void {
    if (this.#poisoned) {
      throw new PoisonedTransientOrderStatisticTreeError(this.#poisonCause);
    }
  }

  #assertMutable(): void {
    this.#assertHealthy();
    this.#edit.assertEditable();
  }

  #guard<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      this.#poisoned = true;
      this.#poisonCause = error;
      throw error;
    }
  }

  get size(): number {
    this.#assertHealthy();
    return this.#root?.count ?? 0;
  }

  get measure(): TMeasure {
    this.#assertHealthy();
    if (this.#deferredMeasure && this.#pendingMeasureCount > 0) {
      throw new Error("Deferred tree measures must seal before they are read.");
    }
    return this.#root?.measure ?? this.#context.measure.empty;
  }

  get(id: TId): TEntry | undefined {
    this.#assertHealthy();
    return this.#byId.get(id);
  }

  entryAt(index: number): TEntry | undefined {
    this.#assertHealthy();
    return entryAtNode(this.#root, index);
  }

  rankOf(id: TId): number | undefined {
    this.#assertHealthy();
    return this.#guard(() => {
      const entry = this.#byId.get(id);
      if (entry === undefined && !this.#byId.has(id)) return undefined;
      return rankOfNode(this.#root, entry!, id, this.#context);
    });
  }

  range(start: number, end: number): readonly TEntry[] {
    this.#assertHealthy();
    return rangeFromNode(this.#root, start, end);
  }

  insertOrReplace(entry: TEntry): this {
    this.#assertMutable();
    if (this.#measureFrames !== undefined) {
      throw new Error("Cannot insert after deferred measure sealing started.");
    }
    return this.#guard(() => {
      const id = this.#context.getId(entry);
      const previous = this.#byId.get(id);
      const exists = previous !== undefined || this.#byId.has(id);
      if (exists && Object.is(previous, entry)) return this;

      let root = this.#root;
      if (exists) {
        const removal = removeNode(
          root,
          previous!,
          id,
          this.#context,
          this.#edit,
        );
        if (!removal.changed) return this;
        root = removal.node;
      }
      root = insertNode(
        root,
        createNode(entry, id, this.#context, this.#edit),
        this.#context,
        this.#edit,
        this.#deferredMeasure,
      );
      this.#root = root;
      this.#byId.set(id, entry);
      if (this.#deferredMeasure) this.#pendingMeasureCount = this.size;
      return this;
    });
  }

  remove(id: TId): this {
    this.#assertMutable();
    if (this.#deferredMeasure) {
      throw new Error("Deferred measure drafts do not support removal.");
    }
    return this.#guard(() => {
      const entry = this.#byId.get(id);
      if (entry === undefined && !this.#byId.has(id)) return this;
      const removal = removeNode(
        this.#root,
        entry!,
        id,
        this.#context,
        this.#edit,
      );
      if (!removal.changed) return this;
      this.#root = removal.node;
      this.#byId.delete(id);
      return this;
    });
  }

  freeze(): OrderStatisticTree<TId, TEntry, TMeasure> {
    this.#assertHealthy();
    if (this.#deferredMeasure && this.#pendingMeasureCount > 0) {
      throw new Error("Deferred tree measures must seal before freezing.");
    }
    if (this.#frozen !== undefined) return this.#frozen;
    this.#edit.freeze();
    this.#frozen = new PersistentOrderStatisticTree(
      this.#root,
      this.#byId.freeze(),
      this.#context,
    );
    return this.#frozen;
  }

  entries(): IterableIterator<TEntry> {
    this.#assertHealthy();
    return iterateTransientEntries(this.#root, () => this.#assertHealthy());
  }

  get pendingMeasureCount(): number {
    this.#assertHealthy();
    return this.#deferredMeasure ? this.#pendingMeasureCount : 0;
  }

  sealMeasureStep(): boolean {
    this.#assertMutable();
    if (!this.#deferredMeasure || this.#pendingMeasureCount === 0) return true;
    return this.#guard(() => {
      if (this.#measureFrames === undefined) {
        this.#measureFrames =
          this.#root === null ? [] : [{ node: this.#root, exit: false }];
      }
      for (;;) {
        const frame = this.#measureFrames.pop()!;
        if (frame.exit) {
          refreshDeferredNodeMeasure(frame.node, this.#context);
          break;
        } else {
          this.#measureFrames.push({ node: frame.node, exit: true });
          if (frame.node.right !== null) {
            this.#measureFrames.push({ node: frame.node.right, exit: false });
          }
          if (frame.node.left !== null) {
            this.#measureFrames.push({ node: frame.node.left, exit: false });
          }
        }
      }
      this.#pendingMeasureCount -= 1;
      return this.#pendingMeasureCount === 0;
    });
  }
}

/** Creates an empty persistent AVL order-statistic tree. */
export function createOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  options: OrderStatisticTreeOptions<TId, TEntry, TMeasure>,
): OrderStatisticTree<TId, TEntry, TMeasure> {
  const context: TreeContext<TId, TEntry, TMeasure> = {
    getId: options.getId,
    compare: options.compare,
    measure: {
      empty: options.measure.empty,
      fromEntry: options.measure.fromEntry,
      combine: options.measure.combine,
    },
  };
  return new PersistentOrderStatisticTree(
    null,
    createPersistentMap<TId, TEntry>(),
    context,
  );
}

/** Internal bulk-build primitive; deliberately omitted from the package index. */
export function createDeferredMeasureTransientOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  tree: OrderStatisticTree<TId, TEntry, TMeasure>,
): DeferredMeasureTransientOrderStatisticTree<TId, TEntry, TMeasure> {
  if (!(tree instanceof PersistentOrderStatisticTree)) {
    throw new TypeError(
      "Deferred measure drafts require a tree created by this module.",
    );
  }
  return tree[createDeferredMeasureDraft]();
}

/** Internal bulk-build primitive; deliberately omitted from the package index. */
export function compareOrderStatisticTreeIds(
  left: OrderStatisticTreeId,
  right: OrderStatisticTreeId,
): number {
  return compareIds(left, right);
}

/**
 * Internal bulk-build primitive; deliberately omitted from the package index.
 *
 * Builds a balanced tree in O(n) from `sorted`, which must be strictly
 * increasing under `like`'s total order (comparator, ties broken by ID).
 * Throws TypeError when adjacent entries compare `>= 0` — misordered input,
 * equal-compare entries with misordered IDs, and duplicate IDs alike — or
 * when `like` was not created by this module.
 *
 * `proof` lets an in-package caller trade a claim it can prove from its own
 * construction for work the builder would otherwise redo; see
 * {@link BulkBuildProof}. Omitting it keeps every check on.
 */
export function createOrderStatisticTreeFromSortedEntries<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  like: OrderStatisticTree<TId, TEntry, TMeasure>,
  sorted: readonly TEntry[],
  proof?: BulkBuildProof<TId, TEntry, TMeasure>,
): OrderStatisticTree<TId, TEntry, TMeasure> {
  if (!(like instanceof PersistentOrderStatisticTree)) {
    throw new TypeError("Bulk builds require a tree created by this module.");
  }
  return like[buildFromSortedEntries](sorted, proof);
}

export function instrumentOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  tree: OrderStatisticTree<TId, TEntry, TMeasure>,
  instrumentation: LocalRowModelInstrumentation | undefined,
): OrderStatisticTree<TId, TEntry, TMeasure> {
  if (instrumentation === undefined) return tree;
  if (!(tree instanceof PersistentOrderStatisticTree)) {
    throw new TypeError(
      "Instrumentation requires an order tree created by this module.",
    );
  }
  return tree[attachInstrumentation](instrumentation);
}

export function instrumentMeasuredOrderStatisticTree<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  tree: OrderStatisticTree<TId, TEntry, TMeasure>,
  instrumentation: LocalRowModelInstrumentation,
  beforeCombine: () => void,
): OrderStatisticTree<TId, TEntry, TMeasure> {
  if (!(tree instanceof PersistentOrderStatisticTree)) {
    throw new TypeError(
      "Instrumentation requires an order tree created by this module.",
    );
  }
  return tree[attachInstrumentation](instrumentation, beforeCombine);
}

function inspectNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure> | null,
): {
  readonly snapshot: OrderStatisticTreeNodeDiagnostic<TId> | null;
  readonly balanced: boolean;
  readonly count: number;
  readonly height: number;
} {
  if (node === null) {
    return { snapshot: null, balanced: true, count: 0, height: 0 };
  }
  const left = inspectNode(node.left);
  const right = inspectNode(node.right);
  const count = left.count + 1 + right.count;
  const height = 1 + Math.max(left.height, right.height);
  const balance = left.height - right.height;
  const snapshot = Object.freeze({
    id: node.id,
    count: node.count,
    height: node.height,
    balance,
    left: left.snapshot,
    right: right.snapshot,
  });
  return {
    snapshot,
    balanced:
      left.balanced &&
      right.balanced &&
      Math.abs(balance) <= 1 &&
      node.count === count &&
      node.height === height,
    count,
    height,
  };
}

function collectNodes(
  node: { readonly left: object | null; readonly right: object | null } | null,
  result: Set<object>,
): void {
  if (node === null) return;
  result.add(node);
  collectNodes(
    node.left as {
      readonly left: object | null;
      readonly right: object | null;
    } | null,
    result,
  );
  collectNodes(
    node.right as {
      readonly left: object | null;
      readonly right: object | null;
    } | null,
    result,
  );
}

function countSharedNodes(
  node: { readonly left: object | null; readonly right: object | null } | null,
  candidates: ReadonlySet<object>,
): number {
  if (node === null) return 0;
  return (
    (candidates.has(node) ? 1 : 0) +
    countSharedNodes(
      node.left as {
        readonly left: object | null;
        readonly right: object | null;
      } | null,
      candidates,
    ) +
    countSharedNodes(
      node.right as {
        readonly left: object | null;
        readonly right: object | null;
      } | null,
      candidates,
    )
  );
}

export function getOrderStatisticTreeDiagnosticsForTesting<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  tree: OrderStatisticTree<TId, TEntry, TMeasure>,
  comparedWith?: OrderStatisticTree<TId, TEntry, TMeasure>,
): OrderStatisticTreeDiagnostics<TId> {
  if (!persistentRoots.has(tree as object)) {
    throw new TypeError("Diagnostics require a tree created by this module.");
  }
  const root = persistentRoots.get(tree as object) as TreeNode<
    TId,
    TEntry,
    TMeasure
  > | null;
  const inspected = inspectNode(root);
  let sharedNodeCount = 0;
  if (comparedWith !== undefined) {
    if (!persistentRoots.has(comparedWith as object)) {
      throw new TypeError("Diagnostics require a tree created by this module.");
    }
    const comparedRoot = persistentRoots.get(comparedWith as object) as {
      readonly left: object | null;
      readonly right: object | null;
    } | null;
    const candidates = new Set<object>();
    collectNodes(comparedRoot, candidates);
    sharedNodeCount = countSharedNodes(root, candidates);
  }
  return Object.freeze({
    count: inspected.count,
    height: inspected.height,
    balanced: inspected.balanced,
    sharedNodeCount,
    root: inspected.snapshot,
  });
}
