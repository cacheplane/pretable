import type { CompiledGroupKey, CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import {
  PretableRowModelError,
  type PretableRowModelOperation,
} from "./errors";
import type { RowRecord, VisibleIndexRoot } from "./internal-types";
import {
  createAggregateTree,
  type AggregateTree,
  type AggregateTreeLeaf,
  type BuiltinAggregatorName,
} from "./persistent/aggregate-tree";
import type { PretableAggregator } from "./column-types";
import {
  createOrderStatisticTree,
  type OrderStatisticTree,
} from "./persistent/order-statistic-tree";
import {
  createPersistentMap,
  type PersistentMap,
} from "./persistent/persistent-map";
import type {
  PretableDataRow,
  PretableExpansionDefault,
  PretableGroupId,
  PretableGroupRow,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "./types";

type AnyAggregateTree = AggregateTree<
  PretableRowId,
  object,
  unknown,
  unknown,
  unknown
>;

interface AggregateRoots {
  readonly all: ReadonlyMap<string, AnyAggregateTree>;
  readonly filtered: ReadonlyMap<string, AnyAggregateTree>;
}

interface PolicyCounts {
  readonly collapsed: number;
  readonly expanded: number;
  readonly throughDepth: readonly number[];
  /** Total post-filter descendants, independent of expansion. */
  readonly data: number;
  readonly dataCollapsed: number;
  readonly dataExpanded: number;
  readonly dataThroughDepth: readonly number[];
}

interface MeasuredGroupTree<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly size: number;
  readonly measure: PolicyCounts;
  get(groupId: PretableGroupId): GroupNode<TRow, TRowId, TColumns> | undefined;
  insertOrReplace(
    entry: GroupNode<TRow, TRowId, TColumns>,
  ): MeasuredGroupTree<TRow, TRowId, TColumns>;
  remove(groupId: PretableGroupId): MeasuredGroupTree<TRow, TRowId, TColumns>;
  entries(): IterableIterator<GroupNode<TRow, TRowId, TColumns>>;
  select(
    index: number,
    policy: PretableExpansionDefault,
  ):
    | {
        readonly entry: GroupNode<TRow, TRowId, TColumns>;
        readonly offset: number;
      }
    | undefined;
  measureBefore(
    groupId: PretableGroupId,
    policy: PretableExpansionDefault,
  ): number | undefined;
  selectData(
    index: number,
    policy: PretableExpansionDefault,
  ):
    | {
        readonly entry: GroupNode<TRow, TRowId, TColumns>;
        readonly offset: number;
      }
    | undefined;
  dataBefore(
    groupId: PretableGroupId,
    policy: PretableExpansionDefault,
  ): number | undefined;
}

const EMPTY_COUNTS: PolicyCounts = Object.freeze({
  collapsed: 0,
  expanded: 0,
  throughDepth: Object.freeze([]),
  data: 0,
  dataCollapsed: 0,
  dataExpanded: 0,
  dataThroughDepth: Object.freeze([]),
});

export interface GroupNode<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly groupId: PretableGroupId;
  readonly path: readonly CompiledGroupKey<TColumns>[];
  readonly pathKeys: readonly string[];
  readonly depth: number;
  readonly columnId: string;
  readonly value: unknown;
  readonly key: string;
  readonly parentGroupId: PretableGroupId | undefined;
  readonly override: boolean | undefined;
  readonly childrenByKey: PersistentMap<
    string,
    GroupNode<TRow, TRowId, TColumns>
  >;
  readonly children: MeasuredGroupTree<TRow, TRowId, TColumns>;
  readonly leaves: OrderStatisticTree<
    TRowId,
    RowRecord<TRow, TRowId, TColumns>,
    number
  >;
  readonly filteredCount: number;
  readonly allCount: number;
  readonly aggregateRoots: AggregateRoots;
  readonly aggregates: Readonly<Record<string, unknown>>;
  readonly publicCollapsed: PretableGroupRow<TColumns>;
  readonly publicExpanded: PretableGroupRow<TColumns>;
  readonly counts: PolicyCounts;
}

export interface GroupIndexRoot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly levelCount: number;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly aggregateFilteredRows: boolean;
  readonly rootsByKey: PersistentMap<string, GroupNode<TRow, TRowId, TColumns>>;
  readonly roots: MeasuredGroupTree<TRow, TRowId, TColumns>;
  readonly groups: PersistentMap<
    PretableGroupId,
    GroupNode<TRow, TRowId, TColumns>
  >;
  readonly rowParents: PersistentMap<TRowId, PretableGroupId>;
  readonly counts: PolicyCounts;
}

const groupedIndex = Symbol("pretable.grouped-index");

export type GroupedVisibleIndexRoot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> = VisibleIndexRoot<TRow, TRowId, TColumns> & {
  readonly [groupedIndex]: GroupIndexRoot<TRow, TRowId, TColumns>;
};

export function getGroupIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  visible: VisibleIndexRoot<TRow, TRowId, TColumns>,
): GroupIndexRoot<TRow, TRowId, TColumns> | undefined {
  return (visible as Partial<GroupedVisibleIndexRoot<TRow, TRowId, TColumns>>)[
    groupedIndex
  ];
}

export function attachGroupIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  rows: VisibleIndexRoot<TRow, TRowId, TColumns>["rows"],
  groups: GroupIndexRoot<TRow, TRowId, TColumns>,
): GroupedVisibleIndexRoot<TRow, TRowId, TColumns> {
  return Object.freeze({ rows, [groupedIndex]: groups });
}

function escape(raw: string): string {
  return raw.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/=/g, "%3D");
}

/** Canonical equality/identity key. Null and undefined intentionally share the legacy blank group. */
export function encodeGroupValue(value: unknown): string {
  if (value === null || value === undefined) return "~";
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "n:NaN";
    if (Object.is(value, -0)) return "n:-0";
    return `n:${String(value)}`;
  }
  if (typeof value === "boolean") return `b:${String(value)}`;
  if (typeof value === "bigint") return `i:${String(value)}`;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? "d:Invalid" : `d:${String(time)}`;
  }
  try {
    return `o:${String(value)}`;
  } catch {
    return "o:[unstringifiable]";
  }
}

