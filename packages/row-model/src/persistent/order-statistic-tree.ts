import { createPersistentMap, type PersistentMap } from "./persistent-map";
import type { TransientMap } from "./transient";

export type OrderStatisticTreeId = string | number;

export interface OrderStatisticTreeMeasure<TEntry, TMeasure> {
  readonly empty: TMeasure;
  readonly fromEntry: (entry: TEntry) => TMeasure;
  readonly combine: (left: TMeasure, right: TMeasure) => TMeasure;
}

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

interface TreeContext<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  readonly getId: (entry: TEntry) => TId;
  readonly compare: (left: TEntry, right: TEntry) => number;
  readonly measure: OrderStatisticTreeMeasure<TEntry, TMeasure>;
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

interface TreeNode<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  edit: TreeEditToken | null;
  readonly id: TId;
  entry: TEntry;
  readonly priority: number;
  ownMeasure: TMeasure;
  measure: TMeasure;
  count: number;
  left: TreeNode<TId, TEntry, TMeasure> | null;
  right: TreeNode<TId, TEntry, TMeasure> | null;
}

interface TreeChange<TId extends OrderStatisticTreeId, TEntry, TMeasure> {
  readonly node: TreeNode<TId, TEntry, TMeasure> | null;
  readonly changed: boolean;
}

export interface OrderStatisticTreeNodeForTesting<TEntry, TMeasure> {
  readonly entry: TEntry;
  readonly priority: number;
  readonly count: number;
  readonly measure: TMeasure;
  readonly left: OrderStatisticTreeNodeForTesting<TEntry, TMeasure> | null;
  readonly right: OrderStatisticTreeNodeForTesting<TEntry, TMeasure> | null;
}

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

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function priorityForId(id: OrderStatisticTreeId): number {
  let hash = hashString(typeof id === "string" ? `s:${id}` : `n:${String(id)}`);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
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

function compareHeapKeys(
  leftPriority: number,
  leftId: OrderStatisticTreeId,
  rightPriority: number,
  rightId: OrderStatisticTreeId,
): number {
  if (leftPriority !== rightPriority) {
    return leftPriority < rightPriority ? -1 : 1;
  }
  return compareIds(leftId, rightId);
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
    priority: priorityForId(id),
    ownMeasure,
    measure: ownMeasure,
    count: 1,
    left: null,
    right: null,
  };
}

function editableNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeNode<TId, TEntry, TMeasure> {
  if (edit !== null && node.edit === edit) return node;
  return { ...node, edit };
}

function refreshNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  node: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
): void {
  node.count = (node.left?.count ?? 0) + 1 + (node.right?.count ?? 0);
  const left = node.left?.measure ?? context.measure.empty;
  const right = node.right?.measure ?? context.measure.empty;
  node.measure = context.measure.combine(
    context.measure.combine(left, node.ownMeasure),
    right,
  );
}

function rotateRight<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeNode<TId, TEntry, TMeasure> {
  const pivot = editableNode(root.left!, edit);
  root.left = pivot.right;
  refreshNode(root, context);
  pivot.right = root;
  refreshNode(pivot, context);
  return pivot;
}

function rotateLeft<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeNode<TId, TEntry, TMeasure> {
  const pivot = editableNode(root.right!, edit);
  root.right = pivot.left;
  refreshNode(root, context);
  pivot.left = root;
  refreshNode(pivot, context);
  return pivot;
}

function insertNode<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  root: TreeNode<TId, TEntry, TMeasure> | null,
  inserted: TreeNode<TId, TEntry, TMeasure>,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeNode<TId, TEntry, TMeasure> {
  if (root === null) return inserted;

  const comparison = compareEntries(
    inserted.entry,
    inserted.id,
    root.entry,
    root.id,
    context,
  );
  const updated = editableNode(root, edit);
  if (comparison < 0) {
    updated.left = insertNode(updated.left, inserted, context, edit);
    refreshNode(updated, context);
    if (
      compareHeapKeys(
        updated.left.priority,
        updated.left.id,
        updated.priority,
        updated.id,
      ) < 0
    ) {
      return rotateRight(updated, context, edit);
    }
    return updated;
  }

  updated.right = insertNode(updated.right, inserted, context, edit);
  refreshNode(updated, context);
  if (
    compareHeapKeys(
      updated.right.priority,
      updated.right.id,
      updated.priority,
      updated.id,
    ) < 0
  ) {
    return rotateLeft(updated, context, edit);
  }
  return updated;
}

