import type {
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import type {
  PretableIndexedCellAddress,
  PretableIndexedCellRange,
  PretableIndexedRowRange,
  PretableIndexedRowRangeIndex,
  PretableIndexedSelectionState,
  PretableIndexedSelectionSummary,
} from "./types";

function dataRef<TRowId extends PretableRowId>(rowId: TRowId) {
  return { kind: "data" as const, rowId };
}

class ImmutableSet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values?: Iterable<T>) {
    this.#values = new Set(values);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: T): boolean {
    return this.#values.has(value);
  }

  forEach(
    callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: object,
  ): void {
    for (const value of this.#values) {
      callbackfn.call(thisArg, value, value, this);
    }
  }

  entries(): SetIterator<[T, T]> {
    return this.#values.entries();
  }

  keys(): SetIterator<T> {
    return this.#values.keys();
  }

  values(): SetIterator<T> {
    return this.#values.values();
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.#values[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return "ImmutableSet";
  }
}

/** @internal Clones mutable caller input behind a read-only collection surface. */
export function toImmutableIndexedSet<T>(values?: Iterable<T>): ReadonlySet<T> {
  return Object.freeze(new ImmutableSet(values));
}

function isVisibleData<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>, rowId: TRowId) {
  return snapshot.indexOf(dataRef(rowId)) >= 0;
}

export function createEmptyIndexedSelection<
  TRowId extends PretableRowId,
  TColumnId extends string,
>(): PretableIndexedSelectionState<TRowId, TColumnId> {
  return Object.freeze({
    rows: Object.freeze({
      kind: "explicit" as const,
      rowIds: toImmutableIndexedSet<TRowId>(),
    }),
    ranges: Object.freeze([]),
    anchor: null,
  });
}

export function selectAllVisibleRows<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  if (snapshot.visibleDataRowCount === 0) return selection;
  if (
    selection.rows.kind === "all" &&
    (selection.rows.excludedRanges?.size ?? 0) === 0
  )
    return selection;
  return Object.freeze({
    ...selection,
    rows: Object.freeze({
      kind: "all" as const,
    }),
  });
}

export function toggleIndexedRowSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  rowId: TRowId,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  if (!isVisibleData(snapshot, rowId)) return selection;
  if (selection.rows.kind === "explicit") {
    const rowIds = new Set(selection.rows.rowIds);
    const rangeIndex = currentRangeIndex(selection.rows.ranges, snapshot);
    let excludedRanges = currentExclusionIndex(
      selection.rows.excludedRanges,
      snapshot,
    );
    const point = resolvedRowRange(
      { startRowId: rowId, endRowId: rowId },
      snapshot,
    )!;
    const selectedByRange = rangeTreeContains(rangeIndex.root, point.lo);
    if (isIndexedRowSelected(selection, { kind: "data", rowId }, snapshot)) {
      rowIds.delete(rowId);
      if (selectedByRange)
        excludedRanges = insertExcludedPoint(excludedRanges, point);
      else excludedRanges = removeExcludedSpan(excludedRanges, point);
    } else {
      excludedRanges = removeExcludedSpan(excludedRanges, point);
      rowIds.add(rowId);
    }
    return Object.freeze({
      ...selection,
      rows: Object.freeze({
        kind: "explicit" as const,
        rowIds: toImmutableIndexedSet(rowIds),
        ...(rangeIndex.size === 0 ? {} : { ranges: rangeIndex }),
        ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
      }),
    });
  }
  let excludedRanges = currentExclusionIndex(
    selection.rows.excludedRanges,
    snapshot,
  );
  const point = resolvedRowRange(
    { startRowId: rowId, endRowId: rowId },
    snapshot,
  )!;
  excludedRanges = rangeTreeContains(excludedRanges.root, point.lo)
    ? removeExcludedSpan(excludedRanges, point)
    : insertExcludedPoint(excludedRanges, point);
  return Object.freeze({
    ...selection,
    rows: Object.freeze({
      kind: "all" as const,
      ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
    }),
  });
}

interface ResolvedRowRange<TRowId extends PretableRowId> {
  readonly lo: number;
  readonly hi: number;
  readonly loId: TRowId;
  readonly hiId: TRowId;
}

interface RowRangeNode<
  TRowId extends PretableRowId,
