import { createPersistentMap, type PersistentMap } from "./persistent-map";
import { instrumentPersistentMap } from "./persistent-map";
import type { TransientMap } from "./transient";
import type { LocalRowModelInstrumentation } from "../diagnostics";

const attachInstrumentation = Symbol("attachOrderInstrumentation");
const createDeferredMeasureDraft = Symbol("createDeferredMeasureDraft");

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
          refreshNodeMeasure(frame.node, this.#context);
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