function mergeNodes<TId extends OrderStatisticTreeId, TEntry, TMeasure>(
  left: TreeNode<TId, TEntry, TMeasure> | null,
  right: TreeNode<TId, TEntry, TMeasure> | null,
  context: TreeContext<TId, TEntry, TMeasure>,
  edit: TreeEditToken | null,
): TreeNode<TId, TEntry, TMeasure> | null {
  if (left === null) return right;
  if (right === null) return left;

  if (compareHeapKeys(left.priority, left.id, right.priority, right.id) < 0) {
    const updated = editableNode(left, edit);
    updated.right = mergeNodes(updated.right, right, context, edit);
    refreshNode(updated, context);
    return updated;
  }

  const updated = editableNode(right, edit);
  updated.left = mergeNodes(left, updated.left, context, edit);
  refreshNode(updated, context);
  return updated;
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
    return {
      node: mergeNodes(root.left, root.right, context, edit),
      changed: true,
    };
  }

  if (comparison < 0) {
    const leftChange = removeNode(
      root.left,
      removedEntry,
      removedId,
      context,
      edit,
    );
    if (!leftChange.changed) return { node: root, changed: false };
    const updated = editableNode(root, edit);
    updated.left = leftChange.node;
    refreshNode(updated, context);
    return { node: updated, changed: true };
  }

  const rightChange = removeNode(
    root.right,
    removedEntry,
    removedId,
    context,
    edit,
  );
  if (!rightChange.changed) return { node: root, changed: false };
  const updated = editableNode(root, edit);
  updated.right = rightChange.node;
  refreshNode(updated, context);
  return { node: updated, changed: true };
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
    if (remaining < leftCount) {
      node = node.left;
    } else if (remaining === leftCount) {
      return node.entry;
    } else {
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
    const comparison = compareEntries(entry, id, node.entry, node.id, context);
    if (comparison < 0) {
      node = node.left;
    } else if (comparison > 0) {
      rank += (node.left?.count ?? 0) + 1;
      node = node.right;
    } else {
      return rank + (node.left?.count ?? 0);
    }
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
  if (start < nodeRank) {
    appendRange(node.left, offset, start, end, result);
  }
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

    const inserted = createNode(entry, id, this.#context, null);
    const withoutPrevious = exists
      ? removeNode(this.#root, previous!, id, this.#context, null).node
      : this.#root;
    const root = insertNode(withoutPrevious, inserted, this.#context, null);
    return new PersistentOrderStatisticTree(
      root,
      this.#byId.set(id, entry),
      this.#context,
    );
  }

  remove(id: TId): OrderStatisticTree<TId, TEntry, TMeasure> {
    const entry = this.#byId.get(id);
    if (entry === undefined && !this.#byId.has(id)) return this;
    return new PersistentOrderStatisticTree(
      removeNode(this.#root, entry!, id, this.#context, null).node,
      this.#byId.delete(id),
      this.#context,
    );
  }

  asTransient(): TransientOrderStatisticTree<TId, TEntry, TMeasure> {
    return new TransientOrderStatisticTreeImpl(
      this.#root,
      this.#byId.asTransient(),
      this.#context,
    );
  }

  entries(): IterableIterator<TEntry> {
    return iterateEntries(this.#root);
  }

  rootForTesting(): TreeNode<TId, TEntry, TMeasure> | null {
    return this.#root;
  }
}

class TransientOrderStatisticTreeImpl<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
> implements TransientOrderStatisticTree<TId, TEntry, TMeasure> {
  #root: TreeNode<TId, TEntry, TMeasure> | null;
  readonly #byId: TransientMap<TId, TEntry>;
  readonly #context: TreeContext<TId, TEntry, TMeasure>;
  readonly #edit = new TreeEditToken();
  #frozen: OrderStatisticTree<TId, TEntry, TMeasure> | undefined;

  constructor(
    root: TreeNode<TId, TEntry, TMeasure> | null,
    byId: TransientMap<TId, TEntry>,
    context: TreeContext<TId, TEntry, TMeasure>,
  ) {
    this.#root = root;
    this.#byId = byId;
    this.#context = context;
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

  insertOrReplace(entry: TEntry): this {
    this.#edit.assertEditable();
    const id = this.#context.getId(entry);
    const previous = this.#byId.get(id);
    const exists = previous !== undefined || this.#byId.has(id);
    if (exists && Object.is(previous, entry)) return this;

    const inserted = createNode(entry, id, this.#context, this.#edit);
    if (exists) {
      this.#root = removeNode(
        this.#root,
        previous!,
        id,
        this.#context,
        this.#edit,
      ).node;
    }
    this.#root = insertNode(this.#root, inserted, this.#context, this.#edit);
    this.#byId.set(id, entry);
    return this;
  }

  remove(id: TId): this {
    this.#edit.assertEditable();
    const entry = this.#byId.get(id);
    if (entry === undefined && !this.#byId.has(id)) return this;
    this.#root = removeNode(
      this.#root,
      entry!,
      id,
      this.#context,
      this.#edit,
    ).node;
    this.#byId.delete(id);
    return this;
  }

  freeze(): OrderStatisticTree<TId, TEntry, TMeasure> {
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
    return iterateEntries(this.#root);
  }
}

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

export function getOrderStatisticTreePriorityForTesting(
  id: OrderStatisticTreeId,
): number {
  return priorityForId(id);
}

export function getOrderStatisticTreeRootForTesting<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  tree: OrderStatisticTree<TId, TEntry, TMeasure>,
): OrderStatisticTreeNodeForTesting<TEntry, TMeasure> | null {
  if (!(tree instanceof PersistentOrderStatisticTree)) {
    throw new TypeError("Diagnostics require a tree created by this module.");
  }
  return tree.rootForTesting();
}