> extends ResolvedRowRange<TRowId> {
  readonly left: RowRangeNode<TRowId> | null;
  readonly right: RowRangeNode<TRowId> | null;
  readonly height: number;
  readonly maxHi: number;
  readonly selectedCount: number;
  readonly size: number;
}

function nodeHeight<TRowId extends PretableRowId>(
  node: RowRangeNode<TRowId> | null,
): number {
  return node?.height ?? 0;
}

function makeRangeNode<TRowId extends PretableRowId>(
  range: ResolvedRowRange<TRowId>,
  left: RowRangeNode<TRowId> | null = null,
  right: RowRangeNode<TRowId> | null = null,
): RowRangeNode<TRowId> {
  return Object.freeze({
    ...range,
    left,
    right,
    height: Math.max(nodeHeight(left), nodeHeight(right)) + 1,
    maxHi: Math.max(range.hi, left?.maxHi ?? -1, right?.maxHi ?? -1),
    selectedCount:
      range.hi -
      range.lo +
      1 +
      (left?.selectedCount ?? 0) +
      (right?.selectedCount ?? 0),
    size: 1 + (left?.size ?? 0) + (right?.size ?? 0),
  });
}

function balanceRangeNode<TRowId extends PretableRowId>(
  node: RowRangeNode<TRowId>,
): RowRangeNode<TRowId> {
  const balance = nodeHeight(node.left) - nodeHeight(node.right);
  if (balance > 1 && node.left !== null) {
    let left = node.left;
    if (nodeHeight(left.left) < nodeHeight(left.right) && left.right !== null) {
      const pivot = left.right;
      left = makeRangeNode(
        pivot,
        makeRangeNode(left, left.left, pivot.left),
        pivot.right,
      );
    }
    return makeRangeNode(
      left,
      left.left,
      makeRangeNode(node, left.right, node.right),
    );
  }
  if (balance < -1 && node.right !== null) {
    let right = node.right;
    if (
      nodeHeight(right.right) < nodeHeight(right.left) &&
      right.left !== null
    ) {
      const pivot = right.left;
      right = makeRangeNode(
        pivot,
        pivot.left,
        makeRangeNode(right, pivot.right, right.right),
      );
    }
    return makeRangeNode(
      right,
      makeRangeNode(node, node.left, right.left),
      right.right,
    );
  }
  return node;
}

function insertRangeNode<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
  range: ResolvedRowRange<TRowId>,
): RowRangeNode<TRowId> {
  if (root === null) return makeRangeNode(range);
  return range.lo < root.lo
    ? balanceRangeNode(
        makeRangeNode(root, insertRangeNode(root.left, range), root.right),
      )
    : balanceRangeNode(
        makeRangeNode(root, root.left, insertRangeNode(root.right, range)),
      );
}

function minimumRangeNode<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId>,
): RowRangeNode<TRowId> {
  let current = root;
  while (current.left !== null) current = current.left;
  return current;
}

function removeRangeNode<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
  lo: number,
): RowRangeNode<TRowId> | null {
  if (root === null) return null;
  if (lo < root.lo)
    return balanceRangeNode(
      makeRangeNode(root, removeRangeNode(root.left, lo), root.right),
    );
  if (lo > root.lo)
    return balanceRangeNode(
      makeRangeNode(root, root.left, removeRangeNode(root.right, lo)),
    );
  if (root.left === null) return root.right;
  if (root.right === null) return root.left;
  const successor = minimumRangeNode(root.right);
  return balanceRangeNode(
    makeRangeNode(
      successor,
      root.left,
      removeRangeNode(root.right, successor.lo),
    ),
  );
}

function splitRangeTree<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
  lo: number,
): readonly [RowRangeNode<TRowId> | null, RowRangeNode<TRowId> | null] {
  if (root === null) return [null, null];
  if (root.lo < lo) {
    const [leftOfSplit, rightOfSplit] = splitRangeTree(root.right, lo);
    return [
      balanceRangeNode(makeRangeNode(root, root.left, leftOfSplit)),
      rightOfSplit,
    ];
  }
  const [leftOfSplit, rightOfSplit] = splitRangeTree(root.left, lo);
  return [
    leftOfSplit,
    balanceRangeNode(makeRangeNode(root, rightOfSplit, root.right)),
  ];
}

