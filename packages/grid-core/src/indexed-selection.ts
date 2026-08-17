import type {
  PretableChangeSequence,
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import type {
  PretableIndexedCellAddress,
  PretableIndexedCellRange,
  PretableIndexedCellSelectionSummary,
  PretableIndexedDatasetRowSpan,
  PretableIndexedEvictionContext,
  PretableIndexedRowRange,
  PretableIndexedRowRangeIndex,
  PretableIndexedRowSelection,
  PretableIndexedSelectionState,
  PretableIndexedSelectionSummary,
  PretableIndexedSelectionWindow,
  PretableRowSelectionState,
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
  const rows = attachRowSelectionProgram(
    Object.freeze({
      kind: "explicit" as const,
      rowIds: toImmutableIndexedSet<TRowId>(),
    }),
    Object.freeze({
      baseSelected: false,
      sequence: 0,
      points: null,
      layers: Object.freeze([]),
    }),
  );
  return Object.freeze({
    rows,
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
    (selection.rows.excludedRanges?.size ?? 0) === 0 &&
    selection.ranges.length === 0 &&
    selection.anchor === null
  )
    return selection;
  const program: RowSelectionProgram<TRowId> = Object.freeze({
    baseSelected: true,
    sequence: 0,
    points: null,
    layers: Object.freeze([]),
    projection: Object.freeze({
      snapshot: snapshot as SelectionSnapshot<TRowId>,
      runs: singletonRun(true, snapshot.visibleDataRowCount),
    }),
  });
  const rows = attachRowSelectionProgram(
    Object.freeze({ kind: "all" as const }),
    program,
  );
  return Object.freeze({
    ...selection,
    rows,
    ranges: Object.freeze([]),
    anchor: null,
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
  const program = rowSelectionProgram(selection, snapshot);
  const selected = semanticRowSelected(program, rowId);
  const sequence = program.sequence + 1;
  const projection = projectionFor(
    program,
    snapshot as SelectionSnapshot<TRowId>,
  );
  const rank = snapshot.dataIndexOf(dataRef(rowId));
  const nextProgram: RowSelectionProgram<TRowId> = Object.freeze({
    ...program,
    sequence,
    points: setPointRule(program.points, {
      rowId,
      sequence,
      selected: !selected,
    }),
    projection: Object.freeze({
      snapshot: snapshot as SelectionSnapshot<TRowId>,
      runs: assignRunRange(projection.runs, rank, rank + 1, !selected),
    }),
  });
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
    if (selected) {
      rowIds.delete(rowId);
      if (selectedByRange)
        excludedRanges = insertExcludedPoint(excludedRanges, point);
      else excludedRanges = removeExcludedSpan(excludedRanges, point);
    } else {
      excludedRanges = removeExcludedSpan(excludedRanges, point);
      rowIds.add(rowId);
    }
    const rows = attachRowSelectionProgram(
      Object.freeze({
        kind: "explicit" as const,
        rowIds: toImmutableIndexedSet(rowIds),
        ...(rangeIndex.size === 0 ? {} : { ranges: rangeIndex }),
        ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
      }),
      nextProgram,
    );
    return Object.freeze({
      ...selection,
      rows,
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
  const rows = attachRowSelectionProgram(
    Object.freeze({
      kind: "all" as const,
      ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
    }),
    nextProgram,
  );
  return Object.freeze({
    ...selection,
    rows,
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

interface PointRule<TRowId extends PretableRowId> {
  readonly rowId: TRowId;
  readonly sequence: number;
  readonly selected: boolean;
}

interface PointRuleNode<
  TRowId extends PretableRowId,
> extends PointRule<TRowId> {
  readonly left: PointRuleNode<TRowId> | null;
  readonly right: PointRuleNode<TRowId> | null;
  readonly height: number;
}

function compareRowIds(left: PretableRowId, right: PretableRowId): number {
  if (sameRowId(left, right)) return 0;
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
  if (typeof left === "number" && typeof right === "number") {
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left < right ? -1 : 1;
  }
  return (left as string) < (right as string) ? -1 : 1;
}

function pointHeight<TRowId extends PretableRowId>(
  node: PointRuleNode<TRowId> | null,
): number {
  return node?.height ?? 0;
}

function makePointNode<TRowId extends PretableRowId>(
  rule: PointRule<TRowId>,
  left: PointRuleNode<TRowId> | null = null,
  right: PointRuleNode<TRowId> | null = null,
): PointRuleNode<TRowId> {
  return Object.freeze({
    ...rule,
    left,
    right,
    height: Math.max(pointHeight(left), pointHeight(right)) + 1,
  });
}

function balancePointNode<TRowId extends PretableRowId>(
  node: PointRuleNode<TRowId>,
): PointRuleNode<TRowId> {
  const balance = pointHeight(node.left) - pointHeight(node.right);
  if (balance > 1 && node.left !== null) {
    let left = node.left;
    if (
      pointHeight(left.left) < pointHeight(left.right) &&
      left.right !== null
    ) {
      const pivot = left.right;
      left = makePointNode(
        pivot,
        makePointNode(left, left.left, pivot.left),
        pivot.right,
      );
    }
    return makePointNode(
      left,
      left.left,
      makePointNode(node, left.right, node.right),
    );
  }
  if (balance < -1 && node.right !== null) {
    let right = node.right;
    if (
      pointHeight(right.right) < pointHeight(right.left) &&
      right.left !== null
    ) {
      const pivot = right.left;
      right = makePointNode(
        pivot,
        pivot.left,
        makePointNode(right, pivot.right, right.right),
      );
    }
    return makePointNode(
      right,
      makePointNode(node, node.left, right.left),
      right.right,
    );
  }
  return node;
}

function setPointRule<TRowId extends PretableRowId>(
  root: PointRuleNode<TRowId> | null,
  rule: PointRule<TRowId>,
): PointRuleNode<TRowId> {
  if (root === null) return makePointNode(rule);
  const comparison = compareRowIds(rule.rowId, root.rowId);
  if (comparison === 0) return makePointNode(rule, root.left, root.right);
  return comparison < 0
    ? balancePointNode(
        makePointNode(root, setPointRule(root.left, rule), root.right),
      )
    : balancePointNode(
        makePointNode(root, root.left, setPointRule(root.right, rule)),
      );
}

function getPointRule<TRowId extends PretableRowId>(
  root: PointRuleNode<TRowId> | null,
  rowId: TRowId,
): PointRule<TRowId> | undefined {
  let current = root;
  while (current !== null) {
    const comparison = compareRowIds(rowId, current.rowId);
    if (comparison === 0) return current;
    current = comparison < 0 ? current.left : current.right;
  }
  return undefined;
}

interface RangeRuleNode {
  readonly lo: number;
  readonly hi: number;
  readonly sequence: number;
  readonly left: RangeRuleNode | null;
  readonly right: RangeRuleNode | null;
  readonly height: number;
  readonly maxHi: number;
  readonly maxSequence: number;
}

function ruleHeight(node: RangeRuleNode | null): number {
  return node?.height ?? 0;
}

function makeRuleNode(
  rule: Pick<RangeRuleNode, "lo" | "hi" | "sequence">,
  left: RangeRuleNode | null = null,
  right: RangeRuleNode | null = null,
): RangeRuleNode {
  return Object.freeze({
    lo: rule.lo,
    hi: rule.hi,
    sequence: rule.sequence,
    left,
    right,
    height: Math.max(ruleHeight(left), ruleHeight(right)) + 1,
    maxHi: Math.max(rule.hi, left?.maxHi ?? -1, right?.maxHi ?? -1),
    maxSequence: Math.max(
      rule.sequence,
      left?.maxSequence ?? -1,
      right?.maxSequence ?? -1,
    ),
  });
}

function balanceRuleNode(node: RangeRuleNode): RangeRuleNode {
  const balance = ruleHeight(node.left) - ruleHeight(node.right);
  if (balance > 1 && node.left !== null) {
    let left = node.left;
    if (ruleHeight(left.left) < ruleHeight(left.right) && left.right !== null) {
      const pivot = left.right;
      left = makeRuleNode(
        pivot,
        makeRuleNode(left, left.left, pivot.left),
        pivot.right,
      );
    }
    return makeRuleNode(
      left,
      left.left,
      makeRuleNode(node, left.right, node.right),
    );
  }
  if (balance < -1 && node.right !== null) {
    let right = node.right;
    if (
      ruleHeight(right.right) < ruleHeight(right.left) &&
      right.left !== null
    ) {
      const pivot = right.left;
      right = makeRuleNode(
        pivot,
        pivot.left,
        makeRuleNode(right, pivot.right, right.right),
      );
    }
    return makeRuleNode(
      right,
      makeRuleNode(node, node.left, right.left),
      right.right,
    );
  }
  return node;
}

function insertRuleNode(
  root: RangeRuleNode | null,
  rule: Pick<RangeRuleNode, "lo" | "hi" | "sequence">,
): RangeRuleNode {
  if (root === null) return makeRuleNode(rule);
  return rule.lo < root.lo
    ? balanceRuleNode(
        makeRuleNode(root, insertRuleNode(root.left, rule), root.right),
      )
    : balanceRuleNode(
        makeRuleNode(root, root.left, insertRuleNode(root.right, rule)),
      );
}

function findIntersectingRule(
  root: RangeRuleNode | null,
  lo: number,
  hi: number,
): RangeRuleNode | undefined {
  if (root === null) return undefined;
  if (root.left !== null && root.left.maxHi >= lo) {
    const left = findIntersectingRule(root.left, lo, hi);
    if (left !== undefined) return left;
  }
  if (root.lo <= hi && root.hi >= lo) return root;
  return root.lo > hi ? undefined : findIntersectingRule(root.right, lo, hi);
}

function minimumRuleNode(root: RangeRuleNode): RangeRuleNode {
  let current = root;
  while (current.left !== null) current = current.left;
  return current;
}

function removeRuleNode(
  root: RangeRuleNode | null,
  lo: number,
): RangeRuleNode | null {
  if (root === null) return null;
  if (lo < root.lo)
    return balanceRuleNode(
      makeRuleNode(root, removeRuleNode(root.left, lo), root.right),
    );
  if (lo > root.lo)
    return balanceRuleNode(
      makeRuleNode(root, root.left, removeRuleNode(root.right, lo)),
    );
  if (root.left === null) return root.right;
  if (root.right === null) return root.left;
  const successor = minimumRuleNode(root.right);
  return balanceRuleNode(
    makeRuleNode(
      successor,
      root.left,
      removeRuleNode(root.right, successor.lo),
    ),
  );
}

function concatenateRuleTrees(
  left: RangeRuleNode | null,
  right: RangeRuleNode | null,
): RangeRuleNode | null {
  if (left === null) return right;
  if (right === null) return left;
  if (ruleHeight(left) > ruleHeight(right) + 1)
    return balanceRuleNode(
      makeRuleNode(left, left.left, concatenateRuleTrees(left.right, right)),
    );
  if (ruleHeight(right) > ruleHeight(left) + 1)
    return balanceRuleNode(
      makeRuleNode(right, concatenateRuleTrees(left, right.left), right.right),
    );
  const successor = minimumRuleNode(right);
  return balanceRuleNode(
    makeRuleNode(successor, left, removeRuleNode(right, successor.lo)),
  );
}

function splitRuleTree(
  root: RangeRuleNode | null,
  rank: number,
): readonly [RangeRuleNode | null, RangeRuleNode | null] {
  if (root === null) return [null, null];
  if (rank <= root.lo) {
    const [left, right] = splitRuleTree(root.left, rank);
    return [
      left,
      concatenateRuleTrees(right, makeRuleNode(root, null, root.right)),
    ];
  }
  if (rank > root.hi) {
    const [left, right] = splitRuleTree(root.right, rank);
    return [
      concatenateRuleTrees(makeRuleNode(root, root.left, null), left),
      right,
    ];
  }
  return [
    concatenateRuleTrees(
      root.left,
      makeRuleNode({ lo: root.lo, hi: rank - 1, sequence: root.sequence }),
    ),
    concatenateRuleTrees(
      makeRuleNode({ lo: rank, hi: root.hi, sequence: root.sequence }),
      root.right,
    ),
  ];
}

function assignRuleRange(
  root: RangeRuleNode | null,
  lo: number,
  hi: number,
  sequence: number,
): RangeRuleNode {
  if (findIntersectingRule(root, lo, hi) === undefined)
    return insertRuleNode(root, { lo, hi, sequence });
  const [left, fromLo] = splitRuleTree(root, lo);
  const [, right] = splitRuleTree(fromLo, hi + 1);
  return concatenateRuleTrees(
    left,
    concatenateRuleTrees(makeRuleNode({ lo, hi, sequence }), right),
  )!;
}

function newestRuleAt(
  root: RangeRuleNode | null,
  rank: number,
  best = -1,
): number {
  if (root === null || root.maxHi < rank || root.maxSequence <= best)
    return best;
  let next = best;
  if (root.left !== null) next = newestRuleAt(root.left, rank, next);
  if (root.lo <= rank && rank <= root.hi && root.sequence > next)
    next = root.sequence;
  if (root.lo <= rank && root.right !== null)
    next = newestRuleAt(root.right, rank, next);
  return next;
}

type SelectionSnapshot<TRowId extends PretableRowId> = PretableRowModelSnapshot<
  object,
  TRowId,
  unknown
>;

interface SemanticRangeLayer<TRowId extends PretableRowId> {
  readonly snapshot: SelectionSnapshot<TRowId>;
  readonly rules: RangeRuleNode | null;
}

interface RunNode {
  readonly selected: boolean;
  readonly length: number;
  readonly left: RunNode | null;
  readonly right: RunNode | null;
  readonly height: number;
  readonly totalLength: number;
  readonly selectedCount: number;
}

function runHeight(node: RunNode | null): number {
  return node?.height ?? 0;
}

function makeRunNode(
  selected: boolean,
  length: number,
  left: RunNode | null = null,
  right: RunNode | null = null,
): RunNode {
  return Object.freeze({
    selected,
    length,
    left,
    right,
    height: Math.max(runHeight(left), runHeight(right)) + 1,
    totalLength: length + (left?.totalLength ?? 0) + (right?.totalLength ?? 0),
    selectedCount:
      (selected ? length : 0) +
      (left?.selectedCount ?? 0) +
      (right?.selectedCount ?? 0),
  });
}

function singletonRun(selected: boolean, length: number): RunNode | null {
  return length === 0 ? null : makeRunNode(selected, length);
}

function joinRunTrees(
  left: RunNode | null,
  middle: RunNode,
  right: RunNode | null,
): RunNode {
  if (runHeight(left) > runHeight(right) + 1 && left !== null) {
    return makeRunNode(
      left.selected,
      left.length,
      left.left,
      joinRunTrees(left.right, middle, right),
    );
  }
  if (runHeight(right) > runHeight(left) + 1 && right !== null) {
    return makeRunNode(
      right.selected,
      right.length,
      joinRunTrees(left, middle, right.left),
      right.right,
    );
  }
  return makeRunNode(middle.selected, middle.length, left, right);
}

function extractMinimumRun(root: RunNode): readonly [RunNode, RunNode | null] {
  if (root.left === null) return [root, root.right];
  const [minimum, left] = extractMinimumRun(root.left);
  return [minimum, makeRunNode(root.selected, root.length, left, root.right)];
}

function concatRunTreesRaw(
  left: RunNode | null,
  right: RunNode | null,
): RunNode | null {
  if (left === null) return right;
  if (right === null) return left;
  const [minimum, remaining] = extractMinimumRun(right);
  return joinRunTrees(left, minimum, remaining);
}

function splitRunTree(
  root: RunNode | null,
  index: number,
): readonly [RunNode | null, RunNode | null] {
  if (root === null) return [null, null];
  const leftLength = root.left?.totalLength ?? 0;
  if (index < leftLength) {
    const [left, right] = splitRunTree(root.left, index);
    return [
      left,
      joinRunTrees(right, makeRunNode(root.selected, root.length), root.right),
    ];
  }
  if (index > leftLength + root.length) {
    const [left, right] = splitRunTree(
      root.right,
      index - leftLength - root.length,
    );
    return [
      joinRunTrees(root.left, makeRunNode(root.selected, root.length), left),
      right,
    ];
  }
  const ownOffset = index - leftLength;
  const leftOwn = singletonRun(root.selected, ownOffset);
  const rightOwn = singletonRun(root.selected, root.length - ownOffset);
  return [
    concatRunTreesRaw(root.left, leftOwn),
    concatRunTreesRaw(rightOwn, root.right),
  ];
}

function assignRunRange(
  root: RunNode | null,
  start: number,
  end: number,
  selected: boolean,
): RunNode | null {
  const [left, rest] = splitRunTree(root, start);
  const [, right] = splitRunTree(rest, Math.max(0, end - start));
  return concatRunTreesRaw(
    concatRunTreesRaw(left, singletonRun(selected, Math.max(0, end - start))),
    right,
  );
}

function removeRunAt(root: RunNode | null, index: number): RunNode | null {
  const [left, rest] = splitRunTree(root, index);
  const [, right] = splitRunTree(rest, 1);
  return concatRunTreesRaw(left, right);
}

function insertRunAt(
  root: RunNode | null,
  index: number,
  selected: boolean,
): RunNode | null {
  const [left, right] = splitRunTree(root, index);
  return concatRunTreesRaw(
    concatRunTreesRaw(left, singletonRun(selected, 1)),
    right,
  );
}

interface SelectionProjection<TRowId extends PretableRowId> {
  readonly snapshot: SelectionSnapshot<TRowId>;
  readonly runs: RunNode | null;
}

interface RowSelectionProgram<TRowId extends PretableRowId> {
  readonly baseSelected: boolean;
  readonly sequence: number;
  readonly points: PointRuleNode<TRowId> | null;
  readonly layers: readonly SemanticRangeLayer<TRowId>[];
  readonly projection?: SelectionProjection<TRowId>;
}

const rowSelectionPrograms = new WeakMap<
  object,
  RowSelectionProgram<PretableRowId>
>();

function attachRowSelectionProgram<
  TRowId extends PretableRowId,
  TRows extends object,
>(rows: TRows, program: RowSelectionProgram<TRowId>): TRows {
  rowSelectionPrograms.set(rows, program as RowSelectionProgram<PretableRowId>);
  return rows;
}

function semanticRowSelected<TRowId extends PretableRowId>(
  program: RowSelectionProgram<TRowId>,
  rowId: TRowId,
): boolean {
  let sequence = 0;
  let selected = program.baseSelected;
  const point = getPointRule(program.points, rowId);
  if (point !== undefined) {
    sequence = point.sequence;
    selected = point.selected;
  }
  for (const layer of program.layers) {
    const rank = layer.snapshot.dataIndexOf(dataRef(rowId));
    if (rank < 0) continue;
    const rangeSequence = newestRuleAt(layer.rules, rank, sequence);
    if (rangeSequence > sequence) {
      sequence = rangeSequence;
      selected = true;
    }
  }
  return selected;
}

function buildProjection<TRowId extends PretableRowId>(
  program: RowSelectionProgram<TRowId>,
  snapshot: SelectionSnapshot<TRowId>,
): SelectionProjection<TRowId> {
  // This is the explicit reset path: arbitrary replacement/permutation has no
  // sublinear intersection answer in the public snapshot contract. Stream the
  // target once into compressed runs; never allocate the selected ID set.
  if (program.sequence === 0) {
    return Object.freeze({
      snapshot,
      runs: singletonRun(program.baseSelected, snapshot.visibleDataRowCount),
    });
  }
  let runs: RunNode | null = null;
  let currentValue: boolean | undefined;
  let currentLength = 0;
  const flush = () => {
    if (currentValue !== undefined && currentLength > 0)
      runs = concatRunTreesRaw(runs, singletonRun(currentValue, currentLength));
  };
  for (let index = 0; index < snapshot.visibleDataRowCount; index += 1) {
    const row = snapshot.dataRowAt(index);
    if (row === undefined) continue;
    const selected = semanticRowSelected(program, row.rowId);
    if (selected === currentValue) currentLength += 1;
    else {
      flush();
      currentValue = selected;
      currentLength = 1;
    }
  }
  flush();
  return Object.freeze({ snapshot, runs });
}

function projectionFor<TRowId extends PretableRowId>(
  program: RowSelectionProgram<TRowId>,
  snapshot: SelectionSnapshot<TRowId>,
): SelectionProjection<TRowId> {
  return program.projection?.snapshot === snapshot
    ? program.projection
    : buildProjection(program, snapshot);
}

function addSemanticRange<TRowId extends PretableRowId>(
  program: RowSelectionProgram<TRowId>,
  snapshot: SelectionSnapshot<TRowId>,
  lo: number,
  hi: number,
  sequence: number,
): RowSelectionProgram<TRowId> {
  const layerIndex = program.layers.findIndex(
    (layer) => layer.snapshot === snapshot,
  );
  const layers = Array.from(program.layers);
  if (layerIndex < 0) {
    layers.push(
      Object.freeze({
        snapshot,
        rules: assignRuleRange(null, lo, hi, sequence),
      }),
    );
  } else {
    const layer = layers[layerIndex]!;
    layers[layerIndex] = Object.freeze({
      snapshot,
      rules: assignRuleRange(layer.rules, lo, hi, sequence),
    });
  }
  return Object.freeze({
    ...program,
    sequence,
    layers: Object.freeze(layers),
  });
}

function rowSelectionProgram<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): RowSelectionProgram<TRowId> {
  const existing = rowSelectionPrograms.get(selection.rows);
  if (existing !== undefined) return existing as RowSelectionProgram<TRowId>;
  let program: RowSelectionProgram<TRowId> = Object.freeze({
    baseSelected: selection.rows.kind === "all",
    sequence: 0,
    points: null,
    layers: Object.freeze([]),
  });
  if (selection.rows.kind === "explicit") {
    for (const rowId of selection.rows.rowIds) {
      const sequence = program.sequence + 1;
      program = Object.freeze({
        ...program,
        sequence,
        points: setPointRule(program.points, {
          rowId,
          sequence,
          selected: true,
        }),
      });
    }
    for (const range of selection.rows.ranges ?? []) {
      const resolved = resolvedRowRange(range, snapshot);
      if (resolved === undefined) continue;
      program = addSemanticRange(
        program,
        snapshot as SelectionSnapshot<TRowId>,
        resolved.lo,
        resolved.hi,
        program.sequence + 1,
      );
    }
  }
  for (const range of selection.rows.excludedRanges ?? []) {
    for (const rowId of [range.startRowId, range.endRowId]) {
      const sequence = program.sequence + 1;
      program = Object.freeze({
        ...program,
        sequence,
        points: setPointRule(program.points, {
          rowId,
          sequence,
          selected: false,
        }),
      });
    }
  }
  rowSelectionPrograms.set(
    selection.rows,
    program as RowSelectionProgram<PretableRowId>,
  );
  return program;
}

function cloneRowsWithProgram<TRowId extends PretableRowId>(
  rows: PretableIndexedSelectionState<TRowId, string>["rows"],
  program: RowSelectionProgram<TRowId>,
): typeof rows {
  const clone =
    rows.kind === "explicit"
      ? Object.freeze({
          kind: "explicit" as const,
          rowIds: rows.rowIds,
          ...(rows.ranges === undefined ? {} : { ranges: rows.ranges }),
          ...(rows.excludedRanges === undefined
            ? {}
            : { excludedRanges: rows.excludedRanges }),
        })
      : Object.freeze({
          kind: "all" as const,
          ...(rows.excludedRanges === undefined
            ? {}
            : { excludedRanges: rows.excludedRanges }),
        });
  return attachRowSelectionProgram(clone, program);
}

/** @internal Preserves the semantic row-selection program across defensive copies. */
export function preserveIndexedRowSelectionProgram<
  TRowId extends PretableRowId,
  TColumnId extends string,
>(
  source: PretableIndexedSelectionState<TRowId, TColumnId>["rows"],
  target: PretableIndexedSelectionState<TRowId, TColumnId>["rows"],
): void {
  const program = rowSelectionPrograms.get(source);
  if (program !== undefined) rowSelectionPrograms.set(target, program);
}

/** @internal Releases snapshot bases retained only by a disposed grid state. */
export function releaseIndexedRowSelectionProgram(rows: object): void {
  rowSelectionPrograms.delete(rows);
}

/** @internal Distinguishes identical public projections with different semantic histories. */
export function sameIndexedRowSelectionProgram(
  left: object,
  right: object,
): boolean {
  const leftProgram = rowSelectionPrograms.get(left);
  const rightProgram = rowSelectionPrograms.get(right);
  if (leftProgram === rightProgram) return true;
  const canonical = (
    rows: object,
    program: RowSelectionProgram<PretableRowId> | undefined,
  ) => {
    if (program === undefined) return true;
    const kind = (rows as { readonly kind?: unknown }).kind;
    return (
      program.sequence === 0 &&
      program.points === null &&
      program.layers.length === 0 &&
      program.baseSelected === (kind === "all")
    );
  };
  return canonical(left, leftProgram) && canonical(right, rightProgram);
}

function countPointRules(root: PointRuleNode<PretableRowId> | null): number {
  return root === null
    ? 0
    : 1 + countPointRules(root.left) + countPointRules(root.right);
}

function countRangeRules(root: RangeRuleNode | null): number {
  return root === null
    ? 0
    : 1 + countRangeRules(root.left) + countRangeRules(root.right);
}

function countRuns(root: RunNode | null): number {
  return root === null ? 0 : 1 + countRuns(root.left) + countRuns(root.right);
}

/** @internal Retention diagnostics for semantic-selection regression tests. */
export function getIndexedRowSelectionProgramDiagnostics(rows: object) {
  const program = rowSelectionPrograms.get(rows);
  return Object.freeze({
    pointRuleCount: countPointRules(program?.points ?? null),
    rangeRuleCount: (program?.layers ?? []).reduce(
      (count, layer) => count + countRangeRules(layer.rules),
      0,
    ),
    snapshotBasisCount: program?.layers.length ?? 0,
    projectionRunCount: countRuns(program?.projection?.runs ?? null),
  });
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
    !exclusionIndexes.has(ranges) &&
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
  const program = rowSelectionProgram(selection, snapshot);
  const sequence = program.sequence + 1;
  const projection = projectionFor(
    program,
    snapshot as SelectionSnapshot<TRowId>,
  );
  const nextProgram = Object.freeze({
    ...addSemanticRange(
      program,
      snapshot as SelectionSnapshot<TRowId>,
      resolvedNext.lo,
      resolvedNext.hi,
      sequence,
    ),
    projection: Object.freeze({
      snapshot: snapshot as SelectionSnapshot<TRowId>,
      runs: assignRunRange(
        projection.runs,
        resolvedNext.lo,
        resolvedNext.hi + 1,
        true,
      ),
    }),
  });
  if (selection.rows.kind === "all") {
    const excludedRanges = removeExcludedSpan(
      currentExclusionIndex(selection.rows.excludedRanges, snapshot),
      resolvedNext,
    );
    const rows = attachRowSelectionProgram(
      Object.freeze({
        kind: "all" as const,
        ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
      }),
      nextProgram,
    );
    return Object.freeze({
      ...selection,
      rows,
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
  const rows = attachRowSelectionProgram(
    Object.freeze({
      kind: "explicit" as const,
      rowIds: selection.rows.rowIds,
      ranges,
      ...(excludedRanges.size === 0 ? {} : { excludedRanges }),
    }),
    nextProgram,
  );
  return Object.freeze({
    ...selection,
    rows,
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
  return semanticRowSelected(
    rowSelectionProgram(selection, snapshot),
    ref.rowId,
  );
}

/**
 * Build the engine's row-checkbox slice from the shape a consumer can write.
 *
 * Deliberately assembled out of the same primitives a USER's gestures go
 * through — `selectAllVisibleRows`, `toggleIndexedRowSelection`,
 * `selectIndexedRowRange` — rather than by hand-rolling a second constructor
 * for the semantic program. A hand-rolled one would be a second definition of
 * what a selection means, free to drift from the gesture path it is supposed to
 * be interchangeable with, and it would have to reproduce the incremental
 * projection maintenance that keeps each of these sublinear.
 *
 * Cost is therefore O(k log n) in the SIZE OF THE REQUEST, never in the row
 * count: `{ kind: "all" }` alone runs one `selectAllVisibleRows`, which records
 * "everything" as a single run and visits no rows at all.
 *
 * Ids the current snapshot does not show are dropped, because that is what
 * ticking them by hand would do — the same rule `state.focus` and the cell
 * ranges already follow.
 */
export function createIndexedRowSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  requested: PretableRowSelectionState<TRowId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedRowSelection<TRowId> {
  let selection = createEmptyIndexedSelection<TRowId, string>();
  if (requested.kind === "all") {
    selection = selectAllVisibleRows(selection, snapshot);
  } else {
    // A Set because `toggleIndexedRowSelection` toggles: a repeated id would
    // tick the row and then untick it again.
    for (const rowId of new Set(requested.rowIds)) {
      selection = toggleIndexedRowSelection(selection, rowId, snapshot);
    }
    for (const range of requested.ranges ?? []) {
      selection = selectIndexedRowRange(
        selection,
        range.startRowId,
        range.endRowId,
        snapshot,
      );
    }
  }
  for (const rowId of new Set(requested.excludedRowIds)) {
    // Only rows the request actually selected can be excluded from it. Without
    // this guard the toggle would SELECT an unselected id, turning "everything
    // except row 7" into "everything, plus row 7" the moment row 7 was not
    // covered in the first place.
    if (!isIndexedRowSelected(selection, dataRef(rowId), snapshot)) continue;
    selection = toggleIndexedRowSelection(selection, rowId, snapshot);
  }
  return selection.rows;
}

/**
 * Render the engine's row-checkbox slice as the shape a consumer can write
 * back — the inverse of {@link createIndexedRowSelection}.
 *
 * Sparse in, sparse out. A symbolic "all" stays two words, and a shift-checked
 * 100k-row span stays its two endpoint ids; nothing here walks a population.
 *
 * @public
 */
export function describeRowSelection<TRowId extends PretableRowId>(
  rows: PretableIndexedRowSelection<TRowId>,
): PretableRowSelectionState<TRowId> {
  // Exclusions are stored as degenerate ranges — `insertExcludedPoint` is the
  // only thing that ever adds one — so reading both endpoints costs nothing and
  // survives any future widening rather than silently halving it.
  const excluded = new Set<TRowId>();
  for (const range of rows.excludedRanges ?? []) {
    excluded.add(range.startRowId);
    excluded.add(range.endRowId);
  }
  const excludedRowIds =
    excluded.size === 0 ? {} : { excludedRowIds: Object.freeze([...excluded]) };
  if (rows.kind === "all") {
    return Object.freeze({ kind: "all" as const, ...excludedRowIds });
  }
  const ranges = [...(rows.ranges ?? [])].map((range) =>
    Object.freeze({ startRowId: range.startRowId, endRowId: range.endRowId }),
  );
  return Object.freeze({
    kind: "explicit" as const,
    rowIds: Object.freeze([...rows.rowIds]),
    ...(ranges.length === 0 ? {} : { ranges: Object.freeze(ranges) }),
    ...excludedRowIds,
  });
}

/**
 * @internal Structural equality for the row-checkbox slice, ignoring the
 * semantic program attached to it.
 *
 * `sameSelection` cannot answer this question: it short-circuits on
 * `sameIndexedRowSelectionProgram`, which compares HISTORIES and so calls two
 * independently-built selections different even when they tick the same rows.
 * That is the right answer for a gesture (an "all"-derived selection and an
 * identical explicit one behave differently as rows arrive) and the wrong one
 * for an idempotence check, where the question is only whether applying this
 * value would change anything a reader can see.
 */
export function sameIndexedRowSelectionValue<TRowId extends PretableRowId>(
  left: PretableIndexedRowSelection<TRowId>,
  right: PretableIndexedRowSelection<TRowId>,
): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  if (!sameRowRangeIndex(left.excludedRanges, right.excludedRanges))
    return false;
  if (left.kind !== "explicit" || right.kind !== "explicit") return true;
  if (left.rowIds.size !== right.rowIds.size) return false;
  for (const rowId of left.rowIds) {
    if (!right.rowIds.has(rowId)) return false;
  }
  return sameRowRangeIndex(left.ranges, right.ranges);
}

function sameRowRangeIndex<TRowId extends PretableRowId>(
  left: PretableIndexedRowRangeIndex<TRowId> | undefined,
  right: PretableIndexedRowRangeIndex<TRowId> | undefined,
): boolean {
  if (left === right) return true;
  if ((left?.size ?? 0) !== (right?.size ?? 0)) return false;
  const leftRanges = [...(left ?? [])];
  const rightRanges = [...(right ?? [])];
  return leftRanges.every((range, index) => {
    const other = rightRanges[index];
    return (
      other !== undefined &&
      sameRowId(range.startRowId, other.startRowId) &&
      sameRowId(range.endRowId, other.endRowId)
    );
  });
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
  const selectedCount =
    projectionFor(
      rowSelectionProgram(selection, snapshot),
      snapshot as SelectionSnapshot<TRowId>,
    ).runs?.selectedCount ?? 0;
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

/**
 * `rowId`'s absolute DATASET position, or `-1` when the row is not loaded.
 *
 * With `loadedWindow` null this is the plain data-only rank every
 * pre-eviction caller already compared against, so a local-mode grid keeps
 * arithmetic that is byte-for-byte what it was. With a window it is the rank
 * shifted into dataset coordinates, which is the only space in which a span
 * still means something once its rows are gone.
 *
 * Data-only rank, not `indexOf`: group headers occupy visible indices but no
 * dataset position, and the window is a dataset span. The two orderings agree
 * on data rows — both are monotonic in visible order — so containment answers
 * identically for the cells this function is ever asked about.
 */
function datasetPosition<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  rowId: TRowId,
  loadedWindow: PretableIndexedSelectionWindow | null,
): number {
  const rank = snapshot.dataIndexOf(dataRef(rowId));
  if (rank < 0) return -1;
  return (loadedWindow?.start ?? 0) + rank;
}

interface ResolvedDatasetSpan {
  readonly lo: number;
  readonly hi: number;
  /** Both endpoints were loaded, so `lo`/`hi` describe rows proven present. */
  readonly verified: boolean;
}

/**
 * Whether `span`'s remembered positions may be read against `window`.
 *
 * FAIL-CLOSED, and deliberately so. Matching keys mean the same population,
 * so the positions still name the same rows. A different key means a re-sort
 * or a filter change has re-filled those positions with other rows entirely.
 * And an ABSENT key on either side is not a match — it is the absence of any
 * evidence about the population, which is the same situation as a mismatch
 * and must be refused for the same reason.
 *
 * Treating "no key on both sides" as agreement fails OPEN, and the failure is
 * not a downgraded number, it is wrong paint: a windowed consumer who simply
 * never heard of `datasetKey` (it is optional, and nothing in the type says it
 * is load-bearing) re-sorts, one endpoint survives at a new position, and
 * `indexedRangeContainsCell` — which returns a bare boolean and has no
 * `verified` channel to downgrade through — reports `true` for rows the user
 * never selected. Measured: selection `row-10..row-40` under window
 * `[0, 100)`, re-sorted to `[30, 130)`, painted a row that had never been in
 * the selection.
 *
 * The cost of closing it is that a windowed consumer publishing no
 * `datasetKey` loses span survival across eviction and degrades to
 * loaded-rows-only — visibly, in the `verified` flag and the count, rather
 * than invisibly, in the wrong cells. `warnMissingDatasetKey` tells them.
 *
 * Local mode is untouched: with no window there is no span to read in the
 * first place (see `endpointPositions`).
 *
 * ## The population is a second question, and the key does not answer it
 *
 * `datasetKey` identifies the QUERY. `lifecycle.mdx` tells consumers to keep
 * it stable while they page within one result, so an insert or a delete made
 * upstream of an evicted selection leaves the key matching while re-filling
 * the remembered positions with entirely different rows. Measured:
 * `row-1..row-8` selected and evicted, five rows prepended to the same
 * result, and the returning window painted four rows that did not exist when
 * the user selected — while the eight they did select painted nothing.
 *
 * So the size of the population is compared too, and it fails closed the same
 * way. `provenDeletions` is the one allowance: rows this very call has
 * PROVEN gone are a population change the engine observed, so a total short
 * by exactly that many is fully accounted for rather than unexplained. Only
 * {@link narrowDeletedEndpoints} passes a non-zero value; every reader that
 * merely wants to trust a remembered position uses the strict form.
 */
function spanReadableInWindow(
  span: PretableIndexedDatasetRowSpan,
  window: PretableIndexedSelectionWindow,
  provenDeletions = 0,
): boolean {
  return (
    window.datasetKey !== undefined &&
    span.datasetKey === window.datasetKey &&
    span.datasetTotal !== undefined &&
    window.datasetTotal === span.datasetTotal - provenDeletions
  );
}

/**
 * Whether `window` can carry dataset spans at all. A window with no
 * `datasetKey` cannot: anything stamped under it could never be read back
 * (see {@link spanReadableInWindow}), so stamping one would only emit a
 * number through `onSelectionChange` that the engine itself refuses.
 */
function windowCarriesSpans(
  window: PretableIndexedSelectionWindow | null,
): window is PretableIndexedSelectionWindow & { readonly datasetKey: string } {
  return window !== null && window.datasetKey !== undefined;
}

/**
 * Where `range`'s endpoints sit in the dataset, per endpoint, preferring what
 * the snapshot can confirm right now over what the range remembers.
 *
 * `undefined` for an endpoint means neither source could answer.
 */
function endpointPositions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow: PretableIndexedSelectionWindow | null,
): {
  readonly start: number | undefined;
  readonly end: number | undefined;
  readonly bothLive: boolean;
} {
  const liveStart = datasetPosition(snapshot, range.start.rowId, loadedWindow);
  const liveEnd = datasetPosition(snapshot, range.end.rowId, loadedWindow);
  const bothLive = liveStart >= 0 && liveEnd >= 0;
  if (bothLive) return { start: liveStart, end: liveEnd, bothLive };
  // Pre-eviction callers never carry a span and never supply a window. With
  // no window there is no dataset coordinate system to remember positions in,
  // so a half-resolved range answers nothing at all — byte-for-byte what it
  // did before eviction existed.
  if (loadedWindow === null)
    return { start: undefined, end: undefined, bothLive };
  const remembered =
    range.datasetRowSpan !== undefined &&
    spanReadableInWindow(range.datasetRowSpan, loadedWindow)
      ? range.datasetRowSpan
      : undefined;
  return {
    start: liveStart >= 0 ? liveStart : remembered?.start,
    end: liveEnd >= 0 ? liveEnd : remembered?.end,
    bothLive,
  };
}

/**
 * The dataset positions `range` covers, ordered.
 *
 * The remembered half is the whole point of eviction: an endpoint that is
 * merely evicted still has a dataset position recorded on the range, and
 * `hi - lo + 1` over it is answerable with zero rows loaded. It is flagged
 * unverified because a row deleted server-side WHILE evicted leaves no trace
 * anywhere the engine can read.
 *
 * A range with ONE endpoint resolvable resolves to the union of what it does
 * know — the live survivor plus the absentee's remembered position, or just
 * the survivor when nothing is remembered. This is the sliding-window case:
 * an ordinary incremental scroll retires one endpoint many revisions before
 * the other, and treating that as "unanswerable" would under-report every
 * scrolled selection by the whole span but one row.
 *
 * `undefined` — neither endpoint resolvable and nothing usable remembered —
 * is genuinely unanswerable, which is different from zero.
 */
function rangeDatasetSpan<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow: PretableIndexedSelectionWindow | null,
): ResolvedDatasetSpan | undefined {
  const { start, end, bothLive } = endpointPositions(
    range,
    snapshot,
    loadedWindow,
  );
  const low = start ?? end;
  const high = end ?? start;
  if (low === undefined || high === undefined) return undefined;
  return {
    lo: Math.min(low, high),
    hi: Math.max(low, high),
    // Both endpoints present is not on its own enough to call the extent
    // proven. Under a window that CAN carry spans, a range without one has no
    // positional identity: reconciliation stripped it, which it only does
    // when it could not locate the range in the current population. The rows
    // it still names really are selected — so it paints — but the extent it
    // reports is a remnant, not what the user chose, and saying otherwise is
    // the same "silent under-count wearing a verified flag" this whole
    // design exists to remove.
    verified:
      bothLive &&
      (!windowCarriesSpans(loadedWindow) || range.datasetRowSpan !== undefined),
  };
}

/**
 * Data rows covered by the CELL-RANGE slice (`selection.ranges`), by
 * arithmetic over spans rather than by visiting rows — so a 4,901-row
 * selection with 30 rows loaded still counts 4,901.
 *
 * Not to be confused with {@link getIndexedSelectionSummary}, which counts
 * the separate sparse row-selection program the checkbox column drives.
 *
 * `loadedWindow` is the same honesty-gated span `reconcileIndexedSelection`
 * takes; omitting it (local mode) restricts the count to what the snapshot
 * can resolve, exactly as before eviction existed.
 */
export function getIndexedCellSelectionSummary<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow?: PretableIndexedSelectionWindow | null,
): PretableIndexedCellSelectionSummary {
  const window = loadedWindow ?? null;
  const spans: ResolvedDatasetSpan[] = [];
  let verified = true;
  for (const range of selection.ranges) {
    const span = rangeDatasetSpan(range, snapshot, window);
    if (span === undefined) {
      // Selects at least one row, at a position nothing can supply. Adding a
      // guess would be the lie; contributing nothing and saying the total is
      // unverified is the most this can honestly do.
      verified = false;
      continue;
    }
    if (!span.verified) verified = false;
    spans.push(span);
  }
  // Union, so two ranges over the same rows report those rows once. Sorting a
  // handful of spans is still O(ranges) in the sense that matters: nothing
  // here scales with how many rows are selected.
  spans.sort((left, right) => left.lo - right.lo);
  let rowCount = 0;
  let covered: number | null = null;
  for (const span of spans) {
    const lo = covered === null || span.lo > covered ? span.lo : covered + 1;
    if (span.hi >= lo) rowCount += span.hi - lo + 1;
    if (covered === null || span.hi > covered) covered = span.hi;
  }
  return Object.freeze({ rowCount, verified });
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
  /**
   * The loaded span, when the honesty gate is passing. Supplying it is what
   * lets a rendered row in the MIDDLE of a range paint while the range's own
   * endpoints are evicted — the case that previously painted nothing at all,
   * because resolving both endpoints was a precondition.
   */
  loadedWindow?: PretableIndexedSelectionWindow | null,
): boolean {
  if (ref.kind !== "data") return false;
  const currentColumnIndex = columnIndex(columns, columnId);
  const startColumnIndex = columnIndex(columns, range.start.columnId);
  const endColumnIndex = columnIndex(columns, range.end.columnId);
  if (
    currentColumnIndex < 0 ||
    startColumnIndex < 0 ||
    endColumnIndex < 0 ||
    currentColumnIndex < Math.min(startColumnIndex, endColumnIndex) ||
    currentColumnIndex > Math.max(startColumnIndex, endColumnIndex)
  ) {
    return false;
  }
  const window = loadedWindow ?? null;
  const rowPosition = datasetPosition(snapshot, ref.rowId, window);
  if (rowPosition < 0) return false;
  const span = rangeDatasetSpan(range, snapshot, window);
  if (span === undefined) return false;
  return rowPosition >= span.lo && rowPosition <= span.hi;
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

function sameRowId(left: PretableRowId, right: PretableRowId): boolean {
  return left === right || (left !== left && right !== right);
}

/** @internal Projects the visible rank cache from exact row-model deltas. */
export function projectIndexedSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  previousSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  sequence: PretableChangeSequence<TRowId>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  const program = rowSelectionProgram(selection, previousSnapshot);
  let projection: SelectionProjection<TRowId>;
  if (
    sequence.kind === "reset" ||
    sequence.fromRevision !== previousSnapshot.revision ||
    sequence.toRevision !== snapshot.revision
  ) {
    projection = buildProjection(
      program,
      snapshot as SelectionSnapshot<TRowId>,
    );
  } else {
    // Routine revisions touch only structural data refs. Removing their old
    // ranks then inserting their final ranks preserves every untouched run and
    // makes work proportional to the journal delta, not ranges or exclusions.
    let runs = projectionFor(
      program,
      previousSnapshot as SelectionSnapshot<TRowId>,
    ).runs;
    const touched = new Map<TRowId, true>();
    for (const change of sequence.changes) {
      for (const operation of change.operations) {
        if (operation.ref.kind === "data" && operation.kind !== "update")
          touched.set(operation.ref.rowId, true);
      }
    }
    const removals: { readonly rank: number; readonly rowId: TRowId }[] = [];
    const insertions: { readonly rank: number; readonly rowId: TRowId }[] = [];
    for (const rowId of touched.keys()) {
      const previousRank = previousSnapshot.dataIndexOf(dataRef(rowId));
      if (previousRank >= 0) removals.push({ rank: previousRank, rowId });
      const rank = snapshot.dataIndexOf(dataRef(rowId));
      if (rank >= 0) insertions.push({ rank, rowId });
    }
    removals.sort((left, right) => right.rank - left.rank);
    for (const removal of removals) runs = removeRunAt(runs, removal.rank);
    insertions.sort((left, right) => left.rank - right.rank);
    for (const insertion of insertions)
      runs = insertRunAt(
        runs,
        insertion.rank,
        semanticRowSelected(program, insertion.rowId),
      );
    if ((runs?.totalLength ?? 0) !== snapshot.visibleDataRowCount) {
      projection = buildProjection(
        program,
        snapshot as SelectionSnapshot<TRowId>,
      );
    } else {
      projection = Object.freeze({
        snapshot: snapshot as SelectionSnapshot<TRowId>,
        runs,
      });
    }
  }
  const nextProgram = Object.freeze({ ...program, projection });
  const rows = cloneRowsWithProgram(
    selection.rows as PretableIndexedSelectionState<TRowId, string>["rows"],
    nextProgram,
  ) as PretableIndexedSelectionState<TRowId, TColumnId>["rows"];
  return Object.freeze({ ...selection, rows });
}

/**
 * Whether `rowId`'s disappearance from `snapshot` is provably a deletion
 * rather than an eviction. Proof requires knowing where the row sat in
 * dataset terms the last time it *was* loaded — `previous.snapshot`'s
 * data-only rank, converted to an absolute position via `previous.window`,
 * the window that was active for that snapshot. Falling inside
 * `loadedWindow` (the window active NOW) means the current window covers
 * where the row used to be, yet the row is gone — nothing but deletion
 * explains that. Falling outside — or the position simply being unknown,
 * because `previous` was not supplied or never resolved the row — is NOT
 * proof of deletion, so the row is presumed evicted: it may simply be
 * sitting in the unloaded remainder the window admits exists.
 *
 * @internal Exported for `reconcileIndexedFocus`, which must reach the same
 * verdict about a row as the selection does — never re-implemented there.
 */
export function provenDeletedRow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  rowId: TRowId,
  loadedWindow: PretableIndexedSelectionWindow,
  previous:
    | {
        readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
        readonly window: PretableIndexedSelectionWindow | null;
      }
    | undefined,
): boolean {
  if (previous === undefined || previous.window == null) return false;
  const previousRank = previous.snapshot.dataIndexOf(dataRef(rowId));
  if (previousRank < 0) return false;
  const previousAbsolute = previous.window.start + previousRank;
  return (
    previousAbsolute >= loadedWindow.start &&
    previousAbsolute < loadedWindow.start + loadedWindow.length
  );
}

/**
 * The row that now holds dataset position `position`, addressed in `column`.
 *
 * `undefined` when the position is outside the loaded window, which is the
 * only honest answer: naming a row is naming an identity, and the engine
 * cannot name one it has not loaded.
 */
function addressAtDatasetPosition<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  position: number,
  column: TColumnId,
  loadedWindow: PretableIndexedSelectionWindow,
): PretableIndexedCellAddress<TRowId, TColumnId> | undefined {
  const rank = position - loadedWindow.start;
  if (rank < 0 || rank >= loadedWindow.length) return undefined;
  const row = snapshot.dataRowAt(rank);
  if (row === undefined) return undefined;
  return Object.freeze({ rowId: row.rowId, columnId: column });
}

/**
 * Narrows `range` by the endpoints that are PROVEN deleted, instead of
 * discarding it.
 *
 * The spec states the eviction rule per ROW: an absent row inside the loaded
 * span is deleted and prunes, one outside it is evicted and survives. Applied
 * per RANGE — drop the whole range if either endpoint is proven deleted — one
 * genuinely removed row took every merely-evicted row between the endpoints
 * with it, which is the silent under-selection this design exists to remove.
 *
 * The arithmetic is one rule for every shape. A deletion removes a row from
 * the dataset, so everything after it shifts down one; whether the deleted
 * endpoint is the low one or the high one, the surviving rows end up at
 * `lo … hi - 1`:
 *
 * | Deleted endpoint | Survivors, old positions | …after the shift |
 * | ---------------- | ------------------------ | ---------------- |
 * | the LOW end      | `lo + 1 … hi`            | `lo … hi - 1`    |
 * | the HIGH end     | `lo … hi - 1`            | `lo … hi - 1`    |
 *
 * So the HIGH field loses one position per proven deletion and the low field
 * does not move — and a surviving endpoint that is loaded reports its live
 * position instead, which already carries the shift and also absorbs any
 * deletion the engine could not prove.
 *
 * Returns `undefined` — meaning "drop the range", the pre-narrowing answer —
 * when there is no readable span to narrow, when nothing is left of the span,
 * or when the narrowed boundary lands on a row that is not loaded and so
 * cannot be named. Fail-closed in every case: the range is discarded rather
 * than left holding a position it cannot justify.
 */
function narrowDeletedEndpoints<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow: PretableIndexedSelectionWindow,
  deleted: { readonly start: boolean; readonly end: boolean },
): PretableIndexedCellRange<TRowId, TColumnId> | undefined {
  const span = range.datasetRowSpan;
  const count = (deleted.start ? 1 : 0) + (deleted.end ? 1 : 0);
  // No positional identity, so there is nothing to narrow BY. A windowed grid
  // that publishes no `datasetKey` lands here on every range, deliberately:
  // its spans are refused everywhere else too (see `spanReadableInWindow`).
  //
  // `count` is passed as the proven-deletion allowance: a deletion IS a
  // population change, so the strict read would refuse every span the moment
  // it had something to narrow. Requiring the total to be short by exactly
  // the rows this call proved gone keeps the check meaningful — a revision
  // that also inserted, or that deleted a third row elsewhere, does not add
  // up and is refused, which drops the range rather than moving it to a
  // position the engine cannot justify.
  if (span === undefined || !spanReadableInWindow(span, loadedWindow, count))
    return undefined;
  const startIsHigh = span.start >= span.end;
  let nextStart = startIsHigh ? span.start - count : span.start;
  let nextEnd = startIsHigh ? span.end : span.end - count;
  if (!deleted.start) {
    const live = datasetPosition(snapshot, range.start.rowId, loadedWindow);
    if (live >= 0) nextStart = live;
  }
  if (!deleted.end) {
    const live = datasetPosition(snapshot, range.end.rowId, loadedWindow);
    if (live >= 0) nextEnd = live;
  }
  // Empty: the deletions consumed the whole span. `nextStart`/`nextEnd` can
  // cross only when `count` exceeded the span's width, which is exactly that.
  if (startIsHigh ? nextStart < nextEnd : nextEnd < nextStart) return undefined;
  const start = deleted.start
    ? addressAtDatasetPosition(
        snapshot,
        nextStart,
        range.start.columnId,
        loadedWindow,
      )
    : range.start;
  const end = deleted.end
    ? addressAtDatasetPosition(
        snapshot,
        nextEnd,
        range.end.columnId,
        loadedWindow,
      )
    : range.end;
  if (start === undefined || end === undefined) return undefined;
  return Object.freeze({
    start,
    end,
    datasetRowSpan: Object.freeze({
      start: nextStart,
      end: nextEnd,
      datasetKey: span.datasetKey,
      // The CURRENT total, not the span's. These positions have just been
      // rewritten to describe the post-deletion population, so stamping the
      // pre-deletion size would leave the range permanently unreadable the
      // instant after it was successfully narrowed.
      datasetTotal: loadedWindow.datasetTotal,
    }),
  });
}

function sameSpan(
  left: PretableIndexedDatasetRowSpan | undefined,
  right: PretableIndexedDatasetRowSpan | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  // Plain value equality, NOT `spanReadableInWindow`: this asks whether two
  // spans say the same thing, not whether either may be trusted.
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.datasetKey === right.datasetKey &&
    left.datasetTotal === right.datasetTotal
  );
}

function withoutDatasetRowSpan<
  TRowId extends PretableRowId,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
): PretableIndexedCellRange<TRowId, TColumnId> {
  if (range.datasetRowSpan === undefined) return range;
  return Object.freeze({ start: range.start, end: range.end });
}

/**
 * Records where `range`'s endpoints sit in the dataset, so the span outlives
 * the rows.
 *
 * Positions come from the snapshot where it can answer and from the range's
 * own memory where it cannot, which is what lets a gesture extending from an
 * already-EVICTED anchor still produce a countable range. A stamp is written
 * only when BOTH endpoints resolve that way: a half-known range keeps
 * whatever it had, so a moment of partial knowledge cannot overwrite a
 * complete span with a narrower one.
 *
 * Returns `range` itself when there is nothing to record — no window, or a
 * span identical to the one already on it — so reconciliation stays a no-op
 * in local mode and does not republish the selection on every revision.
 *
 * A window with no `datasetKey` records nothing and clears whatever was
 * there: such a span could never be read back (see
 * {@link spanReadableInWindow}), so keeping one would put a number the engine
 * itself refuses in front of a consumer, who might well persist it.
 */
function stampDatasetRowSpan<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow: PretableIndexedSelectionWindow | null,
): PretableIndexedCellRange<TRowId, TColumnId> {
  // No window: nothing to record, and nothing to correct. A span already on
  // the range is left alone rather than dropped — it is inert here (with no
  // window, `endpointPositions` never reads a remembered position), and the
  // window is routinely absent for a moment BEFORE the first revision is
  // observed. Dropping it there would destroy a selection restored through
  // the controlled `state` prop on the very render that restores it.
  if (loadedWindow === null) return range;
  if (!windowCarriesSpans(loadedWindow)) return withoutDatasetRowSpan(range);
  const { start, end } = endpointPositions(range, snapshot, loadedWindow);
  if (start === undefined || end === undefined) {
    return range.datasetRowSpan === undefined ||
      spanReadableInWindow(range.datasetRowSpan, loadedWindow)
      ? range
      : withoutDatasetRowSpan(range);
  }
  const next: PretableIndexedDatasetRowSpan = Object.freeze({
    start,
    end,
    datasetKey: loadedWindow.datasetKey,
    datasetTotal: loadedWindow.datasetTotal,
  });
  if (sameSpan(range.datasetRowSpan, next)) return range;
  return Object.freeze({ ...range, datasetRowSpan: next });
}

/**
 * Fills in `datasetRowSpan` for ranges a GESTURE just built.
 *
 * Every selection gesture — shift-click, keyboard extension, marquee,
 * select-all, an echo through the controlled `state` prop — hands the engine
 * brand-new range objects carrying nothing but row ids. Left alone those
 * ranges are born spanless, so the count collapses to whatever happens to be
 * loaded the moment the window next moves. Stamping them here, on the single
 * public write path, is what makes the span the range's identity rather than
 * a memo reconciliation occasionally attaches.
 *
 * `replaced` is the selection being written over. It is read as a
 * rowId → dataset-position map, which is how an extension anchored on an
 * evicted row still knows where its anchor is: the range that anchor came
 * from is right there, and it remembers.
 */
export function adoptIndexedCellRangeSpans<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  ranges: readonly PretableIndexedCellRange<TRowId, TColumnId>[],
  replaced: readonly PretableIndexedCellRange<TRowId, TColumnId>[],
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  loadedWindow: PretableIndexedSelectionWindow | null,
): readonly PretableIndexedCellRange<TRowId, TColumnId>[] {
  // No window, or one that cannot carry spans: `stampDatasetRowSpan` is the
  // whole of the behaviour, and there is nothing to recall from.
  if (!windowCarriesSpans(loadedWindow))
    return ranges.map((range) =>
      stampDatasetRowSpan(range, snapshot, loadedWindow),
    );
  const remembered = new Map<TRowId, number>();
  for (const range of replaced) {
    const span = range.datasetRowSpan;
    if (span === undefined) continue;
    if (!spanReadableInWindow(span, loadedWindow)) continue;
    if (!remembered.has(range.start.rowId))
      remembered.set(range.start.rowId, span.start);
    if (!remembered.has(range.end.rowId))
      remembered.set(range.end.rowId, span.end);
  }
  return ranges.map((range) => {
    // Per endpoint, best source first: what the snapshot can see now, then
    // what this range already carries, then what the selection it replaces
    // remembers about that same row id.
    const own = endpointPositions(range, snapshot, loadedWindow);
    const start = own.start ?? remembered.get(range.start.rowId);
    const end = own.end ?? remembered.get(range.end.rowId);
    if (start === undefined || end === undefined)
      return stampDatasetRowSpan(range, snapshot, loadedWindow);
    const next: PretableIndexedDatasetRowSpan = Object.freeze({
      start,
      end,
      datasetKey: loadedWindow.datasetKey,
      datasetTotal: loadedWindow.datasetTotal,
    });
    if (sameSpan(range.datasetRowSpan, next)) return range;
    return Object.freeze({ ...range, datasetRowSpan: next });
  });
}

/**
 * The window absence may be judged AGAINST, which is not always the window
 * that was supplied.
 *
 * A new `datasetKey` is a new population: the dataset positions every span
 * remembers now hold different rows, and no row id can be presumed merely
 * evicted rather than gone. Retention is switched off for that revision — the
 * pre-eviction rules apply, which is what the spec means by "a new datasetKey
 * resets everything, as today".
 *
 * @internal Shared with `reconcileIndexedFocus`: the cursor and the selection
 * must switch retention off on the same revisions, or a population change
 * drops the selection while the cursor sits on a row from the old one.
 */
export function evictionRetentionWindow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  eviction: PretableIndexedEvictionContext<TRow, TRowId, TColumns> | undefined,
): PretableIndexedSelectionWindow | null {
  const suppliedWindow = eviction?.window ?? null;
  const previousWindow = eviction?.previous?.window;
  const populationChanged =
    suppliedWindow !== null &&
    previousWindow != null &&
    // Value comparison, not `spanReadableInWindow`: two keyless windows are
    // not evidence of a change. A keyless consumer gets no span trust at all
    // (see `windowCarriesSpans`), so there is nothing here to invalidate.
    previousWindow.datasetKey !== suppliedWindow.datasetKey;
  return populationChanged ? null : suppliedWindow;
}

export function reconcileIndexedSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  eviction?: PretableIndexedEvictionContext<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  const suppliedWindow = eviction?.window ?? null;
  const previous = eviction?.previous;
  // STAMPING still runs against `suppliedWindow` on a population change, which
  // is the difference between this and simply passing `null` everywhere: a
  // range whose two endpoints are both present in the NEW population is fully
  // locatable there, so it is re-stamped in the new population's coordinates.
  // Passing `null` for that too would leave the old key sitting on the range,
  // refused by every reader but still emitted through `onSelectionChange`
  // and liable to be persisted by a consumer.
  const retentionWindow = evictionRetentionWindow(eviction);
  let changed = false;
  rowSelectionProgram(selection, snapshot);
  const ranges: PretableIndexedCellRange<TRowId, TColumnId>[] = [];
  for (const range of selection.ranges) {
    const startVisible = visibleAddress(range.start, snapshot);
    const endVisible = visibleAddress(range.end, snapshot);
    if (startVisible && endVisible) {
      // Both endpoints are here, so this is the moment the span is knowable
      // first-hand. Record it; every later revision that cannot see them
      // reads it back.
      const stamped = stampDatasetRowSpan(range, snapshot, suppliedWindow);
      if (stamped !== range) changed = true;
      ranges.push(stamped);
    } else if (startVisible || endVisible) {
      const survivor = startVisible ? range.start : range.end;
      const absentee = startVisible ? range.end : range.start;
      // ONE endpoint gone is what an ordinary incremental scroll looks like:
      // the window slides past the range's start many revisions before it
      // reaches the end. Collapsing to the survivor there rewrites the
      // selection — and, because the collapsed range is stamped in turn,
      // overwrites the span that recorded how big it really was, so the
      // truth does not come back when the row does. Only a PROVEN deletion
      // earns the collapse; mere absence keeps the range whole, with the
      // survivor's position refreshed live and the absentee's read back
      // from the span.
      const absenteeDeleted =
        retentionWindow !== null &&
        provenDeletedRow(absentee.rowId, retentionWindow, previous);
      // A proven deletion prunes ONE ROW, not the range around it. The rows
      // between the endpoints are still selected — most of them loaded and
      // painted, in this branch — so the range narrows past the deleted
      // endpoint rather than collapsing onto the survivor and reporting a
      // selection of one.
      const narrowed =
        absenteeDeleted && retentionWindow !== null
          ? narrowDeletedEndpoints(range, snapshot, retentionWindow, {
              start: !startVisible,
              end: !endVisible,
            })
          : undefined;
      if (narrowed !== undefined) {
        ranges.push(narrowed);
        changed = true;
      } else if (retentionWindow === null || absenteeDeleted) {
        ranges.push(
          stampDatasetRowSpan(
            Object.freeze({ start: survivor, end: survivor }),
            snapshot,
            // `retentionWindow`, not `suppliedWindow`. On a population change
            // this is null, so the collapsed range gets NO span — which is
            // the whole point: it is a remnant of a selection the engine
            // could not locate in the new population, and a span would let
            // the summary call its one surviving row a proven extent. See
            // `rangeDatasetSpan`, which reads a missing span under a
            // span-carrying window as exactly that doubt.
            retentionWindow,
          ),
        );
        changed = true;
      } else {
        const retained = stampDatasetRowSpan(range, snapshot, retentionWindow);
        if (retained !== range) changed = true;
        ranges.push(retained);
      }
    } else if (retentionWindow != null) {
      // Pruning requires POSITIVE proof of deletion for at least one
      // endpoint. Neither being provable does not retain "half" the row the
      // way partial visibility above does — the row is a single identity
      // that is either loaded or not, so an unprovable pair keeps the whole
      // range verbatim, letting a returning row come back selected.
      const startDeleted = provenDeletedRow(
        range.start.rowId,
        retentionWindow,
        previous,
      );
      const endDeleted = provenDeletedRow(
        range.end.rowId,
        retentionWindow,
        previous,
      );
      if (startDeleted || endDeleted) {
        changed = true;
        // Same rule as the branch above: the proven-deleted ROWS go, the span
        // around them stays. Dropping the range here is what took an evicted
        // 80-row selection down with a single deleted endpoint.
        const narrowed = narrowDeletedEndpoints(
          range,
          snapshot,
          retentionWindow,
          { start: startDeleted, end: endDeleted },
        );
        if (narrowed !== undefined) ranges.push(narrowed);
      } else {
        ranges.push(range);
      }
    } else {
      changed = true;
    }
  }
  let anchor = selection.anchor;
  if (
    anchor !== null &&
    !visibleAddress(anchor, snapshot) &&
    // The anchor is the fixed end of the NEXT gesture —
    // `extendRangeFromAnchor` builds its range straight from this address —
    // so it is an identity, not a cursor into the loaded rows. Reassigning it
    // on visibility alone flips which end of an upward selection is fixed
    // (and, with several ranges, jumps it into a range the user never
    // anchored on): the next shift-click then extends from the wrong end and
    // deselects what they had. Only a PROVEN deletion earns the reassignment,
    // for the same reason it is what earns collapsing a range.
    (retentionWindow === null ||
      provenDeletedRow(anchor.rowId, retentionWindow, previous))
  ) {
    anchor = ranges[0]?.start ?? null;
    changed = true;
  }
  if (!changed) return selection;
  return Object.freeze({
    ...selection,
    ranges: Object.freeze(ranges),
    anchor,
  });
}