export function makeGroupId<TColumns>(
  path: readonly CompiledGroupKey<TColumns>[],
): PretableGroupId {
  return `__group__:${path
    .map(
      (entry) =>
        `${escape(entry.columnId)}=${escape(encodeGroupValue(entry.value))}`,
    )
    .join("/")}` as PretableGroupId;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) ||
    (left instanceof Date &&
      right instanceof Date &&
      Object.is(left.getTime(), right.getTime()))
  );
}

function combineCounts(left: PolicyCounts, right: PolicyCounts): PolicyCounts {
  const length = Math.max(left.throughDepth.length, right.throughDepth.length);
  const throughDepth = Array.from(
    { length },
    (_, index) =>
      (left.throughDepth[index] ?? 0) + (right.throughDepth[index] ?? 0),
  );
  const dataLength = Math.max(
    left.dataThroughDepth.length,
    right.dataThroughDepth.length,
  );
  return Object.freeze({
    collapsed: left.collapsed + right.collapsed,
    expanded: left.expanded + right.expanded,
    throughDepth: Object.freeze(throughDepth),
    data: left.data + right.data,
    dataCollapsed: left.dataCollapsed + right.dataCollapsed,
    dataExpanded: left.dataExpanded + right.dataExpanded,
    dataThroughDepth: Object.freeze(
      Array.from(
        { length: dataLength },
        (_, index) =>
          (left.dataThroughDepth[index] ?? 0) +
          (right.dataThroughDepth[index] ?? 0),
      ),
    ),
  });
}

function groupCounts(
  depth: number,
  levelCount: number,
  override: boolean | undefined,
  descendants: PolicyCounts,
): PolicyCounts {
  const count = (expanded: boolean, descendant: number) =>
    (override ?? expanded) ? 1 + descendant : 1;
  return Object.freeze({
    collapsed: count(false, descendants.collapsed),
    expanded: count(true, descendants.expanded),
    throughDepth: Object.freeze(
      Array.from({ length: levelCount }, (_, policyDepth) =>
        count(depth <= policyDepth, descendants.throughDepth[policyDepth] ?? 0),
      ),
    ),
    data: descendants.data,
    dataCollapsed: (override ?? false) ? descendants.dataCollapsed : 0,
    dataExpanded: (override ?? true) ? descendants.dataExpanded : 0,
    dataThroughDepth: Object.freeze(
      Array.from({ length: levelCount }, (_, policyDepth) =>
        (override ?? depth <= policyDepth)
          ? (descendants.dataThroughDepth[policyDepth] ?? 0)
          : 0,
      ),
    ),
  });
}

function dataCountForPolicy(
  counts: PolicyCounts,
  policy: PretableExpansionDefault,
): number {
  if (policy.kind === "expanded") return counts.dataExpanded;
  if (policy.kind === "collapsed") return counts.dataCollapsed;
  if (policy.depth < 0) return counts.dataCollapsed;
  return (
    counts.dataThroughDepth[
      Math.min(policy.depth, counts.dataThroughDepth.length - 1)
    ] ?? counts.dataExpanded
  );
}

function countForPolicy(
  counts: PolicyCounts,
  policy: PretableExpansionDefault,
): number {
  if (policy.kind === "expanded") return counts.expanded;
  if (policy.kind === "collapsed") return counts.collapsed;
  if (policy.depth < 0) return counts.collapsed;
  return (
    counts.throughDepth[
      Math.min(policy.depth, counts.throughDepth.length - 1)
    ] ?? counts.expanded
  );
}

interface MeasuredNode<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly entry: GroupNode<TRow, TRowId, TColumns>;
  readonly left: MeasuredNode<TRow, TRowId, TColumns> | null;
  readonly right: MeasuredNode<TRow, TRowId, TColumns> | null;
  readonly height: number;
  readonly size: number;
  readonly measure: PolicyCounts;
}

function measuredHeight(node: { readonly height: number } | null): number {
  return node?.height ?? 0;
}

function measuredNode<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  entry: GroupNode<TRow, TRowId, TColumns>,
  left: MeasuredNode<TRow, TRowId, TColumns> | null,
  right: MeasuredNode<TRow, TRowId, TColumns> | null,
): MeasuredNode<TRow, TRowId, TColumns> {
  return Object.freeze({
    entry,
    left,
    right,
    height: 1 + Math.max(measuredHeight(left), measuredHeight(right)),
    size: (left?.size ?? 0) + 1 + (right?.size ?? 0),
    measure: combineCounts(
      combineCounts(left?.measure ?? EMPTY_COUNTS, entry.counts),
      right?.measure ?? EMPTY_COUNTS,
    ),
  });
}

function measuredBalance<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  node: MeasuredNode<TRow, TRowId, TColumns>,
): MeasuredNode<TRow, TRowId, TColumns> {
  const factor = measuredHeight(node.left) - measuredHeight(node.right);
  if (factor > 1) {
    let left = node.left!;
    if (measuredHeight(left.left) < measuredHeight(left.right)) {
      const pivot = left.right!;
      left = measuredNode(
        pivot.entry,
        measuredNode(left.entry, left.left, pivot.left),
        pivot.right,
      );
    }
    return measuredNode(
      left.entry,
      left.left,
      measuredNode(node.entry, left.right, node.right),
    );
  }
  if (factor < -1) {
    let right = node.right!;
    if (measuredHeight(right.right) < measuredHeight(right.left)) {
      const pivot = right.left!;
      right = measuredNode(
        pivot.entry,
        pivot.left,
        measuredNode(right.entry, pivot.right, right.right),
      );
    }
    return measuredNode(
      right.entry,
      measuredNode(node.entry, node.left, right.left),
      right.right,
    );
  }
  return measuredNode(node.entry, node.left, node.right);
}

function compareGroupIds(
  left: PretableGroupId,
  right: PretableGroupId,
): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