function concatenateRangeTrees<TRowId extends PretableRowId>(
  left: RowRangeNode<TRowId> | null,
  right: RowRangeNode<TRowId> | null,
): RowRangeNode<TRowId> | null {
  if (left === null) return right;
  if (right === null) return left;
  if (nodeHeight(left) > nodeHeight(right) + 1)
    return balanceRangeNode(
      makeRangeNode(left, left.left, concatenateRangeTrees(left.right, right)),
    );
  if (nodeHeight(right) > nodeHeight(left) + 1)
    return balanceRangeNode(
      makeRangeNode(
        right,
        concatenateRangeTrees(left, right.left),
        right.right,
      ),
    );
  const successor = minimumRangeNode(right);
  return balanceRangeNode(
    makeRangeNode(successor, left, removeRangeNode(right, successor.lo)),
  );
}

function findOverlappingRange<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
  lo: number,
  hi: number,
): RowRangeNode<TRowId> | undefined {
  if (root === null) return undefined;
  if (root.left !== null && root.left.maxHi >= lo - 1) {
    const left = findOverlappingRange(root.left, lo, hi);
    if (left !== undefined) return left;
  }
  if (root.lo <= hi + 1 && root.hi >= lo - 1) return root;
  return root.lo > hi + 1
    ? undefined
    : findOverlappingRange(root.right, lo, hi);
}

function findIntersectingRange<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
  lo: number,
  hi: number,
): RowRangeNode<TRowId> | undefined {
  if (root === null) return undefined;
  if (root.left !== null && root.left.maxHi >= lo) {
    const left = findIntersectingRange(root.left, lo, hi);
    if (left !== undefined) return left;
  }
  if (root.lo <= hi && root.hi >= lo) return root;
  return root.lo > hi ? undefined : findIntersectingRange(root.right, lo, hi);
}

function rangeTreeContains<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
  rank: number,
): boolean {
  let current = root;
  while (current !== null) {
    if (rank < current.lo) current = current.left;
    else if (rank > current.hi) current = current.right;
    else return true;
  }
  return false;
}

class IndexedRowRangeIndex<
  TRowId extends PretableRowId,
> implements PretableIndexedRowRangeIndex<TRowId> {
  readonly revision: number;
  readonly root: RowRangeNode<TRowId> | null;
  readonly size: number;

  constructor(revision: number, root: RowRangeNode<TRowId> | null) {
    this.revision = revision;
    this.root = root;
    this.size = root?.size ?? 0;
    Object.freeze(this);
  }

  *[Symbol.iterator](): Iterator<PretableIndexedRowRange<TRowId>> {
    const stack: RowRangeNode<TRowId>[] = [];
    let current = this.root;
    while (current !== null || stack.length > 0) {
      while (current !== null) {
        stack.push(current);
        current = current.left;
      }
      const next = stack.pop()!;
      yield Object.freeze({ startRowId: next.loId, endRowId: next.hiId });
      current = next.right;
    }
  }
}

const exclusionIndexes = new WeakSet<object>();

function makeExclusionIndex<TRowId extends PretableRowId>(
  revision: number,
  root: RowRangeNode<TRowId> | null,
): IndexedRowRangeIndex<TRowId> {
  const index = new IndexedRowRangeIndex(revision, root);
  exclusionIndexes.add(index);
  return index;
}

function resolvedRowRange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  range: PretableIndexedRowRange<TRowId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
) {
  const startRank = snapshot.dataIndexOf(dataRef(range.startRowId));
  const endRank = snapshot.dataIndexOf(dataRef(range.endRowId));
  if (startRank < 0 || endRank < 0) return undefined;
  return startRank <= endRank
    ? {
        lo: startRank,
        hi: endRank,
        loId: range.startRowId,
        hiId: range.endRowId,
      }
    : {
        lo: endRank,
        hi: startRank,
        loId: range.endRowId,
        hiId: range.startRowId,
      };
}

function insertResolvedRange<TRowId extends PretableRowId>(
  index: IndexedRowRangeIndex<TRowId>,
  next: ResolvedRowRange<TRowId>,
): IndexedRowRangeIndex<TRowId> {
  let root = index.root;
  let merged = next;
  for (;;) {
    const overlap = findOverlappingRange(root, merged.lo, merged.hi);
    if (overlap === undefined) break;
    root = removeRangeNode(root, overlap.lo);
    merged = {
      lo: Math.min(merged.lo, overlap.lo),
      hi: Math.max(merged.hi, overlap.hi),
      loId: overlap.lo < merged.lo ? overlap.loId : merged.loId,
      hiId: overlap.hi > merged.hi ? overlap.hiId : merged.hiId,
    };
  }
  return new IndexedRowRangeIndex(
    index.revision,
    insertRangeNode(root, merged),
  );
}

function createRangeIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: Iterable<PretableIndexedRowRange<TRowId>> | undefined,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): IndexedRowRangeIndex<TRowId> {
  let index = new IndexedRowRangeIndex<TRowId>(snapshot.revision, null);
  for (const range of ranges ?? []) {
    const resolved = resolvedRowRange(range, snapshot);
    if (resolved !== undefined) index = insertResolvedRange(index, resolved);
  }
  return index;
}

function currentRangeIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: PretableIndexedRowRangeIndex<TRowId> | undefined,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): IndexedRowRangeIndex<TRowId> {
  return ranges instanceof IndexedRowRangeIndex &&
    ranges.revision === snapshot.revision
    ? ranges
    : createRangeIndex(ranges, snapshot);
}

function createExclusionIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: Iterable<PretableIndexedRowRange<TRowId>> | undefined,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): IndexedRowRangeIndex<TRowId> {
  let index = makeExclusionIndex<TRowId>(snapshot.revision, null);
  for (const range of ranges ?? []) {
    for (const rowId of [range.startRowId, range.endRowId]) {
      const point = resolvedRowRange(
        { startRowId: rowId, endRowId: rowId },
        snapshot,
      );
      if (point !== undefined && !rangeTreeContains(index.root, point.lo))
        index = makeExclusionIndex(
          snapshot.revision,
          insertRangeNode(index.root, point),
        );
    }
  }
  return index;
}

function currentExclusionIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  ranges: PretableIndexedRowRangeIndex<TRowId> | undefined,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): IndexedRowRangeIndex<TRowId> {
  return ranges instanceof IndexedRowRangeIndex &&
    exclusionIndexes.has(ranges) &&
    ranges.revision === snapshot.revision
    ? ranges
    : createExclusionIndex(ranges, snapshot);
}

function insertExcludedPoint<TRowId extends PretableRowId>(
  index: IndexedRowRangeIndex<TRowId>,
  point: ResolvedRowRange<TRowId>,
): IndexedRowRangeIndex<TRowId> {
  if (rangeTreeContains(index.root, point.lo)) return index;
  return makeExclusionIndex(index.revision, insertRangeNode(index.root, point));
}

function removeExcludedSpan<TRowId extends PretableRowId>(
  index: IndexedRowRangeIndex<TRowId>,
  removed: Pick<ResolvedRowRange<TRowId>, "lo" | "hi">,
): IndexedRowRangeIndex<TRowId> {
  if (findIntersectingRange(index.root, removed.lo, removed.hi) === undefined)
    return index;
  const [left, fromLo] = splitRangeTree(index.root, removed.lo);
  const [, right] = splitRangeTree(fromLo, removed.hi + 1);
  return makeExclusionIndex(index.revision, concatenateRangeTrees(left, right));
}

function rowRankInRangeIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  rowId: TRowId,
  index: IndexedRowRangeIndex<TRowId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): boolean {
  const rank = snapshot.dataIndexOf(dataRef(rowId));
  return rank >= 0 && rangeTreeContains(index.root, rank);
}

export function selectIndexedRowRange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  startRowId: TRowId,
  endRowId: TRowId,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  const nextRange = { startRowId, endRowId };
  const resolvedNext = resolvedRowRange(nextRange, snapshot);
  if (resolvedNext === undefined) return selection;
  if (selection.rows.kind === "all") {
    const excludedRanges = removeExcludedSpan(
      currentExclusionIndex(selection.rows.excludedRanges, snapshot),
      resolvedNext,
    );
    if (
      excludedRanges === selection.rows.excludedRanges ||
      (excludedRanges.size === 0 && selection.rows.excludedRanges === undefined)
    )
      return selection;
    return Object.freeze({
      ...selection,
      rows: Object.freeze({
        kind: "all" as const,
        ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
      }),
    });
  }
  const ranges = insertResolvedRange(
    currentRangeIndex(selection.rows.ranges, snapshot),
    resolvedNext,
  );
  const excludedRanges = removeExcludedSpan(
    currentExclusionIndex(selection.rows.excludedRanges, snapshot),
    resolvedNext,
  );
  return Object.freeze({
    ...selection,
    rows: Object.freeze({
      kind: "explicit" as const,
      rowIds: selection.rows.rowIds,
      ranges,
      ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
    }),
  });
}

