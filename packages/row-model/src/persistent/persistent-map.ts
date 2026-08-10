import { TransientEditToken, type TransientMap } from "./transient";
import type { LocalRowModelInstrumentation } from "../diagnostics";

type MapKey = string | number;
type HashFunction<K extends MapKey> = (key: K) => number;
type Entry<K extends MapKey, V> = [key: K, value: V];
const inspectPersistentPath = Symbol("inspectPersistentPath");
const inspectTransientPath = Symbol("inspectTransientPath");
const attachInstrumentation = Symbol("attachInstrumentation");

interface LeafNode<K extends MapKey, V> {
  readonly kind: "leaf";
  edit: TransientEditToken | null;
  readonly hash: number;
  entries: Array<Entry<K, V>>;
}

interface BranchNode<K extends MapKey, V> {
  readonly kind: "branch";
  edit: TransientEditToken | null;
  bitmap: number;
  children: Array<Node<K, V>>;
}

type Node<K extends MapKey, V> = LeafNode<K, V> | BranchNode<K, V>;

interface Change<K extends MapKey, V> {
  readonly node: Node<K, V> | null;
  readonly changed: boolean;
  readonly sizeDelta: -1 | 0 | 1;
}

export interface PersistentMap<K extends MapKey, V> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): PersistentMap<K, V>;
  delete(key: K): PersistentMap<K, V>;
  asTransient(): TransientMap<K, V>;
  entries(): IterableIterator<readonly [K, V]>;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashKey(key: MapKey): number {
  return hashString(typeof key === "string" ? `s:${key}` : `n:${String(key)}`);
}

function sameKey(left: MapKey, right: MapKey): boolean {
  return left === right || (left !== left && right !== right);
}

function fragment(hash: number, shift: number): number {
  return (hash >>> shift) & 0b1_1111;
}

function bitPosition(hash: number, shift: number): number {
  return 1 << fragment(hash, shift);
}