class PersistentMeasuredGroupTree<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> implements MeasuredGroupTree<TRow, TRowId, TColumns> {
  readonly #root: MeasuredNode<TRow, TRowId, TColumns> | null;
  readonly #byId: PersistentMap<
    PretableGroupId,
    GroupNode<TRow, TRowId, TColumns>
  >;
  readonly #compare: (
    left: GroupNode<TRow, TRowId, TColumns>,
    right: GroupNode<TRow, TRowId, TColumns>,
  ) => number;

  constructor(
    root: MeasuredNode<TRow, TRowId, TColumns> | null,
    byId: PersistentMap<PretableGroupId, GroupNode<TRow, TRowId, TColumns>>,
    compare: (
      left: GroupNode<TRow, TRowId, TColumns>,
      right: GroupNode<TRow, TRowId, TColumns>,
    ) => number,
  ) {
    this.#root = root;
    this.#byId = byId;
    this.#compare = compare;
  }

  get size(): number {
    return this.#root?.size ?? 0;
  }
  get measure(): PolicyCounts {
    return this.#root?.measure ?? EMPTY_COUNTS;
  }
  get(groupId: PretableGroupId) {
    return this.#byId.get(groupId);
  }

  #compareEntries(
    left: GroupNode<TRow, TRowId, TColumns>,
    right: GroupNode<TRow, TRowId, TColumns>,
  ): number {
    const result = this.#compare(left, right);
    return result < 0
      ? -1
      : result > 0
        ? 1
        : compareGroupIds(left.groupId, right.groupId);
  }

  #insert(
    root: MeasuredNode<TRow, TRowId, TColumns> | null,
    entry: GroupNode<TRow, TRowId, TColumns>,
  ): MeasuredNode<TRow, TRowId, TColumns> {
    if (root === null) return measuredNode(entry, null, null);
    const comparison = this.#compareEntries(entry, root.entry);
    return comparison < 0
      ? measuredBalance(
          measuredNode(root.entry, this.#insert(root.left, entry), root.right),
        )
      : measuredBalance(
          measuredNode(root.entry, root.left, this.#insert(root.right, entry)),
        );
  }

  #extractMinimum(
    root: MeasuredNode<TRow, TRowId, TColumns>,
  ): readonly [
    MeasuredNode<TRow, TRowId, TColumns>,
    MeasuredNode<TRow, TRowId, TColumns> | null,
  ] {
    if (root.left === null) return [root, root.right];
    const [minimum, left] = this.#extractMinimum(root.left);
    return [
      minimum,
      measuredBalance(measuredNode(root.entry, left, root.right)),
    ];
  }

  #remove(
    root: MeasuredNode<TRow, TRowId, TColumns> | null,
    entry: GroupNode<TRow, TRowId, TColumns>,
  ): MeasuredNode<TRow, TRowId, TColumns> | null {
    if (root === null) return null;
    const comparison = this.#compareEntries(entry, root.entry);
    if (comparison < 0)
      return measuredBalance(
        measuredNode(root.entry, this.#remove(root.left, entry), root.right),
      );
    if (comparison > 0)
      return measuredBalance(
        measuredNode(root.entry, root.left, this.#remove(root.right, entry)),
      );
    if (root.left === null) return root.right;
    if (root.right === null) return root.left;
    const [minimum, right] = this.#extractMinimum(root.right);
    return measuredBalance(measuredNode(minimum.entry, root.left, right));
  }

  insertOrReplace(
    entry: GroupNode<TRow, TRowId, TColumns>,
  ): MeasuredGroupTree<TRow, TRowId, TColumns> {
    const previous = this.#byId.get(entry.groupId);
    if (previous === entry) return this;
    const without =
      previous === undefined ? this.#root : this.#remove(this.#root, previous);
    return new PersistentMeasuredGroupTree(
      this.#insert(without, entry),
      this.#byId.set(entry.groupId, entry),
      this.#compare,
    );
  }

  remove(groupId: PretableGroupId): MeasuredGroupTree<TRow, TRowId, TColumns> {
    const previous = this.#byId.get(groupId);
    if (previous === undefined) return this;
    return new PersistentMeasuredGroupTree(
      this.#remove(this.#root, previous),
      this.#byId.delete(groupId),
      this.#compare,
    );
  }

  *entries(): IterableIterator<GroupNode<TRow, TRowId, TColumns>> {
    function* walk<A extends object, B extends PretableRowId, C>(
      node: MeasuredNode<A, B, C> | null,
    ): IterableIterator<GroupNode<A, B, C>> {
      if (node === null) return;
      yield* walk(node.left);
      yield node.entry;
      yield* walk(node.right);
    }
    yield* walk(this.#root);
  }

  select(index: number, policy: PretableExpansionDefault) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= countForPolicy(this.measure, policy)
    )
      return undefined;
    let node = this.#root;
    let remaining = index;
    while (node !== null) {
      const left = countForPolicy(node.left?.measure ?? EMPTY_COUNTS, policy);
      const own = countForPolicy(node.entry.counts, policy);
      if (remaining < left) node = node.left;
      else if (remaining < left + own)
        return { entry: node.entry, offset: remaining - left };
      else {
        remaining -= left + own;
        node = node.right;
      }
    }
    return undefined;
  }

  measureBefore(
    groupId: PretableGroupId,
    policy: PretableExpansionDefault,
  ): number | undefined {
    const entry = this.#byId.get(groupId);
    if (entry === undefined) return undefined;
    let node = this.#root;
    let result = 0;
    while (node !== null) {
      const comparison = this.#compareEntries(entry, node.entry);
      if (comparison < 0) node = node.left;
      else {
        result += countForPolicy(node.left?.measure ?? EMPTY_COUNTS, policy);
        if (comparison === 0) return result;
        result += countForPolicy(node.entry.counts, policy);
        node = node.right;
      }
    }
    return undefined;
  }

  selectData(index: number, policy: PretableExpansionDefault) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= dataCountForPolicy(this.measure, policy)
    )
      return undefined;
    let node = this.#root;
    let remaining = index;
    while (node !== null) {
      const left = dataCountForPolicy(
        node.left?.measure ?? EMPTY_COUNTS,
        policy,
      );
      const own = dataCountForPolicy(node.entry.counts, policy);
      if (remaining < left) node = node.left;
      else if (remaining < left + own)
        return { entry: node.entry, offset: remaining - left };
      else {
        remaining -= left + own;
        node = node.right;
      }
    }
    return undefined;
  }

  dataBefore(
    groupId: PretableGroupId,
    policy: PretableExpansionDefault,
  ): number | undefined {
    const entry = this.#byId.get(groupId);
    if (entry === undefined) return undefined;
    let node = this.#root;
    let result = 0;
    while (node !== null) {
      const comparison = this.#compareEntries(entry, node.entry);
      if (comparison < 0) node = node.left;
      else {
        result += dataCountForPolicy(
          node.left?.measure ?? EMPTY_COUNTS,
          policy,
        );
        if (comparison === 0) return result;
        result += dataCountForPolicy(node.entry.counts, policy);
        node = node.right;
      }
    }
    return undefined;
  }
}