export function isIndexedRowSelected<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  ref: PretableVisibleRowRef<TRowId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): boolean {
  if (ref.kind !== "data" || snapshot.indexOf(ref) < 0) return false;
  const excludedRanges = currentExclusionIndex(
    selection.rows.excludedRanges,
    snapshot,
  );
  const excluded = rowRankInRangeIndex(ref.rowId, excludedRanges, snapshot);
  if (selection.rows.kind === "all") return !excluded;
  const rangeIndex = currentRangeIndex(selection.rows.ranges, snapshot);
  return (
    !excluded &&
    (selection.rows.rowIds.has(ref.rowId) ||
      rowRankInRangeIndex(ref.rowId, rangeIndex, snapshot))
  );
}

export function getIndexedSelectionSummary<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionSummary {
  const visibleCount = snapshot.visibleDataRowCount;
  let selectedCount = 0;
  if (selection.rows.kind === "explicit") {
    const rangeIndex = currentRangeIndex(selection.rows.ranges, snapshot);
    selectedCount = rangeIndex.root?.selectedCount ?? 0;
    for (const rowId of selection.rows.rowIds) {
      if (
        isVisibleData(snapshot, rowId) &&
        !rowRankInRangeIndex(rowId, rangeIndex, snapshot)
      )
        selectedCount += 1;
    }
    const excludedRanges = currentExclusionIndex(
      selection.rows.excludedRanges,
      snapshot,
    );
    selectedCount -= excludedRanges.root?.selectedCount ?? 0;
  } else {
    const excludedRanges = currentExclusionIndex(
      selection.rows.excludedRanges,
      snapshot,
    );
    selectedCount = Math.max(
      0,
      visibleCount - (excludedRanges.root?.selectedCount ?? 0),
    );
  }
  return Object.freeze({
    state:
      selectedCount === 0
        ? "none"
        : selectedCount === visibleCount
          ? "all"
          : "some",
    selectedCount,
    visibleCount,
  });
}

function columnIndex<TColumnId extends string>(
  columns: readonly TColumnId[],
  columnId: TColumnId,
): number {
  for (let index = 0; index < columns.length; index += 1) {
    if (columns[index] === columnId) return index;
  }
  return -1;
}

export function indexedRangeContainsCell<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
  ref: PretableVisibleRowRef<TRowId>,
  columnId: TColumnId,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  columns: readonly TColumnId[],
): boolean {
  if (ref.kind !== "data") return false;
  const rowIndex = snapshot.indexOf(ref);
  const startRowIndex = snapshot.indexOf(dataRef(range.start.rowId));
  const endRowIndex = snapshot.indexOf(dataRef(range.end.rowId));
  const currentColumnIndex = columnIndex(columns, columnId);
  const startColumnIndex = columnIndex(columns, range.start.columnId);
  const endColumnIndex = columnIndex(columns, range.end.columnId);
  if (
    rowIndex < 0 ||
    startRowIndex < 0 ||
    endRowIndex < 0 ||
    currentColumnIndex < 0 ||
    startColumnIndex < 0 ||
    endColumnIndex < 0
  ) {
    return false;
  }
  return (
    rowIndex >= Math.min(startRowIndex, endRowIndex) &&
    rowIndex <= Math.max(startRowIndex, endRowIndex) &&
    currentColumnIndex >= Math.min(startColumnIndex, endColumnIndex) &&
    currentColumnIndex <= Math.max(startColumnIndex, endColumnIndex)
  );
}

function visibleAddress<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  address: PretableIndexedCellAddress<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): boolean {
  return isVisibleData(snapshot, address.rowId);
}

function* resolvedRangeNodes<TRowId extends PretableRowId>(
  root: RowRangeNode<TRowId> | null,
): Generator<ResolvedRowRange<TRowId>> {
  if (root === null) return;
  yield* resolvedRangeNodes(root.left);
  yield root;
  yield* resolvedRangeNodes(root.right);
}

