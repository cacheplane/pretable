import type {
  PretableChangeSequence,
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
    (selection.rows.excludedRanges?.size ?? 0) === 0
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
  rowSelectionProgram(selection, snapshot);
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
    ranges: Object.freeze(ranges),
    anchor,
  });
}