function effectiveExpanded<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  node: GroupNode<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
): boolean {
  if (node.override !== undefined) return node.override;
  if (policy.kind === "expanded") return true;
  if (policy.kind === "collapsed") return false;
  return node.depth <= policy.depth;
}

function createLeafTree<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(queryPlan: CompiledQuery<TColumns>) {
  return createOrderStatisticTree<
    TRowId,
    RowRecord<TRow, TRowId, TColumns>,
    number
  >({
    getId: (record) => record.rowId,
    compare: (left, right) =>
      queryPlan.compareRows(left.metadata as never, right.metadata as never),
    measure: {
      empty: 0,
      fromEntry: () => 1,
      combine: (left, right) => left + right,
    },
  });
}

function createChildTree<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(queryPlan: CompiledQuery<TColumns>, level: number) {
  return new PersistentMeasuredGroupTree<TRow, TRowId, TColumns>(
    null,
    createPersistentMap(),
    (left, right) =>
      queryPlan.compareGroupKeys(level, left.path[level]!, right.path[level]!),
  );
}

type RuntimeAggregateLeaf = {
  readonly columnId: string;
  readonly aggregate:
    | BuiltinAggregatorName
    | PretableAggregator<object, unknown, unknown, unknown>;
  readonly allLeaf: AggregateTreeLeaf<PretableRowId, object, unknown, unknown>;
  readonly filteredLeaf:
    AggregateTreeLeaf<PretableRowId, object, unknown, unknown> | undefined;
};

function compareAggregateLeaves<TColumns>(
  queryPlan: CompiledQuery<TColumns>,
  left: AggregateTreeLeaf<PretableRowId, object, unknown, unknown>,
  right: AggregateTreeLeaf<PretableRowId, object, unknown, unknown>,
): number {
  const leftDependency = left.dependency as {
    readonly sourceOrder: number;
    readonly sortKeys: readonly unknown[];
  };
  const rightDependency = right.dependency as {
    readonly sourceOrder: number;
    readonly sortKeys: readonly unknown[];
  };
  return queryPlan.compareRows(
    {
      rowId: left.id,
      row: left.row,
      sourceOrder: leftDependency.sourceOrder,
      filterPasses: true,
      groupPath: [],
      sortKeys: leftDependency.sortKeys,
      aggregateLeaves: [],
    } as never,
    {
      rowId: right.id,
      row: right.row,
      sourceOrder: rightDependency.sourceOrder,
      filterPasses: true,
      groupPath: [],
      sortKeys: rightDependency.sortKeys,
      aggregateLeaves: [],
    } as never,
  );
}

function emptyAggregateTree<TColumns>(
  queryPlan: CompiledQuery<TColumns>,
  leaf: RuntimeAggregateLeaf,
): AnyAggregateTree {
  const factory = createAggregateTree as unknown as (options: {
    readonly columnId: string;
    readonly aggregator:
      | BuiltinAggregatorName
      | PretableAggregator<object, unknown, unknown, unknown>;
    readonly compare: (
      left: AggregateTreeLeaf<PretableRowId, object, unknown, unknown>,
      right: AggregateTreeLeaf<PretableRowId, object, unknown, unknown>,
    ) => number;
  }) => AnyAggregateTree;
  return factory({
    columnId: leaf.columnId,
    aggregator: leaf.aggregate,
    compare: (left, right) => compareAggregateLeaves(queryPlan, left, right),
  });
}

function updateAggregateRoots<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  roots: AggregateRoots,
  queryPlan: CompiledQuery<TColumns>,
  record: RowRecord<TRow, TRowId, TColumns>,
  operation: "insert" | "remove",
  modelOperation: PretableRowModelOperation,
): AggregateRoots {
  const all = new Map(roots.all);
  const filtered = new Map(roots.filtered);
  for (const leaf of record.metadata
    .aggregateLeaves as unknown as readonly RuntimeAggregateLeaf[]) {
    try {
      const allTree =
        all.get(leaf.columnId) ?? emptyAggregateTree(queryPlan, leaf);
      const filteredTree =
        filtered.get(leaf.columnId) ?? emptyAggregateTree(queryPlan, leaf);
      all.set(
        leaf.columnId,
        operation === "insert"
          ? allTree.insertOrReplace(leaf.allLeaf)
          : allTree.remove(record.rowId),
      );
      filtered.set(
        leaf.columnId,
        operation === "insert" && leaf.filteredLeaf !== undefined
          ? filteredTree.insertOrReplace(leaf.filteredLeaf)
          : filteredTree.remove(record.rowId),
      );
    } catch (cause) {
      if (cause instanceof PretableRowModelError) throw cause;
      throw new PretableRowModelError(
        "aggregator-failed",
        `The aggregate for column ${leaf.columnId} failed.`,
        {
          operation: modelOperation,
          rowId: record.rowId,
          columnId: leaf.columnId,
          cause,
        },
      );
    }
  }
  return Object.freeze({ all, filtered });
}

function structurallyEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  let rights = seen.get(left);
  if (rights?.has(right)) return true;
  if (rights === undefined) {
    rights = new WeakSet();
    seen.set(left, rights);
  }
  rights.add(right);
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      Object.is(left.getTime(), right.getTime())
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index], seen))
    );
  }
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map)) return false;
    if (left.size !== right.size) return false;
    const unmatched = Array.from(right.entries());
    return Array.from(left.entries()).every(([leftKey, leftValue]) => {
      const index = unmatched.findIndex(
        ([rightKey, rightValue]) =>
          structurallyEqual(leftKey, rightKey, seen) &&
          structurallyEqual(leftValue, rightValue, seen),
      );
      if (index < 0) return false;
      unmatched.splice(index, 1);
      return true;
    });
  }
  if (left instanceof Set || right instanceof Set) {
    if (!(left instanceof Set) || !(right instanceof Set)) return false;
    if (left.size !== right.size) return false;
    const unmatched = Array.from(right.values());
    return Array.from(left.values()).every((leftValue) => {
      const index = unmatched.findIndex((rightValue) =>
        structurallyEqual(leftValue, rightValue, seen),
      );
      if (index < 0) return false;
      unmatched.splice(index, 1);
      return true;
    });
  }
  if (
    Object.getPrototypeOf(left) !== Object.getPrototypeOf(right) ||
    (Object.getPrototypeOf(left) !== Object.prototype &&
      Object.getPrototypeOf(left) !== null)
  ) {
    return false;
  }
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        structurallyEqual(
          Reflect.get(left, key),
          Reflect.get(right, key),
          seen,
        ),
    )
  );
}

class GroupAggregatorError extends PretableRowModelError {
  readonly name = "GroupAggregatorError";
  readonly groupId: PretableGroupId;
  readonly groupValues: readonly unknown[];

  constructor(
    operation: PretableRowModelOperation,
    rowId: PretableRowId,
    columnId: string,
    groupId: PretableGroupId,
    groupValues: readonly unknown[],
    cause: unknown,
  ) {
    super(
      "aggregator-failed",
      `Finalizing the aggregate for column ${columnId} failed in group ${groupId}.`,
      { operation, rowId, columnId, cause },
    );
    this.groupId = groupId;
    this.groupValues = Object.freeze([...groupValues]);
  }
}

function aggregateRecord(
  roots: AggregateRoots,
  allPopulation: boolean,
  previous: Readonly<Record<string, unknown>> | undefined,
  operation: PretableRowModelOperation,
  rowId: PretableRowId,
  groupId: PretableGroupId,
  groupValues: readonly unknown[],
): Readonly<Record<string, unknown>> {
  const selected = allPopulation ? roots.all : roots.filtered;
  const values: Record<string, unknown> = {};
  let same = previous !== undefined;
  for (const [columnId, tree] of selected) {
    let finalized: unknown;
    try {
      finalized = tree.finalize();
    } catch (cause) {
      if (cause instanceof PretableRowModelError) throw cause;
      throw new GroupAggregatorError(
        operation,
        rowId,
        columnId,
        groupId,
        groupValues,
        cause,
      );
    }
    const value = structurallyEqual(previous?.[columnId], finalized)
      ? previous?.[columnId]
      : finalized;
    values[columnId] = value;
    if (!Object.is(previous?.[columnId], value)) same = false;
  }
  if (previous !== undefined && Object.keys(previous).length !== selected.size)
    same = false;
  return same ? previous! : Object.freeze(values);
}

function makePublicGroup<TColumns>(
  source: Omit<PretableGroupRow<TColumns>, "expanded">,
  expanded: boolean,
  previous: PretableGroupRow<TColumns> | undefined,
): PretableGroupRow<TColumns> {
  if (
    previous !== undefined &&
    previous.expanded === expanded &&
    previous.childCount === source.childCount &&
    previous.aggregates === source.aggregates &&
    sameValue(previous.value, source.value)
  )
    return previous;
  return Object.freeze({ ...source, expanded }) as PretableGroupRow<TColumns>;
}

interface FinishContext<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly levelCount: number;
  readonly aggregateFilteredRows: boolean;
  readonly reusable: PersistentMap<
    PretableGroupId,
    GroupNode<TRow, TRowId, TColumns>
  >;
  readonly operation: PretableRowModelOperation;
}

function finishNode<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  node: Omit<
    GroupNode<TRow, TRowId, TColumns>,
    "aggregates" | "publicCollapsed" | "publicExpanded" | "counts"
  >,
  context: FinishContext<TRow, TRowId, TColumns>,
  triggerRowId: TRowId,
): GroupNode<TRow, TRowId, TColumns> {
  const previous = context.reusable.get(node.groupId);
  const aggregates = aggregateRecord(
    node.aggregateRoots,
    context.aggregateFilteredRows,
    previous?.aggregates,
    context.operation,
    triggerRowId,
    node.groupId,
    node.path.map((entry) => entry.value),
  );
  const descendants =
    node.depth === context.levelCount - 1
      ? (Object.freeze({
          collapsed: node.leaves.size,
          expanded: node.leaves.size,
          throughDepth: Object.freeze(
            Array(context.levelCount).fill(node.leaves.size),
          ),
          data: node.leaves.size,
          dataCollapsed: node.leaves.size,
          dataExpanded: node.leaves.size,
          dataThroughDepth: Object.freeze(
            Array(context.levelCount).fill(node.leaves.size),
          ),
        }) as PolicyCounts)
      : node.children.measure;
  const counts = groupCounts(
    node.depth,
    context.levelCount,
    node.override,
    descendants,
  );
  const source = {
    kind: "group" as const,
    groupId: node.groupId,
    depth: node.depth,
    columnId: node.columnId,
    value: node.value,
    childCount: node.filteredCount,
    aggregates,
  } as Omit<PretableGroupRow<TColumns>, "expanded">;
  const publicCollapsed = makePublicGroup(
    source,
    false,
    previous?.publicCollapsed,
  );
  const publicExpanded = makePublicGroup(
    source,
    true,
    previous?.publicExpanded,
  );
  return Object.freeze({
    ...node,
    aggregates,
    publicCollapsed,
    publicExpanded,
    counts,
  });
}