function retainExcludedPointsInRanges<TRowId extends PretableRowId>(
  exclusions: IndexedRowRangeIndex<TRowId>,
  selectedRanges: IndexedRowRangeIndex<TRowId>,
): IndexedRowRangeIndex<TRowId> {
  let result = makeExclusionIndex<TRowId>(exclusions.revision, null);
  for (const point of resolvedRangeNodes(exclusions.root)) {
    if (rangeTreeContains(selectedRanges.root, point.lo))
      result = insertExcludedPoint(result, point);
  }
  return result;
}

function sameRowId(left: PretableRowId, right: PretableRowId): boolean {
  return left === right || (left !== left && right !== right);
}

function sameRangeIndexContents<TRowId extends PretableRowId>(
  left: IndexedRowRangeIndex<TRowId>,
  right: IndexedRowRangeIndex<TRowId>,
): boolean {
  if (left === right) return true;
  if (
    left.size !== right.size ||
    left.root?.selectedCount !== right.root?.selectedCount
  )
    return false;
  const leftIterator = resolvedRangeNodes(left.root);
  const rightIterator = resolvedRangeNodes(right.root);
  for (;;) {
    const leftNext = leftIterator.next();
    const rightNext = rightIterator.next();
    if (leftNext.done || rightNext.done)
      return leftNext.done === rightNext.done;
    if (
      leftNext.value.lo !== rightNext.value.lo ||
      leftNext.value.hi !== rightNext.value.hi ||
      !sameRowId(leftNext.value.loId, rightNext.value.loId) ||
      !sameRowId(leftNext.value.hiId, rightNext.value.hiId)
    )
      return false;
  }
}

export function reconcileIndexedSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  let changed = false;
  let rows = selection.rows;
  if (rows.kind === "explicit" && (rows.ranges?.size ?? 0) > 0) {
    const nextRowRanges: PretableIndexedRowRange<TRowId>[] = [];
    for (const range of rows.ranges ?? []) {
      const startVisible = isVisibleData(snapshot, range.startRowId);
      const endVisible = isVisibleData(snapshot, range.endRowId);
      if (startVisible && endVisible) nextRowRanges.push(range);
      else if (startVisible || endVisible) {
        const survivor = startVisible ? range.startRowId : range.endRowId;
        nextRowRanges.push({ startRowId: survivor, endRowId: survivor });
        changed = true;
      } else changed = true;
    }
    const currentIndex = currentRangeIndex(rows.ranges, snapshot);
    const revisionChanged = currentIndex !== rows.ranges;
    if (changed || revisionChanged)
      rows = Object.freeze({
        ...rows,
        ...(nextRowRanges.length === 0
          ? { ranges: undefined }
          : { ranges: createRangeIndex(nextRowRanges, snapshot) }),
      });
    changed ||= revisionChanged;
  }
  const currentExcludedRanges = currentExclusionIndex(
    rows.excludedRanges,
    snapshot,
  );
  const reconciledExcludedRanges =
    rows.kind === "explicit"
      ? retainExcludedPointsInRanges(
          currentExcludedRanges,
          currentRangeIndex(rows.ranges, snapshot),
        )
      : currentExcludedRanges;
  if (
    (rows.excludedRanges !== undefined &&
      currentExcludedRanges !== rows.excludedRanges) ||
    !sameRangeIndexContents(currentExcludedRanges, reconciledExcludedRanges)
  ) {
    rows = Object.freeze({
      ...rows,
      ...(reconciledExcludedRanges.size === 0
        ? { excludedRanges: undefined }
        : { excludedRanges: reconciledExcludedRanges }),
    });
    changed = true;
  }
  const ranges: PretableIndexedCellRange<TRowId, TColumnId>[] = [];
  for (const range of selection.ranges) {
    const startVisible = visibleAddress(range.start, snapshot);
    const endVisible = visibleAddress(range.end, snapshot);
    if (startVisible && endVisible) {
      ranges.push(range);
    } else if (startVisible || endVisible) {
      const survivor = startVisible ? range.start : range.end;
      ranges.push(Object.freeze({ start: survivor, end: survivor }));
      changed = true;
    } else {
      changed = true;
    }
  }
  let anchor = selection.anchor;
  if (anchor !== null && !visibleAddress(anchor, snapshot)) {
    anchor = ranges[0]?.start ?? null;
    changed = true;
  }
  if (!changed) return selection;
  return Object.freeze({
    ...selection,
    rows,
    ranges: Object.freeze(ranges),
    anchor,
  });
}