function populationCount(value: number): number {
  let remaining = value >>> 0;
  remaining -= (remaining >>> 1) & 0x55555555;
  remaining = (remaining & 0x33333333) + ((remaining >>> 2) & 0x33333333);
  return (((remaining + (remaining >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function childIndex(bitmap: number, bit: number): number {
  return populationCount(bitmap & (bit - 1));
}

function createLeaf<K extends MapKey, V>(
  edit: TransientEditToken | null,
  hash: number,
  key: K,
  value: V,
): LeafNode<K, V> {
  return { kind: "leaf", edit, hash, entries: [[key, value]] };
}

function editableLeaf<K extends MapKey, V>(
  node: LeafNode<K, V>,
  edit: TransientEditToken | null,
  instrumentation: LocalRowModelInstrumentation | undefined,
): LeafNode<K, V> {
  if (edit !== null && node.edit === edit) return node;
  if (instrumentation !== undefined) instrumentation.work.hamtNodesCopied += 1;
  return { ...node, edit, entries: node.entries.slice() };
}

function editableBranch<K extends MapKey, V>(
  node: BranchNode<K, V>,
  edit: TransientEditToken | null,
  instrumentation: LocalRowModelInstrumentation | undefined,
): BranchNode<K, V> {
  if (edit !== null && node.edit === edit) return node;
  if (instrumentation !== undefined) instrumentation.work.hamtNodesCopied += 1;
  return { ...node, edit, children: node.children.slice() };
}

function mergeLeaves<K extends MapKey, V>(
  shift: number,
  left: LeafNode<K, V>,
  right: LeafNode<K, V>,
  edit: TransientEditToken | null,
): BranchNode<K, V> {
  const leftBit = bitPosition(left.hash, shift);
  const rightBit = bitPosition(right.hash, shift);

  if (leftBit === rightBit) {
    return {
      kind: "branch",
      edit,
      bitmap: leftBit,
      children: [mergeLeaves(shift + 5, left, right, edit)],
    };
  }

  return {
    kind: "branch",
    edit,
    bitmap: leftBit | rightBit,
    children: leftBit >>> 0 < rightBit >>> 0 ? [left, right] : [right, left],
  };
}

function setNode<K extends MapKey, V>(
  node: Node<K, V> | null,
  shift: number,
  hash: number,
  key: K,
  value: V,
  edit: TransientEditToken | null,
  instrumentation: LocalRowModelInstrumentation | undefined,
): Change<K, V> {
  if (node === null) {
    return {
      node: createLeaf(edit, hash, key, value),
      changed: true,
      sizeDelta: 1,
    };
  }

  if (node.kind === "leaf") {
    if (node.hash !== hash) {
      return {
        node: mergeLeaves(
          shift,
          node,
          createLeaf(edit, hash, key, value),
          edit,
        ),
        changed: true,
        sizeDelta: 1,
      };
    }

    const entryIndex = node.entries.findIndex(([entryKey]) =>
      sameKey(entryKey, key),
    );
    if (entryIndex >= 0) {
      if (Object.is(node.entries[entryIndex]![1], value)) {
        return { node, changed: false, sizeDelta: 0 };
      }
      const updated = editableLeaf(node, edit, instrumentation);
      updated.entries[entryIndex] = [key, value];
      return { node: updated, changed: true, sizeDelta: 0 };
    }

    const updated = editableLeaf(node, edit, instrumentation);
    updated.entries.push([key, value]);
    return { node: updated, changed: true, sizeDelta: 1 };
  }

  const bit = bitPosition(hash, shift);
  const index = childIndex(node.bitmap, bit);
  if ((node.bitmap & bit) === 0) {
    const updated = editableBranch(node, edit, instrumentation);
    updated.bitmap |= bit;
    updated.children.splice(index, 0, createLeaf(edit, hash, key, value));
    return { node: updated, changed: true, sizeDelta: 1 };
  }

  const childChange = setNode(
    node.children[index]!,
    shift + 5,
    hash,
    key,
    value,
    edit,
    instrumentation,
  );
  if (!childChange.changed) return { node, changed: false, sizeDelta: 0 };

  const updated = editableBranch(node, edit, instrumentation);
  updated.children[index] = childChange.node!;
  return {
    node: updated,
    changed: true,
    sizeDelta: childChange.sizeDelta,
  };
}

function deleteNode<K extends MapKey, V>(
  node: Node<K, V> | null,
  shift: number,
  hash: number,
  key: K,
  edit: TransientEditToken | null,
  instrumentation: LocalRowModelInstrumentation | undefined,
): Change<K, V> {
  if (node === null) return { node, changed: false, sizeDelta: 0 };

  if (node.kind === "leaf") {
    if (node.hash !== hash) return { node, changed: false, sizeDelta: 0 };
    const entryIndex = node.entries.findIndex(([entryKey]) =>
      sameKey(entryKey, key),
    );
    if (entryIndex < 0) return { node, changed: false, sizeDelta: 0 };
    if (node.entries.length === 1) {
      return { node: null, changed: true, sizeDelta: -1 };
    }

    const updated = editableLeaf(node, edit, instrumentation);
    updated.entries.splice(entryIndex, 1);
    return { node: updated, changed: true, sizeDelta: -1 };
  }

  const bit = bitPosition(hash, shift);
  if ((node.bitmap & bit) === 0) {
    return { node, changed: false, sizeDelta: 0 };
  }

  const index = childIndex(node.bitmap, bit);
  const childChange = deleteNode(
    node.children[index]!,
    shift + 5,
    hash,
    key,
    edit,
    instrumentation,
  );
  if (!childChange.changed) return { node, changed: false, sizeDelta: 0 };

  const updated = editableBranch(node, edit, instrumentation);
  if (childChange.node === null) {
    updated.bitmap &= ~bit;
    updated.children.splice(index, 1);
    if (updated.children.length === 0) {
      return { node: null, changed: true, sizeDelta: -1 };
    }
  } else {
    updated.children[index] = childChange.node;
  }
  if (updated.children.length === 1 && updated.children[0]!.kind === "leaf") {
    return { node: updated.children[0]!, changed: true, sizeDelta: -1 };
  }
  return { node: updated, changed: true, sizeDelta: -1 };
}

function lookupEntry<K extends MapKey, V>(
  root: Node<K, V> | null,
  hash: number,
  key: K,
): Entry<K, V> | undefined {
  let node = root;
  let shift = 0;
  while (node !== null) {
    if (node.kind === "leaf") {
      if (node.hash !== hash) return undefined;
      return node.entries.find(([entryKey]) => sameKey(entryKey, key));
    }
    const bit = bitPosition(hash, shift);
    if ((node.bitmap & bit) === 0) return undefined;
    node = node.children[childIndex(node.bitmap, bit)]!;
    shift += 5;
  }
  return undefined;
}

function nodePath<K extends MapKey, V>(
  root: Node<K, V> | null,
  hash: number,
): readonly object[] {
  const path: object[] = [];
  let node = root;
  let shift = 0;
  while (node !== null) {
    path.push(node);
    if (node.kind === "leaf") break;
    const bit = bitPosition(hash, shift);
    if ((node.bitmap & bit) === 0) break;
    node = node.children[childIndex(node.bitmap, bit)]!;
    shift += 5;
  }
  return path;
}

function* iterateEntries<K extends MapKey, V>(
  node: Node<K, V> | null,
): IterableIterator<readonly [K, V]> {
  if (node === null) return;
  if (node.kind === "leaf") {
    for (const [key, value] of node.entries) yield [key, value] as const;
    return;
  }
  for (const child of node.children) yield* iterateEntries(child);
}

class PersistentHashMap<K extends MapKey, V> implements PersistentMap<K, V> {
  readonly #size: number;
  readonly #root: Node<K, V> | null;
  readonly #hash: HashFunction<K>;
  readonly #instrumentation: LocalRowModelInstrumentation | undefined;

  constructor(
    size: number,
    root: Node<K, V> | null,
    hash: HashFunction<K>,
    instrumentation?: LocalRowModelInstrumentation,
  ) {
    this.#size = size;
    this.#root = root;
    this.#hash = hash;
    this.#instrumentation = instrumentation;
  }

  get size(): number {
    return this.#size;
  }

  get(key: K): V | undefined {
    return lookupEntry(this.#root, this.#hash(key) >>> 0, key)?.[1];
  }

  has(key: K): boolean {
    return lookupEntry(this.#root, this.#hash(key) >>> 0, key) !== undefined;
  }

  set(key: K, value: V): PersistentMap<K, V> {
    const change = setNode(
      this.#root,
      0,
      this.#hash(key) >>> 0,
      key,
      value,
      null,
      this.#instrumentation,
    );
    if (!change.changed) return this;
    return new PersistentHashMap(
      this.#size + change.sizeDelta,
      change.node,
      this.#hash,
      this.#instrumentation,
    );
  }

  delete(key: K): PersistentMap<K, V> {
    const change = deleteNode(
      this.#root,
      0,
      this.#hash(key) >>> 0,
      key,
      null,
      this.#instrumentation,
    );
    if (!change.changed) return this;
    return new PersistentHashMap(
      this.#size + change.sizeDelta,
      change.node,
      this.#hash,
      this.#instrumentation,
    );
  }

  asTransient(): TransientMap<K, V> {
    return new TransientHashMap(
      this.#size,
      this.#root,
      this.#hash,
      this.#instrumentation,
    );
  }

  entries(): IterableIterator<readonly [K, V]> {
    return iterateEntries(this.#root);
  }

  [inspectPersistentPath](key: K): readonly object[] {
    return nodePath(this.#root, this.#hash(key) >>> 0);
  }

  [attachInstrumentation](instrumentation: LocalRowModelInstrumentation) {
    return new PersistentHashMap(
      this.#size,
      this.#root,
      this.#hash,
      instrumentation,
    );
  }
}

class TransientHashMap<K extends MapKey, V> implements TransientMap<K, V> {
  #size: number;
  #root: Node<K, V> | null;
  readonly #hash: HashFunction<K>;
  readonly #edit = new TransientEditToken();
  readonly #instrumentation: LocalRowModelInstrumentation | undefined;
  #frozen: PersistentMap<K, V> | undefined;

  constructor(
    size: number,
    root: Node<K, V> | null,
    hash: HashFunction<K>,
    instrumentation?: LocalRowModelInstrumentation,
  ) {
    this.#size = size;
    this.#root = root;
    this.#hash = hash;
    this.#instrumentation = instrumentation;
  }

  get size(): number {
    return this.#size;
  }

  get(key: K): V | undefined {
    return lookupEntry(this.#root, this.#hash(key) >>> 0, key)?.[1];
  }

  has(key: K): boolean {
    return lookupEntry(this.#root, this.#hash(key) >>> 0, key) !== undefined;
  }

  set(key: K, value: V): this {
    this.#edit.assertEditable();
    const change = setNode(
      this.#root,
      0,
      this.#hash(key) >>> 0,
      key,
      value,
      this.#edit,
      this.#instrumentation,
    );
    this.#root = change.node;
    this.#size += change.sizeDelta;
    return this;
  }

  delete(key: K): this {
    this.#edit.assertEditable();
    const change = deleteNode(
      this.#root,
      0,
      this.#hash(key) >>> 0,
      key,
      this.#edit,
      this.#instrumentation,
    );
    this.#root = change.node;
    this.#size += change.sizeDelta;
    return this;
  }

  freeze(): PersistentMap<K, V> {
    if (this.#frozen !== undefined) return this.#frozen;
    this.#edit.freeze();
    this.#frozen = new PersistentHashMap(
      this.#size,
      this.#root,
      this.#hash,
      this.#instrumentation,
    );
    return this.#frozen;
  }

  entries(): IterableIterator<readonly [K, V]> {
    return iterateEntries(this.#root);
  }

  [inspectTransientPath](key: K): readonly object[] {
    return nodePath(this.#root, this.#hash(key) >>> 0);
  }
}

export function createPersistentMap<K extends MapKey, V>(): PersistentMap<
  K,
  V
> {
  return new PersistentHashMap<K, V>(0, null, hashKey);
}

export function instrumentPersistentMap<K extends MapKey, V>(
  map: PersistentMap<K, V>,
  instrumentation: LocalRowModelInstrumentation | undefined,
): PersistentMap<K, V> {
  if (instrumentation === undefined) return map;
  if (!(map instanceof PersistentHashMap)) {
    throw new TypeError(
      "Instrumentation requires a map created by this module.",
    );
  }
  return map[attachInstrumentation](instrumentation);
}

export function createPersistentMapForTesting<K extends MapKey, V>(
  hash: HashFunction<K>,
): PersistentMap<K, V> {
  return new PersistentHashMap(0, null, hash);
}

export function getPersistentMapPathForTesting<K extends MapKey, V>(
  map: PersistentMap<K, V>,
  key: K,
): readonly object[] {
  if (!(map instanceof PersistentHashMap)) {
    throw new TypeError("Diagnostics require a map created by this module.");
  }

  return map[inspectPersistentPath](key);
}

export function getTransientMapPathForTesting<K extends MapKey, V>(
  map: TransientMap<K, V>,
  key: K,
): readonly object[] {
  if (!(map instanceof TransientHashMap)) {
    throw new TypeError("Diagnostics require a map created by this module.");
  }
  return map[inspectTransientPath](key);
}