interface MutationState<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  rootsByKey: PersistentMap<string, GroupNode<TRow, TRowId, TColumns>>;
  roots: MeasuredGroupTree<TRow, TRowId, TColumns>;
  groups: PersistentMap<PretableGroupId, GroupNode<TRow, TRowId, TColumns>>;
  rowParents: PersistentMap<TRowId, PretableGroupId>;
}

function emptyRoots(): AggregateRoots {
  return Object.freeze({ all: new Map(), filtered: new Map() });
}

function mutatePath<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  state: MutationState<TRow, TRowId, TColumns>,
  record: RowRecord<TRow, TRowId, TColumns>,
  operation: "insert" | "remove",
  context: FinishContext<TRow, TRowId, TColumns>,
): void {
  const metadata = record.metadata;
  const path = metadata.groupPath;
  if (path.length === 0) return;
  const pathKeys = path.map((entry) => encodeGroupValue(entry.value));

  const visit = (
    depth: number,
    parentGroupId: PretableGroupId | undefined,
    previous: GroupNode<TRow, TRowId, TColumns> | undefined,
  ): GroupNode<TRow, TRowId, TColumns> | undefined => {
    const entry = path[depth]!;
    const groupPath = Object.freeze(path.slice(0, depth + 1));
    const groupId = makeGroupId(groupPath);
    const leafLevel = depth === path.length - 1;
    let childrenByKey = previous?.childrenByKey ?? createPersistentMap();
    let children =
      previous?.children ?? createChildTree(context.queryPlan, depth + 1);
    let leaves = previous?.leaves ?? createLeafTree(context.queryPlan);

    if (leafLevel) {
      leaves =
        operation === "insert" && metadata.filterPasses
          ? leaves.insertOrReplace(record)
          : leaves.remove(record.rowId);
    } else {
      const childKey = pathKeys[depth + 1]!;
      const oldChild = childrenByKey.get(childKey);
      const nextChild = visit(depth + 1, groupId, oldChild);
      childrenByKey =
        nextChild === undefined
          ? childrenByKey.delete(childKey)
          : childrenByKey.set(childKey, nextChild);
      children = oldChild?.filteredCount
        ? children.remove(oldChild.groupId)
        : children;
      if (nextChild?.filteredCount)
        children = children.insertOrReplace(nextChild);
    }

    const filteredCount =
      (previous?.filteredCount ?? 0) +
      (metadata.filterPasses ? (operation === "insert" ? 1 : -1) : 0);
    const allCount =
      (previous?.allCount ?? 0) + (operation === "insert" ? 1 : -1);
    if (allCount === 0) {
      state.groups = state.groups.delete(groupId);
      return undefined;
    }
    const aggregateRoots = updateAggregateRoots(
      previous?.aggregateRoots ?? emptyRoots(),
      context.queryPlan,
      record,
      operation,
      context.operation,
    );
    const override = previous?.override;
    const next = finishNode(
      {
        groupId,
        path: groupPath,
        pathKeys: Object.freeze(pathKeys.slice(0, depth + 1)),
        depth,
        columnId: entry.columnId,
        value: previous === undefined ? (entry.value ?? null) : previous.value,
        key: pathKeys[depth]!,
        parentGroupId,
        override,
        childrenByKey,
        children,
        leaves,
        filteredCount,
        allCount,
        aggregateRoots,
      },
      context,
      record.rowId,
    );
    state.groups = state.groups.set(groupId, next);
    return next;
  };

  const rootKey = pathKeys[0]!;
  const oldRoot = state.rootsByKey.get(rootKey);
  const nextRoot = visit(0, undefined, oldRoot);
  state.rootsByKey =
    nextRoot === undefined
      ? state.rootsByKey.delete(rootKey)
      : state.rootsByKey.set(rootKey, nextRoot);
  if (oldRoot?.filteredCount) state.roots = state.roots.remove(oldRoot.groupId);
  if (nextRoot?.filteredCount)
    state.roots = state.roots.insertOrReplace(nextRoot);
  state.rowParents =
    operation === "insert"
      ? state.rowParents.set(record.rowId, makeGroupId(path))
      : state.rowParents.delete(record.rowId);
}

function rootFromState<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  state: MutationState<TRow, TRowId, TColumns>,
  context: FinishContext<TRow, TRowId, TColumns>,
): GroupIndexRoot<TRow, TRowId, TColumns> {
  return Object.freeze({
    levelCount: context.levelCount,
    queryPlan: context.queryPlan,
    aggregateFilteredRows: context.aggregateFilteredRows,
    ...state,
    counts: state.roots.measure,
  });
}

export function createGroupIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  records: readonly RowRecord<TRow, TRowId, TColumns>[],
  queryPlan: CompiledQuery<TColumns>,
  aggregateFilteredRows: boolean,
  overrides: PersistentMap<PretableGroupId, boolean>,
  operation: PretableRowModelOperation = "set-rows",
  reusable?: GroupIndexRoot<TRow, TRowId, TColumns>,
): GroupIndexRoot<TRow, TRowId, TColumns> {
  const levelCount = queryPlan.query.rowGroups.length;
  const rootsByKey = createPersistentMap<
    string,
    GroupNode<TRow, TRowId, TColumns>
  >();
  const state: MutationState<TRow, TRowId, TColumns> = {
    rootsByKey,
    roots: createChildTree(queryPlan, 0),
    groups: createPersistentMap(),
    rowParents: createPersistentMap(),
  };
  const context: FinishContext<TRow, TRowId, TColumns> = {
    queryPlan,
    levelCount,
    aggregateFilteredRows,
    reusable: reusable?.groups ?? state.groups,
    operation,
  };
  for (const record of records) mutatePath(state, record, "insert", context);
  // Apply retained overrides after all future/current groups have been materialized.
  let root = rootFromState(state, context);
  for (const [groupId, expanded] of overrides.entries()) {
    if (root.groups.has(groupId))
      root = setGroupOverride(root, groupId, expanded);
  }
  return root;
}

export function updateGroupIndex<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  previous: GroupIndexRoot<TRow, TRowId, TColumns>,
  removals: readonly RowRecord<TRow, TRowId, TColumns>[],
  insertions: readonly RowRecord<TRow, TRowId, TColumns>[],
  overrides?: PersistentMap<PretableGroupId, boolean>,
  operation: PretableRowModelOperation = "apply-transaction",
): GroupIndexRoot<TRow, TRowId, TColumns> {
  const state: MutationState<TRow, TRowId, TColumns> = {
    rootsByKey: previous.rootsByKey,
    roots: previous.roots,
    groups: previous.groups,
    rowParents: previous.rowParents,
  };
  const context: FinishContext<TRow, TRowId, TColumns> = {
    queryPlan: previous.queryPlan,
    levelCount: previous.levelCount,
    aggregateFilteredRows: previous.aggregateFilteredRows,
    reusable: previous.groups,
    operation,
  };
  for (const record of removals) mutatePath(state, record, "remove", context);
  for (const record of insertions) mutatePath(state, record, "insert", context);
  let root = rootFromState(state, context);
  if (overrides !== undefined) {
    for (const [groupId, expanded] of overrides.entries()) {
      const group = root.groups.get(groupId);
      if (group !== undefined && group.override !== expanded) {
        root = setGroupOverride(root, groupId, expanded);
      }
    }
  }
  return root;
}

export function setGroupOverride<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  groupId: PretableGroupId,
  override: boolean | undefined,
): GroupIndexRoot<TRow, TRowId, TColumns> {
  const target = root.groups.get(groupId);
  if (target === undefined || target.override === override) return root;
  const context: FinishContext<TRow, TRowId, TColumns> = {
    queryPlan: root.queryPlan,
    levelCount: root.levelCount,
    aggregateFilteredRows: root.aggregateFilteredRows,
    reusable: root.groups,
    operation: "set-group-expanded",
  };
  let groups = root.groups;
  const representativeRowId = (
    node: GroupNode<TRow, TRowId, TColumns>,
  ): TRowId => {
    if (node.children.size === 0) return node.leaves.entryAt(0)!.rowId;
    return representativeRowId(node.children.entries().next().value!);
  };
  const replace = (
    depth: number,
    node: GroupNode<TRow, TRowId, TColumns>,
  ): GroupNode<TRow, TRowId, TColumns> => {
    let childrenByKey = node.childrenByKey;
    let children = node.children;
    if (depth < target.depth) {
      const key = target.pathKeys[depth + 1]!;
      const oldChild = childrenByKey.get(key)!;
      const nextChild = replace(depth + 1, oldChild);
      childrenByKey = childrenByKey.set(key, nextChild);
      if (oldChild.filteredCount)
        children = children.remove(oldChild.groupId).insertOrReplace(nextChild);
    }
    const next = finishNode(
      {
        ...node,
        override: depth === target.depth ? override : node.override,
        childrenByKey,
        children,
      },
      context,
      // Expansion does not change aggregate roots. If a custom lazy finalizer
      // is nevertheless invoked, use the first ordered descendant as the
      // deterministic representative for complete error context.
      representativeRowId(node),
    );
    groups = groups.set(next.groupId, next);
    return next;
  };
  const rootKey = target.pathKeys[0]!;
  const oldTop = root.rootsByKey.get(rootKey)!;
  const nextTop = replace(0, oldTop);
  return Object.freeze({
    ...root,
    rootsByKey: root.rootsByKey.set(rootKey, nextTop),
    roots: root.roots.remove(oldTop.groupId).insertOrReplace(nextTop),
    groups,
    counts: root.roots.remove(oldTop.groupId).insertOrReplace(nextTop).measure,
  });
}

function publicGroup<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  node: GroupNode<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
): PretableGroupRow<TColumns> {
  return effectiveExpanded(node, policy)
    ? node.publicExpanded
    : node.publicCollapsed;
}

function publicData<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  record: RowRecord<TRow, TRowId, TColumns>,
  depth: number,
): PretableDataRow<TRow, TRowId> {
  if (record.publicRow.depth === depth) return record.publicRow;
  let byDepth = groupedPublicData.get(record) as
    Map<number, PretableDataRow<TRow, TRowId>> | undefined;
  const cached = byDepth?.get(depth);
  if (cached !== undefined) return cached;
  const created = Object.freeze({ ...record.publicRow, depth });
  if (byDepth === undefined) {
    byDepth = new Map();
    groupedPublicData.set(
      record,
      byDepth as Map<number, PretableDataRow<object, PretableRowId>>,
    );
  }
  byDepth.set(depth, created);
  return created;
}

const groupedPublicData = new WeakMap<
  object,
  Map<number, PretableDataRow<object, PretableRowId>>
>();

export function visibleCount<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
): number {
  return countForPolicy(root.counts, policy);
}

function visibleAtNode<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  node: GroupNode<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  offset: number,
): PretableVisibleRow<TRow, TRowId, TColumns> | undefined {
  if (offset === 0) return publicGroup(node, policy);
  if (!effectiveExpanded(node, policy)) return undefined;
  const descendantOffset = offset - 1;
  if (node.children.size > 0) {
    const selected = node.children.select(descendantOffset, policy);
    return selected === undefined
      ? undefined
      : visibleAtNode(selected.entry, policy, selected.offset);
  }
  const record = node.leaves.entryAt(descendantOffset);
  return record === undefined ? undefined : publicData(record, node.depth + 1);
}

export function visibleAt<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  index: number,
): PretableVisibleRow<TRow, TRowId, TColumns> | undefined {
  const selected = root.roots.select(index, policy);
  return selected === undefined
    ? undefined
    : visibleAtNode(selected.entry, policy, selected.offset);
}

export function visibleRange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  start: number,
  end: number,
): readonly PretableVisibleRow<TRow, TRowId, TColumns>[] {
  const size = visibleCount(root, policy);
  const from = Math.max(
    0,
    Math.min(size, Math.trunc(Number.isNaN(start) ? 0 : start)),
  );
  const to = Math.max(
    0,
    Math.min(size, Math.trunc(Number.isNaN(end) ? 0 : end)),
  );
  if (from >= to) return Object.freeze([]);
  return Object.freeze(
    Array.from({ length: to - from }, (_, offset) =>
      visibleAt(root, policy, from + offset),
    ).filter(
      (row): row is PretableVisibleRow<TRow, TRowId, TColumns> =>
        row !== undefined,
    ),
  );
}

export function isExpanded<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  groupId: PretableGroupId,
  policy: PretableExpansionDefault,
): boolean {
  const node = root.groups.get(groupId);
  return node === undefined || node.filteredCount === 0
    ? false
    : effectiveExpanded(node, policy);
}

export function visibleIndexOf<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  ref: PretableVisibleRowRef<TRowId>,
): number {
  const targetId =
    ref.kind === "data" ? root.rowParents.get(ref.rowId) : ref.groupId;
  if (targetId === undefined) return -1;
  const target = root.groups.get(targetId);
  if (target === undefined || target.filteredCount === 0) return -1;
  const chain: GroupNode<TRow, TRowId, TColumns>[] = [];
  let cursor: GroupNode<TRow, TRowId, TColumns> | undefined = target;
  while (cursor !== undefined) {
    chain.push(cursor);
    cursor =
      cursor.parentGroupId === undefined
        ? undefined
        : root.groups.get(cursor.parentGroupId);
  }
  chain.reverse();
  let index = root.roots.measureBefore(chain[0]!.groupId, policy);
  if (index === undefined) return -1;
  for (let depth = 1; depth < chain.length; depth += 1) {
    const parent = chain[depth - 1]!;
    if (!effectiveExpanded(parent, policy)) return -1;
    const before = parent.children.measureBefore(chain[depth]!.groupId, policy);
    if (before === undefined) return -1;
    index += 1 + before;
  }
  if (ref.kind === "group") return index;
  if (!effectiveExpanded(target, policy)) return -1;
  const rank = target.leaves.rankOf(ref.rowId);
  return rank === undefined ? -1 : index + 1 + rank;
}

function dataAtNode<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  node: GroupNode<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  index: number,
): PretableDataRow<TRow, TRowId> | undefined {
  if (!effectiveExpanded(node, policy)) return undefined;
  if (node.children.size > 0) {
    const selected = node.children.selectData(index, policy);
    return selected === undefined
      ? undefined
      : dataAtNode(selected.entry, policy, selected.offset);
  }
  const record = node.leaves.entryAt(index);
  return record === undefined ? undefined : publicData(record, node.depth + 1);
}

export function visibleDataCount<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
): number {
  return dataCountForPolicy(root.counts, policy);
}

export function dataAt<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  index: number,
): PretableDataRow<TRow, TRowId> | undefined {
  const selected = root.roots.selectData(index, policy);
  return selected === undefined
    ? undefined
    : dataAtNode(selected.entry, policy, selected.offset);
}

/** Returns the visible data rank of a data ref, or the count before a group ref. */
export function dataRankAtRef<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  policy: PretableExpansionDefault,
  ref: PretableVisibleRowRef<TRowId>,
): number | undefined {
  const targetId =
    ref.kind === "data" ? root.rowParents.get(ref.rowId) : ref.groupId;
  if (targetId === undefined) return undefined;
  const target = root.groups.get(targetId);
  if (target === undefined || target.filteredCount === 0) return undefined;
  const chain: GroupNode<TRow, TRowId, TColumns>[] = [];
  let cursor: GroupNode<TRow, TRowId, TColumns> | undefined = target;
  while (cursor !== undefined) {
    chain.push(cursor);
    cursor =
      cursor.parentGroupId === undefined
        ? undefined
        : root.groups.get(cursor.parentGroupId);
  }
  chain.reverse();
  let rank = root.roots.dataBefore(chain[0]!.groupId, policy);
  if (rank === undefined) return undefined;
  for (let depth = 1; depth < chain.length; depth += 1) {
    const parent = chain[depth - 1]!;
    if (!effectiveExpanded(parent, policy)) return undefined;
    const before = parent.children.dataBefore(chain[depth]!.groupId, policy);
    if (before === undefined) return undefined;
    rank += before;
  }
  if (ref.kind === "group") return rank;
  if (!effectiveExpanded(target, policy)) return undefined;
  const leafRank = target.leaves.rankOf(ref.rowId);
  return leafRank === undefined ? undefined : rank + leafRank;
}

export function parentGroup<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  ref: PretableVisibleRowRef<TRowId>,
  policy: PretableExpansionDefault,
): PretableGroupRow<TColumns> | undefined {
  const parentId =
    ref.kind === "data"
      ? root.rowParents.get(ref.rowId)
      : root.groups.get(ref.groupId)?.parentGroupId;
  const node = parentId === undefined ? undefined : root.groups.get(parentId);
  return node === undefined ? undefined : publicGroup(node, policy);
}

export function nearestVisible<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: GroupIndexRoot<TRow, TRowId, TColumns>,
  ref: PretableVisibleRowRef<TRowId>,
  policy: PretableExpansionDefault,
): PretableVisibleRowRef<TRowId> | undefined {
  if (visibleIndexOf(root, policy, ref) >= 0) return Object.freeze({ ...ref });
  let groupId =
    ref.kind === "data" ? root.rowParents.get(ref.rowId) : ref.groupId;
  while (groupId !== undefined) {
    const groupRef = Object.freeze({ kind: "group" as const, groupId });
    if (visibleIndexOf(root, policy, groupRef) >= 0) return groupRef;
    groupId = root.groups.get(groupId)?.parentGroupId;
  }
  return undefined;
}
